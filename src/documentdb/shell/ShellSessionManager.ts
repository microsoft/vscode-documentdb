/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { getBatchSizeSetting, getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { ClustersClient } from '../ClustersClient';
import { ConnectionUnavailableError } from '../ConnectionUnavailableError';
import { CredentialCache } from '../CredentialCache';
import { type VerifiedEntraIdentity } from '../auth/AuthHandler';
import { AuthMethodId } from '../auth/AuthMethodId';
import { EntraIdentityMismatchError } from '../auth/entraErrors/entraCallbackErrors';
import { createWorkerAuthError, sameEntraIdentity, WorkerTokenRelay } from '../auth/WorkerTokenRelay';
import { computeConnectionFingerprint } from '../connectionFingerprint';
import {
    WorkerSessionManager,
    type WorkerSessionCallbacks,
    type WorkerStartupTelemetryContext,
} from '../playground/WorkerSessionManager';
import {
    getWorkerAuthReason,
    type MainToWorkerMessage,
    type SerializableExecutionResult,
    type SerializableMongoClientOptions,
    type WorkerAuthReason,
} from '../playground/workerTypes';
import { getHostsFromConnectionString } from '../utils/connectionStringHelpers';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';

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
    /** First host extracted from the connection string (without credentials). */
    readonly host: string;
    /** Number of hosts omitted from the connection summary. */
    readonly additionalHostCount: number;
    /** Authentication method used for the connection. */
    readonly authMechanism: 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth';
    /** Whether this is an emulator connection. */
    readonly isEmulator: boolean;
    /** Username for SCRAM auth (undefined for Entra ID). */
    readonly username: string | undefined;
    /** Optional human-readable name of the authenticated identity. */
    readonly displayName?: string;
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
    private _relay: WorkerTokenRelay | undefined;
    private _fingerprint: string | undefined;
    private _pin: VerifiedEntraIdentity | undefined;
    private _authFailure: WorkerAuthReason | undefined;
    private _disposed = false;
    private readonly _connectionInfo: ShellConnectionInfo;
    private readonly _callbacks: ShellSessionCallbacks | undefined;
    private readonly _managedIdentityTokenCorrelationId = randomUUID();
    private _initialized = false;
    /** Cached initialization promise to prevent concurrent init calls. */
    private _initPromise: Promise<ShellConnectionMetadata> | undefined;
    /** Tracks the active database, surviving worker restarts. Updated on `use <db>`. */
    private _activeDatabase: string;
    /** Auth mechanism used for the current session (set after init). */
    private _authMethod: 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth' | undefined;
    /** Human-readable identity name resolved during authentication, when available. */
    private _displayName: string | undefined;

    constructor(
        connectionInfo: ShellConnectionInfo,
        callbacks?: ShellSessionCallbacks,
        private readonly _telemetryContext: WorkerStartupTelemetryContext = {},
    ) {
        this._connectionInfo = connectionInfo;
        this._activeDatabase = connectionInfo.databaseName;
        this._callbacks = callbacks;

        const logPrefix = '[Shell Worker]';

        const workerCallbacks: WorkerSessionCallbacks = {
            onConsoleOutput: callbacks?.onConsoleOutput,
            onLog: (
                level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
                message: string,
                startupCorrelationId?: string,
            ) => {
                const output = `${logPrefix}${startupCorrelationId ? ` startup=${startupCorrelationId}` : ''} surface=shell ${message}`;
                switch (level) {
                    case 'error':
                        ext.outputChannel.error(output);
                        break;
                    case 'warn':
                        ext.outputChannel.warn(output);
                        break;
                    case 'debug':
                        ext.outputChannel.debug(output);
                        break;
                    default:
                        ext.outputChannel.trace(output);
                        break;
                }
            },
            onTokenRequest: async (request, post, isCurrent, timings, trace, postStartup) => {
                const relay = this._relay;
                // Warm Shells survive host-only invalidation. Fence each refresh at receipt;
                // startup still uses the epoch captured before opening the connection.
                const epoch = this._initialized ? ClustersClient.getEpoch(this._connectionInfo.clusterId) : relay?.epoch;
                await relay?.relay(
                    request,
                    post,
                    () => this._relay === relay && isCurrent(),
                    timings,
                    trace,
                    postStartup,
                    epoch,
                );
            },
            onWorkerExit: callbacks?.onWorkerExit,
        };

        this._workerManager = new WorkerSessionManager(workerCallbacks);
    }

    /**
     * Whether the shell session has been initialized (worker spawned and connected).
     */
    get isInitialized(): boolean {
        return this._initialized && this._workerManager.isAlive && !this._authFailure && !this._workerManager.authFailure;
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
    get authMethod(): 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth' | undefined {
        return this._authMethod;
    }

    get pinnedEntraIdentity(): VerifiedEntraIdentity | undefined {
        return this._pin;
    }

    /** Accept only the same verified account; the next command reconnects and runs once. */
    public resetAfterSignIn(identity: VerifiedEntraIdentity, epoch: number): void {
        this.assertConnectionAvailable();
        if (ClustersClient.getEpoch(this._connectionInfo.clusterId) !== epoch) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        if (!this._pin || !sameEntraIdentity(this._pin, identity)) {
            throw new EntraIdentityMismatchError();
        }
        if (ClustersClient.getExpectedFingerprint(this._connectionInfo.clusterId, this._pin) !== this._fingerprint) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        this.killWorker();
        this._authFailure = undefined;
    }

    /**
     * Initialize the shell session: spawn the worker, connect to the cluster,
     * and set the initial database.
     *
     * @returns Connection metadata for display in the terminal banner.
     * @throws Error if initialization exceeds the configured timeout.
     */
    async initialize(): Promise<ShellConnectionMetadata> {
        this._initPromise ??= this.initializeSession();
        const pending = this._initPromise;
        try {
            return await pending;
        } finally {
            if (this._initPromise === pending) {
                this._initPromise = undefined;
            }
        }
    }

    private async initializeSession(): Promise<ShellConnectionMetadata> {
        this.assertConnectionAvailable();
        this.assertAuthRecovery();
        const { clusterId } = this._connectionInfo;
        const epoch = ClustersClient.getEpoch(clusterId);
        const fingerprint = ClustersClient.getExpectedFingerprint(clusterId, this._pin);
        if (this._fingerprint !== undefined && this._fingerprint !== fingerprint) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        const initMsg = this.buildInitMessage();
        if (!this.isInitialized) {
            if (this._initialized && this._authFailure) {
                this._workerManager.killWorker();
            }
            this._initialized = false;
            this._fingerprint ??= fingerprint;
            const verified = ClustersClient.getLastVerifiedIdentity(clusterId);
            const pin = this._pin ?? (verified?.kind === 'entra' ? verified : undefined);
            if (initMsg.authMechanism === AuthMethodId.MicrosoftEntraID) {
                this._pin = pin;
            }
            this._relay = new WorkerTokenRelay(
                clusterId,
                initMsg,
                epoch,
                this._managedIdentityTokenCorrelationId,
                initMsg.authMechanism === AuthMethodId.MicrosoftEntraID ? pin : undefined,
                (identity) => {
                    this._pin = identity;
                    this._fingerprint ??= computeConnectionFingerprint({
                        connectionString: initMsg.connectionString,
                        principal: identity,
                    });
                    this._displayName = identity.accountLabel || undefined;
                },
            );
        }

        const relay = this._relay;
        try {
            await this._workerManager.ensureWorker(clusterId, initMsg, getConnectionTimeoutMs(), this._telemetryContext);
        } catch (error) {
            if (relay === this._relay && epoch === ClustersClient.getEpoch(clusterId) && !ClustersClient.getLatchReason(clusterId)) {
                this._authFailure ??= getWorkerAuthReason(error);
            }
            throw error;
        }
        this.assertConnectionAvailable();
        if (relay !== this._relay || epoch !== ClustersClient.getEpoch(clusterId)) {
            throw new ConnectionUnavailableError('credentialsChanged');
        }
        this._authFailure = undefined;
        this._initialized = true;
        this._authMethod = initMsg.authMechanism;

        const username =
            initMsg.authMechanism === 'NativeAuth'
                ? CredentialCache.getConnectionUser(this._connectionInfo.clusterId)
                : undefined;
        const hosts = this.extractHosts(initMsg.connectionString);

        return {
            host: hosts[0],
            additionalHostCount: hosts.length - 1,
            authMechanism: initMsg.authMechanism,
            // Derive emulator-ness from the authoritative credential flag, NOT from the
            // fail-fast `serverSelectionTimeoutMS === 4000` proxy: that timeout now also fires
            // for a regular local connection that opted into the TLS exception
            // (`disableEmulatorSecurity` without `isEmulator`, design §7), which must not be
            // mislabeled "(Emulator)" in the banner or inflate the emulator telemetry metric.
            isEmulator:
                CredentialCache.getCredentials(this._connectionInfo.clusterId)?.emulatorConfiguration?.isEmulator ??
                false,
            username,
            displayName: this._displayName,
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
     * @param terminalColumns - current terminal width, for width-aware output such as `help`.
     * @returns The serializable execution result from the worker.
     */
    async evaluate(code: string, terminalColumns?: number): Promise<SerializableExecutionResult> {
        this.assertConnectionAvailable();
        // Reconnect if the worker is not alive — handles all cases:
        // timeout kills, Ctrl+C cancellation, unexpected worker crashes.
        if (!this.isInitialized) {
            this.assertAuthRecovery();
            this._callbacks?.onReconnecting?.();
            await this.initialize();
            this.assertConnectionAvailable();
            this._callbacks?.onReconnected?.();
        }

        const evalMsg: MainToWorkerMessage & { type: 'eval' } = {
            type: 'eval',
            requestId: '',
            code,
            databaseName: this._activeDatabase,
            displayBatchSize: getBatchSizeSetting(),
            terminalColumns,
        };

        const relay = this._relay;
        const epoch = ClustersClient.getEpoch(this._connectionInfo.clusterId);
        try {
            return (await this._workerManager.sendEval(evalMsg)).result;
        } catch (error) {
            if (
                relay === this._relay &&
                epoch === ClustersClient.getEpoch(this._connectionInfo.clusterId) &&
                !ClustersClient.getLatchReason(this._connectionInfo.clusterId)
            ) {
                this._authFailure ??= getWorkerAuthReason(error);
            }
            throw error;
        }
    }

    /**
     * Gracefully shut down the shell session.
     */
    async shutdown(): Promise<void> {
        this._initialized = false;
        this._relay = undefined;
        this._initPromise = undefined;
        await this._workerManager.shutdown();
    }

    /**
     * Force-terminate the worker thread immediately.
     */
    killWorker(): void {
        this._authFailure ??= this._workerManager.authFailure;
        this._relay = undefined;
        this._initPromise = undefined;
        this._workerManager.killWorker();
        this._initialized = false;
    }

    dispose(): void {
        this._disposed = true;
        this._relay = undefined;
        this._initPromise = undefined;
        this._workerManager.dispose();
        this._initialized = false;
    }

    private assertConnectionAvailable(): void {
        const reason = ClustersClient.getLatchReason(this._connectionInfo.clusterId);
        if (reason) {
            throw new ConnectionUnavailableError(reason);
        }
        if (this._disposed) {
            throw new ConnectionUnavailableError('connectionRemoved');
        }
    }

    private assertAuthRecovery(): void {
        const reason = this._authFailure ?? this._workerManager.authFailure;
        if (this._pin && (reason === 'signInRequired' || reason === 'identityMismatch')) {
            throw createWorkerAuthError(reason);
        }
    }

    // ─── Private: Init message ───────────────────────────────────────────────

    private buildInitMessage(): MainToWorkerMessage & { type: 'init' } {
        const credentials = CredentialCache.getCredentials(this._connectionInfo.clusterId);
        if (!credentials) {
            throw new Error(l10n.t('No credentials found for cluster {0}', this._connectionInfo.clusterId));
        }

        const authMechanism = credentials.authMechanism ?? AuthMethodId.NativeAuth;

        let connectionString: string;
        if (authMechanism === AuthMethodId.NativeAuth) {
            connectionString = CredentialCache.getConnectionStringWithPassword(this._connectionInfo.clusterId);
        } else {
            // Entra ID and NoAuth use the connection string without embedded credentials.
            connectionString = credentials.connectionString;
        }

        const clientOptions: SerializableMongoClientOptions = {
            // Fail-fast 4s timeout for emulators / local TLS-exception connections — host-gated the
            // same way as the TLS option so an orphaned flag on a public host doesn't trigger it.
            serverSelectionTimeoutMS:
                credentials.emulatorConfiguration?.isEmulator ||
                resolveAllowInvalidCertificates(
                    credentials.emulatorConfiguration?.disableEmulatorSecurity,
                    connectionString,
                )
                    ? 4000
                    : undefined,
            // Non-OIDC connections keep the local/private TLS exception. The worker's OIDC builder
            // removes this option and URI bypasses for Entra connections.
            tlsAllowInvalidCertificates: resolveAllowInvalidCertificates(
                credentials.emulatorConfiguration?.disableEmulatorSecurity,
                connectionString,
            ),
        };

        return {
            type: 'init',
            requestId: '',
            connectionString,
            clientOptions,
            databaseName: this._activeDatabase,
            authMechanism: authMechanism as 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth',
            tenantId:
                authMechanism === AuthMethodId.ManagedIdentity
                    ? credentials.managedIdentityConfig?.tenantId
                    : credentials.entraIdConfig?.tenantId,
            managedIdentityClientId: credentials.managedIdentityConfig?.clientId,
            persistent: true,
        };
    }

    /**
     * Extract the host portion from a connection string, stripping credentials.
     * Returns just the hostname:port for safe display.
     */
    private extractHosts(connectionString: string): readonly string[] {
        try {
            const hosts = getHostsFromConnectionString(connectionString);
            return hosts.length > 0 ? hosts : ['unknown'];
        } catch {
            // Fallback for a connection string accepted by the driver but not by the shared parser.
            const match = /mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?]+)/.exec(connectionString);
            return match?.[1].split(',') ?? ['unknown'];
        }
    }
}
