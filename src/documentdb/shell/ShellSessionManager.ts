/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { CredentialCache } from '../CredentialCache';
import { WorkerSessionManager, type WorkerSessionCallbacks } from '../playground/WorkerSessionManager';
import {
    type MainToWorkerMessage,
    type SerializableExecutionResult,
    type SerializableMongoClientOptions,
    type WorkerToMainMessage,
} from '../playground/workerTypes';
import { SettingsHintError } from './SettingsHintError';

/**
 * Connection parameters for a shell session.
 */
export interface ShellConnectionInfo {
    /** Stable cluster ID for CredentialCache lookups. */
    readonly clusterId: string;
    /** Human-readable cluster name for display. */
    readonly clusterDisplayName: string;
    /** Initial database name for the session. */
    readonly databaseName: string;
}

/**
 * Connection metadata returned after successful initialization.
 * Used by the PTY to display connection summary in the terminal.
 */
export interface ShellConnectionMetadata {
    /** Host extracted from the connection string (without credentials). */
    readonly host: string;
    /** Authentication method used for the connection. */
    readonly authMechanism: 'NativeAuth' | 'MicrosoftEntraID';
    /** Whether this is an emulator connection. */
    readonly isEmulator: boolean;
    /** Username for SCRAM auth (undefined for Entra ID). */
    readonly username: string | undefined;
}

/**
 * Callbacks for shell session events.
 */
export interface ShellSessionCallbacks {
    /** Called when user code produces console output (console.log, print, printjson). */
    onConsoleOutput?: (output: string) => void;
    /** Called when the worker exits unexpectedly. */
    onWorkerExit?: (exitCode: number) => void;
    /** Called when the session is re-initializing after a worker restart (e.g., after Ctrl+C). */
    onReconnecting?: () => void;
    /** Called when re-initialization completes and eval is about to proceed. */
    onReconnected?: () => void;
}

/**
 * Manages a single interactive shell worker session with persistent eval context.
 *
 * Each shell session gets its own dedicated worker thread with its own `MongoClient`.
 * The worker uses `persistent: true` mode, meaning @mongosh state (variables, cursor,
 * `db` reference) survives across evaluations.
 *
 * For multiple concurrent shells (P2), each shell creates its own `ShellSessionManager`
 * instance — no shared state between sessions.
 */
export class ShellSessionManager implements vscode.Disposable {
    private readonly _workerManager: WorkerSessionManager;
    private readonly _connectionInfo: ShellConnectionInfo;
    private readonly _callbacks: ShellSessionCallbacks | undefined;
    private _initialized = false;
    /** Cached initialization promise to prevent concurrent init calls. */
    private _initPromise: Promise<ShellConnectionMetadata> | undefined;
    /** Tracks the active database, surviving worker restarts. Updated on `use <db>`. */
    private _activeDatabase: string;
    /** Auth mechanism used for the current session (set after init). */
    private _authMethod: 'NativeAuth' | 'MicrosoftEntraID' | undefined;

    constructor(connectionInfo: ShellConnectionInfo, callbacks?: ShellSessionCallbacks) {
        this._connectionInfo = connectionInfo;
        this._activeDatabase = connectionInfo.databaseName;
        this._callbacks = callbacks;

        const logPrefix = '[Shell Worker]';

        const workerCallbacks: WorkerSessionCallbacks = {
            onConsoleOutput: callbacks?.onConsoleOutput,
            onLog: (level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string) => {
                switch (level) {
                    case 'error':
                        ext.outputChannel.error(`${logPrefix} ${message}`);
                        break;
                    case 'warn':
                        ext.outputChannel.warn(`${logPrefix} ${message}`);
                        break;
                    case 'debug':
                        ext.outputChannel.debug(`${logPrefix} ${message}`);
                        break;
                    default:
                        ext.outputChannel.trace(`${logPrefix} ${message}`);
                        break;
                }
            },
            onTokenRequest: (
                msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
                postResponse: (response: MainToWorkerMessage) => void,
            ) => this.handleTokenRequest(msg, postResponse),
            onWorkerExit: callbacks?.onWorkerExit,
        };

        this._workerManager = new WorkerSessionManager(workerCallbacks);
    }

    /**
     * Whether the shell session has been initialized (worker spawned and connected).
     */
    get isInitialized(): boolean {
        return this._initialized && this._workerManager.isAlive;
    }

    /**
     * The current active database name, updated when `use <db>` succeeds.
     */
    get activeDatabase(): string {
        return this._activeDatabase;
    }

    /**
     * Update the active database. Called by the PTY when `use <db>` result is detected.
     */
    setActiveDatabase(databaseName: string): void {
        this._activeDatabase = databaseName;
    }

    /**
     * Worker thread state ('idle' | 'spawning' | 'ready' | 'executing').
     */
    get workerState(): 'idle' | 'spawning' | 'ready' | 'executing' {
        return this._workerManager.workerState;
    }

    /**
     * Authentication method used for the current session.
     */
    get authMethod(): 'NativeAuth' | 'MicrosoftEntraID' | undefined {
        return this._authMethod;
    }

