/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { CredentialCache } from '../CredentialCache';
import { type ExecutionResult, type PlaygroundConnection } from './types';
import { WorkerSessionManager } from './WorkerSessionManager';
import { type MainToWorkerMessage, type SerializableMongoClientOptions, type WorkerToMainMessage } from './workerTypes';

/**
 * Evaluates query playground code in a persistent worker thread.
 *
 * The worker owns its own database client (authenticated via credentials from
 * `CredentialCache`) and stays alive between runs. This provides:
 * - Infinite loop safety (main thread can kill the worker)
 * - Client isolation from the Collection View
 * - Zero re-auth overhead after the first run
 *
 * Delegates worker lifecycle and IPC to `WorkerSessionManager`.
 *
 * The public API is unchanged from the in-process evaluator:
 * `evaluate(connection, code) → Promise<ExecutionResult>`
 */
export class PlaygroundEvaluator implements vscode.Disposable {
    private readonly _workerManager: WorkerSessionManager;

    /**
     * Telemetry session ID — generated on worker spawn, stable across evals within the
     * same worker lifecycle. Resets when the worker is terminated/respawned.
     * Used to correlate multiple query playground runs within a single "session".
     */
    private _sessionId: string | undefined;

    /** Number of eval calls completed during this worker session (for usage tracking). */
    private _sessionEvalCount: number = 0;

    /** Auth mechanism used for the current worker session (for telemetry). */
    private _sessionAuthMethod: string | undefined;

    /** Telemetry accessors — read by the command layer for telemetry properties. */
    get sessionId(): string | undefined {
        return this._sessionId;
    }
    get sessionEvalCount(): number {
        return this._sessionEvalCount;
    }
    get sessionAuthMethod(): string | undefined {
        return this._sessionAuthMethod;
    }

    /** Duration of the last worker init (spawn + auth), in ms. 0 if worker was already alive. */
    private _lastInitDurationMs: number = 0;
    get lastInitDurationMs(): number {
        return this._lastInitDurationMs;
    }

    /** Number of console output messages (console.log/print/printjson) produced during the last eval. */
    private _lastEvalConsoleOutputCount: number = 0;
    get lastEvalConsoleOutputCount(): number {
        return this._lastEvalConsoleOutputCount;
    }

    /** Worker state from the underlying WorkerSessionManager. */
    get workerState(): string {
        return this._workerManager.workerState;
    }

    /** Whether the worker is alive. */
    get isAlive(): boolean {
        return this._workerManager.isAlive;
    }

    /** Cluster ID the worker is connected to (if any). */
    get workerClusterId(): string | undefined {
        return this._workerManager.workerClusterId;
    }

    constructor() {
        const logPrefix = '[Playground Worker]';

        this._workerManager = new WorkerSessionManager({
            onConsoleOutput: (output: string) => {
                this._lastEvalConsoleOutputCount++;
                ext.playgroundOutputChannel.show(true);
                // Use append(), not appendLine() — the runtime already includes a trailing newline.
                ext.playgroundOutputChannel.append(output);
            },
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
            onWorkerExit: (exitCode: number) => {
                ext.outputChannel.debug(`${logPrefix} Worker exited with code ${String(exitCode)}`);
                this.resetSession();
            },
        });
    }

    /**
     * Evaluate user code against the connected database.
     *
     * @param connection - Active query playground connection (clusterId + databaseName).
     * @param code - JavaScript code string to evaluate.
     * @param onProgress - Optional callback for phased progress reporting.
     * @returns Formatted execution result with type, printable value, and timing.
     */
    async evaluate(
        connection: PlaygroundConnection,
        code: string,
        onProgress?: (message: string) => void,
    ): Promise<ExecutionResult> {
        // Ensure worker is alive and connected to the right cluster
        const needsSpawn = !this._workerManager.isConnectedTo(connection.clusterId);
        if (needsSpawn) {
            onProgress?.(l10n.t('Initializing…'));
            ext.outputChannel?.trace(
                `[PlaygroundEvaluator] Spawning new worker for cluster=${connection.clusterId}, db=${connection.databaseName}`,
            );
        }

        const initStartTime = Date.now();
        const initMsg = this.buildInitMessage(connection);

        // Start a new telemetry session if we're spawning a new worker
        if (needsSpawn) {
            this._sessionId = randomUUID();
            this._sessionEvalCount = 0;
            this._sessionAuthMethod = initMsg.authMechanism;
        }

        onProgress?.(l10n.t('Authenticating…'));
        await callWithTelemetryAndErrorHandling('playground.connect', async (context) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true;
            context.telemetry.properties.authMethod = initMsg.authMechanism;
            context.telemetry.properties.needsSpawn = needsSpawn ? 'true' : 'false';
            await this._workerManager.ensureWorker(connection.clusterId, initMsg);
        });
        this._lastInitDurationMs = needsSpawn ? Date.now() - initStartTime : 0;

