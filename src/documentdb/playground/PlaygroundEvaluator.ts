/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { ext } from '../../extensionVariables';
import { CredentialCache } from '../CredentialCache';
import { type ExecutionResult, type PlaygroundConnection } from './types';
import {
    type MainToWorkerMessage,
    type SerializableExecutionResult,
    type SerializableMongoClientOptions,
    type WorkerToMainMessage,
} from './workerTypes';

/** Worker lifecycle states */
type WorkerState = 'idle' | 'spawning' | 'ready' | 'executing';

/**
 * Evaluates query playground code in a persistent worker thread.
 *
 * The worker owns its own database client (authenticated via credentials from
 * `CredentialCache`) and stays alive between runs. This provides:
 * - Infinite loop safety (main thread can kill the worker)
 * - Client isolation from the Collection View
 * - Zero re-auth overhead after the first run
 *
 * The public API is unchanged from the in-process evaluator:
 * `evaluate(connection, code) → Promise<ExecutionResult>`
 */
export class PlaygroundEvaluator implements vscode.Disposable {
    private _worker: Worker | undefined;
    private _workerState: WorkerState = 'idle';
    /** Which cluster the live worker is connected to (to detect cluster switches) */
    private _workerClusterId: string | undefined;

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

    /** Pending request correlation map: requestId → { resolve, reject } */
    private _pendingRequests = new Map<
        string,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
        }
    >();

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
        const needsSpawn =
            !this._worker || this._workerState === 'idle' || this._workerClusterId !== connection.clusterId;
        if (needsSpawn) {
            onProgress?.(l10n.t('Initializing…'));
        }

        const initStartTime = Date.now();
        await this.ensureWorker(connection, onProgress);
        this._lastInitDurationMs = needsSpawn ? Date.now() - initStartTime : 0;

        // Reset console output counter for this eval run
        this._lastEvalConsoleOutputCount = 0;

        // Send eval message and await result
        onProgress?.(l10n.t('Running query…'));
        const timeoutSec = vscode.workspace.getConfiguration().get<number>(ext.settingsKeys.shellTimeout) ?? 30;
        const timeoutMs = timeoutSec * 1000;

        const result = await this.sendEval(connection, code, timeoutMs);
        return result;
    }

    /**
     * Gracefully shut down the worker: close the database client, then terminate thread.
     * Returns after the worker has confirmed shutdown or after a timeout.
     */
    async shutdown(): Promise<void> {
        if (!this._worker || this._workerState === 'idle') {
            return;
        }

        try {
            await this.sendRequest<void>({ type: 'shutdown', requestId: '' }, 5000);
        } catch {
            // Shutdown timed out or failed — force-kill
        }

        this.terminateWorker();
    }

    /**
     * Force-terminate the worker thread immediately.
     * Used for infinite loop recovery (timeout) and cancellation.
     */
    killWorker(): void {
        this.terminateWorker();
    }

    dispose(): void {
        this.terminateWorker();
    }

    // ─── Private: Worker lifecycle ───────────────────────────────────────────

    /**
     * Ensure a worker is alive and connected to the correct cluster.
     * Spawns a new worker if needed (lazy), or kills and respawns if the
     * cluster has changed.
     */
    private async ensureWorker(
        connection: PlaygroundConnection,
        onProgress?: (message: string) => void,
    ): Promise<void> {
        // If worker is alive but connected to a different cluster, shut it down
        if (this._worker && this._workerClusterId !== connection.clusterId) {
            this.terminateWorker();
        }

        // If no worker exists, spawn one
        if (!this._worker || this._workerState === 'idle') {
            await this.spawnWorker(connection, onProgress);
        }
    }

    /**
     * Spawn a new worker thread and send the init message.
     */
    private async spawnWorker(connection: PlaygroundConnection, onProgress?: (message: string) => void): Promise<void> {
        this._workerState = 'spawning';

        // Resolve worker script path (same directory as the main bundle in dist/)
        const workerPath = path.join(__dirname, 'playgroundWorker.js');
        this._worker = new Worker(workerPath);
        this._workerClusterId = connection.clusterId;

        // Listen for messages from the worker
        this._worker.on('message', (msg: WorkerToMainMessage) => {
            this.handleWorkerMessage(msg);
        });

        // Listen for worker exit (crash or termination)
        this._worker.on('exit', (exitCode: number) => {
            ext.outputChannel.debug(`[Playground Worker] Worker exited with code ${String(exitCode)}`);
            this.handleWorkerExit();
        });

        this._worker.on('error', (error: Error) => {
            ext.outputChannel.error(`[Playground Worker] ${error.message}`);
        });

        // Build init message from cached credentials and send to worker.
        // If init fails (bad credentials, unreachable host, etc.), tear down
        // the worker so the next evaluate() call can respawn cleanly.
        try {
            const initMsg = this.buildInitMessage(connection);

            // Start a new telemetry session for this worker lifecycle
            this._sessionId = randomUUID();
            this._sessionEvalCount = 0;
            this._sessionAuthMethod = initMsg.authMechanism;

            // Send init and wait for acknowledgment
            onProgress?.(l10n.t('Authenticating…'));
            await this.sendRequest<void>(initMsg, 30000);
            this._workerState = 'ready';
        } catch (error) {
            this.terminateWorker();
            throw error;
        }
    }

    /**
     * Build the init message from CredentialCache data.
     */
    private buildInitMessage(connection: PlaygroundConnection): MainToWorkerMessage & { type: 'init' } {
        const credentials = CredentialCache.getCredentials(connection.clusterId);
        if (!credentials) {
            throw new Error(l10n.t('No credentials found for cluster {0}', connection.clusterId));
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
            // TODO(F11): Read from documentDB.mongoShell.batchSize setting and wire in worker
            displayBatchSize: 50,
        };
    }

    /**
     * Send an eval message to the worker and await the result.
     */
    private async sendEval(
        connection: PlaygroundConnection,
        code: string,
        timeoutMs: number,
    ): Promise<ExecutionResult> {
        this._workerState = 'executing';
        this._sessionEvalCount++;

        const evalMsg: MainToWorkerMessage = {
            type: 'eval',
            requestId: '',
            code,
            databaseName: connection.databaseName,
        };

        try {
            const result = await this.sendRequest<{ result: SerializableExecutionResult }>(evalMsg, timeoutMs);

            // Deserialize the result — printable is a canonical EJSON string from the worker.
            // Canonical EJSON preserves all BSON types (ObjectId, Date, Decimal128, Int32,
            // Long, Double, etc.) so that SchemaAnalyzer correctly identifies field types.
            const serResult = result.result;
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
                source: serResult.source,
            };
        } finally {
            if (this._workerState === 'executing') {
                this._workerState = 'ready';
            }
        }
    }

    // ─── Private: IPC request/response ───────────────────────────────────────

    /**
     * Send a message to the worker and return a promise that resolves
     * when the corresponding response arrives.
     */
    private sendRequest<T>(msg: MainToWorkerMessage, timeoutMs: number): Promise<T> {
        if (!this._worker) {
            return Promise.reject(new Error(l10n.t('Worker is not running')));
        }

        const requestId = randomUUID();
        const msgWithId = { ...msg, requestId };

        return new Promise<T>((resolve, reject) => {
            this._pendingRequests.set(requestId, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });

            // Timeout — kills the worker for safety (infinite loop protection)
            const timer = setTimeout(() => {
                const pending = this._pendingRequests.get(requestId);
                if (pending) {
                    this._pendingRequests.delete(requestId);
                    this.killWorker();
                    pending.reject(
                        new Error(
                            l10n.t('Operation timed out after {0} seconds', String(Math.round(timeoutMs / 1000))),
                        ),
                    );
                }
            }, timeoutMs);

            // Store timer reference on the pending entry so we can clear it
            const entry = this._pendingRequests.get(requestId)!;
            const originalResolve = entry.resolve;
            const originalReject = entry.reject;
            entry.resolve = (value: unknown) => {
                clearTimeout(timer);
                originalResolve(value);
            };
            entry.reject = (error: Error) => {
                clearTimeout(timer);
                originalReject(error);
            };

            this._worker!.postMessage(msgWithId);
        });
    }

    /**
     * Handle an incoming message from the worker.
     */
    private handleWorkerMessage(msg: WorkerToMainMessage): void {
        switch (msg.type) {
            case 'initResult': {
                const pending = this._pendingRequests.get(msg.requestId);
                if (pending) {
                    this._pendingRequests.delete(msg.requestId);
                    if (msg.success) {
                        pending.resolve(undefined);
                    } else {
                        pending.reject(new Error(msg.error ?? 'Worker init failed'));
                    }
                }
                break;
            }

            case 'evalResult': {
                const pending = this._pendingRequests.get(msg.requestId);
                if (pending) {
                    this._pendingRequests.delete(msg.requestId);
                    pending.resolve(msg);
                }
                break;
            }

            case 'evalError': {
                const pending = this._pendingRequests.get(msg.requestId);
                if (pending) {
                    this._pendingRequests.delete(msg.requestId);
                    const error = new Error(msg.error);
                    if (msg.stack) {
                        error.stack = msg.stack;
                    }
                    pending.reject(error);
                }
                break;
            }

            case 'shutdownComplete': {
                const pending = this._pendingRequests.get(msg.requestId);
                if (pending) {
                    this._pendingRequests.delete(msg.requestId);
                    pending.resolve(undefined);
                }
                break;
            }

            case 'tokenRequest': {
                // Entra ID: worker needs an OIDC token — delegate to main thread VS Code API
                void this.handleTokenRequest(msg);
                break;
            }

            case 'log': {
                const prefix = '[Playground Worker]';
                switch (msg.level) {
                    case 'error':
                        ext.outputChannel.error(`${prefix} ${msg.message}`);
                        break;
                    case 'warn':
                        ext.outputChannel.warn(`${prefix} ${msg.message}`);
                        break;
                    case 'debug':
                        ext.outputChannel.debug(`${prefix} ${msg.message}`);
                        break;
                    default:
                        ext.outputChannel.trace(`${prefix} ${msg.message}`);
                        break;
                }
                break;
            }

            case 'consoleOutput': {
                this._lastEvalConsoleOutputCount++;
                ext.playgroundOutputChannel.show(true);
                ext.playgroundOutputChannel.appendLine(msg.output);
                break;
            }
        }
    }

    /**
     * Handle a token request from the worker (Entra ID OIDC).
     * Calls VS Code's auth API on the main thread and sends the token back.
     */
    private async handleTokenRequest(msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>): Promise<void> {
        try {
            const { getSessionFromVSCode } = await import(
                // eslint-disable-next-line import/no-internal-modules
                '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode'
            );
            const session = await getSessionFromVSCode(msg.scopes as string[], msg.tenantId, { createIfNone: true });

            if (!session) {
                throw new Error('Failed to obtain Entra ID session');
            }

            const response: MainToWorkerMessage = {
                type: 'tokenResponse',
                requestId: msg.requestId,
                accessToken: session.accessToken,
            };
            this._worker?.postMessage(response);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const response: MainToWorkerMessage = {
                type: 'tokenError',
                requestId: msg.requestId,
                error: errorMessage,
            };
            this._worker?.postMessage(response);
        }
    }

    // ─── Private: Worker cleanup ─────────────────────────────────────────────

    private terminateWorker(): void {
        if (this._worker) {
            void this._worker.terminate();
            this._worker = undefined;
        }
        this._workerState = 'idle';
        this._workerClusterId = undefined;
        this._sessionId = undefined;
        this._sessionEvalCount = 0;
        this._sessionAuthMethod = undefined;

        // Reject all pending requests
        for (const [, entry] of this._pendingRequests) {
            entry.reject(new Error('Worker terminated'));
        }
        this._pendingRequests.clear();
    }

    private handleWorkerExit(): void {
        this._worker = undefined;
        this._workerState = 'idle';
        this._workerClusterId = undefined;
        this._sessionId = undefined;
        this._sessionEvalCount = 0;
        this._sessionAuthMethod = undefined;

        // Reject any still-pending requests
        for (const [, entry] of this._pendingRequests) {
            entry.reject(new Error('Worker exited unexpectedly'));
        }
        this._pendingRequests.clear();
    }
}
