/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { SettingsHintError } from '../shell/SettingsHintError';
import { type MainToWorkerMessage, type SerializableExecutionResult, type WorkerToMainMessage } from './workerTypes';

/** Worker lifecycle states */
export type WorkerState = 'idle' | 'spawning' | 'ready' | 'executing';

/**
 * Callbacks for worker events. The caller provides these to route
 * worker messages to the appropriate destination (output channels,
 * telemetry, etc.).
 */
export interface WorkerSessionCallbacks {
    /** Called when user code produces console output (console.log, print, printjson). */
    onConsoleOutput?: (output: string) => void;
    /** Called for internal log messages from the worker. */
    onLog?: (level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string) => void;
    /**
     * Called when the worker requests an OIDC token (Entra ID auth).
     * The implementation must acquire the token via VS Code auth APIs
     * and post it back to the worker.
     */
    onTokenRequest?: (
        msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
        postResponse: (response: MainToWorkerMessage) => void,
    ) => Promise<void>;
    /** Called when the worker exits (crash or termination). */
    onWorkerExit?: (exitCode: number) => void;
}

/**
 * Core worker thread lifecycle and IPC manager.
 *
 * Handles spawning worker threads, the request/response correlation protocol,
 * timeout management, OIDC token relay, and clean shutdown. This class is
 * environment-agnostic — it does not depend on VS Code extension APIs directly
 * (callers provide callbacks for output routing and auth).
 *
 * Consumers:
 * - `PlaygroundEvaluator` wraps this with `persistent: false` (fresh context per eval)
 * - `ShellSessionManager` wraps this with `persistent: true` (context reused across evals)
 */
export class WorkerSessionManager implements vscode.Disposable {
    private _worker: Worker | undefined;
    private _workerState: WorkerState = 'idle';
    private _workerClusterId: string | undefined;
    /** Set before intentional worker termination to suppress the onWorkerExit callback. */
    private _terminatingIntentionally = false;

    /** Pending request correlation map: requestId → { resolve, reject } */
    private readonly _pendingRequests = new Map<
        string,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
        }
    >();

    private readonly _callbacks: WorkerSessionCallbacks;

    constructor(callbacks: WorkerSessionCallbacks) {
        this._callbacks = callbacks;
    }

    // ─── Public state accessors ──────────────────────────────────────────────

    get workerState(): WorkerState {
        return this._workerState;
    }

    get workerClusterId(): string | undefined {
        return this._workerClusterId;
    }

    /**
     * Whether the worker is alive and connected to the specified cluster.
     */
    isConnectedTo(clusterId: string): boolean {
        return this._worker !== undefined && this._workerState !== 'idle' && this._workerClusterId === clusterId;
    }

    /**
     * Whether a worker is alive (in any non-idle state).
     */
    get isAlive(): boolean {
        return this._worker !== undefined && this._workerState !== 'idle';
    }

    // ─── Worker lifecycle ────────────────────────────────────────────────────

    /**
     * Ensure a worker is alive and connected to the correct cluster.
     * Spawns a new worker if needed, or kills and respawns if the cluster changed.
     */
    async ensureWorker(
        clusterId: string,
        initMsg: MainToWorkerMessage & { type: 'init' },
        initTimeoutMs: number = 30000,
    ): Promise<void> {
        // If worker is alive but connected to a different cluster, shut it down
        if (this._worker && this._workerClusterId !== clusterId) {
            this.terminateWorker();
        }

        // If no worker exists, spawn one
        if (!this._worker || this._workerState === 'idle') {
            await this.spawnWorker(clusterId, initMsg, initTimeoutMs);
        }
    }

    /**
     * Send an eval message to the worker and await the result.
     *
     * @returns The serializable execution result from the worker.
     */
    async sendEval(
        evalMsg: MainToWorkerMessage & { type: 'eval' },
        timeoutMs: number,
    ): Promise<{ result: SerializableExecutionResult }> {
        this._workerState = 'executing';

        try {
            const result = await this.sendRequest<{ result: SerializableExecutionResult }>(evalMsg, timeoutMs);
            return result;
        } finally {
            if (this._workerState === 'executing') {
                this._workerState = 'ready';
            }
        }
    }

    /**
     * Gracefully shut down the worker: close the database client, then terminate thread.
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
     * Spawn a new worker thread and send the init message.
     */
    private async spawnWorker(
        clusterId: string,
        initMsg: MainToWorkerMessage & { type: 'init' },
        initTimeoutMs: number,
    ): Promise<void> {
        this._workerState = 'spawning';

        // Resolve worker script path (same directory as the main bundle in dist/)
        const workerPath = path.join(__dirname, 'playgroundWorker.js');
        this._worker = new Worker(workerPath);
        this._workerClusterId = clusterId;

        // Listen for messages from the worker
        this._worker.on('message', (msg: WorkerToMainMessage) => {
            this.handleWorkerMessage(msg);
        });

        // Listen for worker exit (crash or termination)
        this._worker.on('exit', (exitCode: number) => {
            this._callbacks.onLog?.('debug', `Worker exited with code ${String(exitCode)}`);
            if (!this._terminatingIntentionally) {
                this._callbacks.onWorkerExit?.(exitCode);
            }
            this.handleWorkerExit();
        });

        this._worker.on('error', (error: Error) => {
            this._callbacks.onLog?.('error', error.message);

            // Reject all pending requests with the actual error so callers
            // get an immediate, meaningful failure instead of waiting for
            // the eval timeout to fire with a misleading "timed out" message.
            for (const [, entry] of this._pendingRequests) {
                entry.reject(error);
            }
            this._pendingRequests.clear();
        });

        // Send init and wait for acknowledgment.
        // If init fails (bad credentials, unreachable host, etc.), tear down
        // the worker so the next call can respawn cleanly.
        try {
            await this.sendRequest<void>(initMsg, initTimeoutMs);
            this._workerState = 'ready';
        } catch (error) {
            this.terminateWorker();
            throw error;
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
                        new SettingsHintError(
                            l10n.t('Operation timed out after {0} seconds.', String(Math.round(timeoutMs / 1000))),
                            'documentDB.timeout',
                            l10n.t('You can increase the timeout in Settings:'),
                        ),
                    );
                }
            }, timeoutMs);

            // Wire up timer clearing on resolve/reject
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
                if (this._callbacks.onTokenRequest) {
                    void this._callbacks.onTokenRequest(msg, (response) => {
                        this._worker?.postMessage(response);
                    });
                }
                break;
            }

            case 'log': {
                this._callbacks.onLog?.(msg.level, msg.message);
                break;
            }

            case 'consoleOutput': {
                this._callbacks.onConsoleOutput?.(msg.output);
                break;
            }
        }
    }

    // ─── Private: Worker cleanup ─────────────────────────────────────────────

    private terminateWorker(): void {
        if (this._worker) {
            this._terminatingIntentionally = true;
            void this._worker.terminate();
            this._worker = undefined;
        }
        this._workerState = 'idle';
        this._workerClusterId = undefined;

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
        this._terminatingIntentionally = false;

        // Reject any still-pending requests
        for (const [, entry] of this._pendingRequests) {
            entry.reject(new Error('Worker exited unexpectedly'));
        }
        this._pendingRequests.clear();
    }
}