        // Reset console output counter for this eval run
        this._lastEvalConsoleOutputCount = 0;

        // Send eval message and await result
        onProgress?.(l10n.t('Running query…'));

        this._sessionEvalCount++;

        const evalMsg: MainToWorkerMessage & { type: 'eval' } = {
            type: 'eval',
            requestId: '',
            code,
            databaseName: connection.databaseName,
            displayBatchSize: getBatchSizeSetting(),
        };

        const workerResult = await this._workerManager.sendEval(evalMsg);
        return this.deserializeResult(workerResult.result);
    }

    /**
     * Gracefully shut down the worker: close the database client, then terminate thread.
     * Returns after the worker has confirmed shutdown or after a timeout.
     */
    async shutdown(): Promise<void> {
        ext.outputChannel?.trace('[PlaygroundEvaluator] Shutting down worker');
        await this._workerManager.shutdown();
        this.resetSession();
    }

    /**
     * Force-terminate the worker thread immediately.
     * Used for infinite loop recovery (timeout) and cancellation.
     */
    killWorker(): void {
        this._workerManager.killWorker();
        this.resetSession();
    }

    dispose(): void {
        this._workerManager.dispose();
        this.resetSession();
    }

    // ─── Private: Init message ───────────────────────────────────────────────

    /**
     * Build the init message from CredentialCache data.
     */
    private buildInitMessage(connection: PlaygroundConnection): MainToWorkerMessage & { type: 'init' } {
        const credentials = CredentialCache.getCredentials(connection.clusterId);
        if (!credentials) {
            throw new Error(l10n.t('No credentials found for cluster "{0}"', connection.clusterDisplayName));
        }

        const authMechanism = credentials.authMechanism ?? 'NativeAuth';

        // Build connection string
        let connectionString: string;
        if (authMechanism === 'NativeAuth') {
            connectionString = CredentialCache.getConnectionStringWithPassword(connection.clusterId);
        } else {
            // Entra ID: use connection string without embedded credentials
            connectionString = credentials.connectionString;
        }

        // Build serializable MongoClientOptions
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
            databaseName: connection.databaseName,
            authMechanism: authMechanism as 'NativeAuth' | 'MicrosoftEntraID',
            tenantId: credentials.entraIdConfig?.tenantId,
        };
    }

    // ─── Private: Result deserialization ─────────────────────────────────────

    /**
     * Deserialize the worker result — printable is a canonical EJSON string from the worker.
     * Canonical EJSON preserves all BSON types (ObjectId, Date, Decimal128, Int32,
     * Long, Double, etc.) so that SchemaAnalyzer correctly identifies field types.
     */
    private async deserializeResult(serResult: {
        type: string | null;
        printable: string;
        durationMs: number;
        cursorHasMore?: boolean;
        source?: { namespace?: { db: string; collection: string } };
    }): Promise<ExecutionResult> {
        let printable: unknown;
        try {
            const { EJSON } = await import('bson');
            printable = EJSON.parse(serResult.printable, { relaxed: false });
        } catch {
            // Fallback to JSON.parse if EJSON fails, then raw string
            try {
                printable = JSON.parse(serResult.printable) as unknown;
            } catch {
                printable = serResult.printable;
            }
        }

        return {
            type: serResult.type,
            printable,
            durationMs: serResult.durationMs,
            cursorHasMore: serResult.cursorHasMore,
            source: serResult.source,
        };
    }

    // ─── Private: Token handling ─────────────────────────────────────────────

    /**
     * Handle a token request from the worker (Entra ID OIDC).
     * Calls VS Code's auth API on the main thread and sends the token back.
     */
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

    // ─── Private: Session telemetry ──────────────────────────────────────────

    private resetSession(): void {
        // Lightweight close marker — NO summary properties.
        // Session depth is derived from per-eval events via MAX(sessionEvalCount).
        // This event exists solely to measure start-vs-close ratio.
        if (this._sessionId) {
            const closingSessionId = this._sessionId;
            void callWithTelemetryAndErrorHandling('playground.sessionEnd', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.sessionId = closingSessionId;
            });
        }

        this._sessionId = undefined;
        this._sessionEvalCount = 0;
        this._sessionAuthMethod = undefined;
    }
}