    /**
     * Initialize the shell session: spawn the worker, connect to the cluster,
     * and set the initial database.
     *
     * @returns Connection metadata for display in the terminal banner.
     * @throws Error if initialization exceeds the configured timeout.
     */
    async initialize(): Promise<ShellConnectionMetadata> {
        const initMsg = this.buildInitMessage();

        const timeoutMs = this.getInitTimeoutMs();
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            setTimeout(
                () =>
                    reject(
                        new SettingsHintError(
                            l10n.t('Shell initialization timed out after {0} seconds.', timeoutMs / 1000),
                            ext.settingsKeys.shellInitTimeout,
                            l10n.t('You can increase the timeout in Settings:'),
                        ),
                    ),
                timeoutMs,
            );
        });

        await Promise.race([this._workerManager.ensureWorker(this._connectionInfo.clusterId, initMsg), timeoutPromise]);
        this._initialized = true;
        this._authMethod = initMsg.authMechanism;

        const username =
            initMsg.authMechanism === 'NativeAuth'
                ? CredentialCache.getConnectionUser(this._connectionInfo.clusterId)
                : undefined;

        return {
            host: this.extractHost(initMsg.connectionString),
            authMechanism: initMsg.authMechanism,
            isEmulator: initMsg.clientOptions.serverSelectionTimeoutMS === 4000,
            username,
        };
    }

    /**
     * Evaluate a shell command or JavaScript expression.
     *
     * The persistent worker context preserves variables, cursor state, and the
     * `db` reference across calls. Shell commands like `use <db>`, `show dbs`,
     * and `it` are handled by @mongosh within the persistent context.
     *
     * @param code - JavaScript code or shell command to evaluate.
     * @returns The serializable execution result from the worker.
     */
    async evaluate(code: string): Promise<SerializableExecutionResult> {
        // Reconnect if the worker is not alive — handles all cases:
        // timeout kills, Ctrl+C cancellation, unexpected worker crashes.
        if (!this._initialized || !this._workerManager.isAlive) {
            this._initialized = false;
            this._callbacks?.onReconnecting?.();
            if (!this._initPromise) {
                this._initPromise = this.initialize().finally(() => {
                    this._initPromise = undefined;
                });
            }
            await this._initPromise;
            this._callbacks?.onReconnected?.();
        }

        const evalMsg: MainToWorkerMessage & { type: 'eval' } = {
            type: 'eval',
            requestId: '',
            code,
            databaseName: this._activeDatabase,
            displayBatchSize: getBatchSizeSetting(),
        };

        const workerResult = await this._workerManager.sendEval(evalMsg);
        return workerResult.result;
    }

    /**
     * Gracefully shut down the shell session.
     */
    async shutdown(): Promise<void> {
        await this._workerManager.shutdown();
        this._initialized = false;
    }

    /**
     * Force-terminate the worker thread immediately.
     */
    killWorker(): void {
        this._workerManager.killWorker();
        this._initialized = false;
    }

    dispose(): void {
        this._workerManager.dispose();
        this._initialized = false;
    }

    // ─── Private: Init message ───────────────────────────────────────────────

    private buildInitMessage(): MainToWorkerMessage & { type: 'init' } {
        const credentials = CredentialCache.getCredentials(this._connectionInfo.clusterId);
        if (!credentials) {
            throw new Error(l10n.t('No credentials found for cluster {0}', this._connectionInfo.clusterId));
        }

        const authMechanism = credentials.authMechanism ?? 'NativeAuth';

        let connectionString: string;
        if (authMechanism === 'NativeAuth') {
            connectionString = CredentialCache.getConnectionStringWithPassword(this._connectionInfo.clusterId);
        } else {
            connectionString = credentials.connectionString;
        }

        const clientOptions: SerializableMongoClientOptions = {
            serverSelectionTimeoutMS: credentials.emulatorConfiguration?.isEmulator ? 4000 : undefined,
            tlsAllowInvalidCertificates:
                credentials.emulatorConfiguration?.isEmulator &&
                credentials.emulatorConfiguration?.disableEmulatorSecurity
                    ? true
                    : undefined,
        };

        return {
            type: 'init',
            requestId: '',
            connectionString,
            clientOptions,
            databaseName: this._activeDatabase,
            authMechanism: authMechanism as 'NativeAuth' | 'MicrosoftEntraID',
            tenantId: credentials.entraIdConfig?.tenantId,
            persistent: true,
        };
    }

    // ─── Private: Token handling ─────────────────────────────────────────────

    private getInitTimeoutMs(): number {
        const config = vscode.workspace.getConfiguration();
        const timeoutSec = config.get<number>(ext.settingsKeys.shellInitTimeout, 60);
        return timeoutSec * 1000;
    }

    /**
     * Extract the host portion from a connection string, stripping credentials.
     * Returns just the hostname:port for safe display.
     */
    private extractHost(connectionString: string): string {
        try {
            const url = new URL(connectionString);
            return url.host || url.hostname || 'unknown';
        } catch {
            // Fallback: try to extract host from mongodb:// or mongodb+srv:// pattern
            const match = /mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/.exec(connectionString);
            return match?.[1] ?? 'unknown';
        }
    }

    private async handleTokenRequest(
        msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
        postResponse: (response: MainToWorkerMessage) => void,
    ): Promise<void> {
        try {
            const { getSessionFromVSCode } = await import(
                // eslint-disable-next-line import/no-internal-modules
                '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode'
            );
            const session = await getSessionFromVSCode(msg.scopes as string[], msg.tenantId, { createIfNone: true });

            if (!session) {
                throw new Error('Failed to obtain Entra ID session');
            }

            postResponse({
                type: 'tokenResponse',
                requestId: msg.requestId,
                accessToken: session.accessToken,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            postResponse({
                type: 'tokenError',
                requestId: msg.requestId,
                error: errorMessage,
            });
        }
    }
}
