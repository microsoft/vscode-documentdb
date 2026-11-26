/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
// Static or `await import('bson')`, this is the driver's CommonJS copy: vite.config.ext.mjs and
// vitest.config.ts alias `bson` to it. Without the alias an ES-module importer gets bson's ESM
// entry, a second copy whose classes fail `instanceof` against the driver's and silently corrupt
// schema inference. build/verification/bson-identity checks both routes.
import { EJSON } from 'bson';
import { randomUUID } from 'crypto';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { meterSilentCatch } from '../../utils/accumulatingTelemetry';
import { getBatchSizeSetting, getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { type VerifiedEntraIdentity } from '../auth/AuthHandler';
import { AuthMethodId } from '../auth/AuthMethodId';
import { createWorkerAuthError, sameEntraIdentity, WorkerTokenRelay } from '../auth/WorkerTokenRelay';
import { ClustersClient } from '../ClustersClient';
import { computeConnectionFingerprint } from '../connectionFingerprint';
import { ConnectionUnavailableError } from '../ConnectionUnavailableError';
import { CredentialCache } from '../CredentialCache';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
import { type ExecutionResult, type PlaygroundConnection, type PlaygroundWorkerBinding } from './types';
import { WorkerSessionManager } from './WorkerSessionManager';
import {
    getWorkerAuthReason,
    type MainToWorkerMessage,
    type SerializableMongoClientOptions,
    type WorkerAuthReason,
} from './workerTypes';

const consumedWorkerReplacements = new WeakSet<object>();

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
 *
 * ## Lifecycle
 *
 * The evaluator instance and the worker thread have **independent lifecycles**:
 *
 * ```
 * Evaluator instance        Worker thread
 * ─────────────────         ─────────────
 * new PlaygroundEvaluator()
 *   └─ evaluate() ────────► spawn + connect
 *   └─ evaluate() ────────► reuse (no re-auth)
 *   └─ killWorker() ──────► terminate
 *   └─ evaluate() ────────► re-spawn + re-connect
 *   └─ shutdown() ────────► graceful close
 * ```
 *
 * After `killWorker()` (called on user cancellation), the evaluator instance
 * stays registered in the per-cluster evaluator pool (`evaluators` Map in
 * `executePlaygroundCode.ts`). The next `evaluate()` call detects that the
 * worker is dead and transparently spawns a new one. Session telemetry
 * (`_sessionId`, `_sessionEvalCount`) resets on each worker spawn, so a
 * killed-and-respawned worker behaves like a fresh evaluator session.
 *
 * The evaluator is only removed from the pool by `shutdownEvaluator()` (when
 * all playground documents for the cluster close) or by `disposeEvaluators()`
 * (on extension deactivation). `shutdownEvaluator()` calls `shutdown()`, while
 * `disposeEvaluators()` calls `dispose()`. Both paths gracefully close the
 * worker before removing the evaluator.
 */
export class PlaygroundEvaluator implements vscode.Disposable {
    private readonly _workerManager: WorkerSessionManager;
    private _sessionInitMessage: Extract<MainToWorkerMessage, { type: 'init' }> | undefined;
    private _relay: WorkerTokenRelay | undefined;
    /** A worker snapshot, not a document binding. */
    private _workerFingerprint: string | undefined;
    private _pinContext: { clusterId: string; identity: VerifiedEntraIdentity } | undefined;
    private _authFailure: { clusterId: string; reason: WorkerAuthReason } | undefined;
    private _disposed = false;

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
            onLog: (
                level: 'trace' | 'debug' | 'info' | 'warn' | 'error',
                message: string,
                startupCorrelationId?: string,
            ) => {
                const output = `${logPrefix}${startupCorrelationId ? ` startup=${startupCorrelationId}` : ''} surface=playground ${message}`;
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
            onTokenRequest: async (request, post, isCurrent, timings, trace) => {
                const relay = this._relay;
                await relay?.relay(request, post, () => this._relay === relay && isCurrent(), timings, trace);
            },
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
        onFirstBinding?: (binding: PlaygroundWorkerBinding) => void,
    ): Promise<ExecutionResult> {
        const { clusterId, fingerprint } = connection;
        this.assertConnectionAvailable(clusterId);
        const epoch = ClustersClient.getEpoch(clusterId);
        const sameCluster = this._workerManager.isConnectedTo(clusterId);
        const pin = this._pinContext?.clusterId === clusterId ? this._pinContext.identity : undefined;
        const verified = ClustersClient.getLastVerifiedIdentity(clusterId);
        const entraPin = verified?.kind === 'entra' ? verified : undefined;
        const reason =
            (this._authFailure?.clusterId === clusterId ? this._authFailure.reason : undefined) ??
            (sameCluster ? this._workerManager.authFailure : undefined);
        const replacement = connection.workerReplacement;
        let replaceFailedWorker = false;
        let replacementFingerprint: string | undefined;
        if (
            replacement &&
            !consumedWorkerReplacements.has(replacement) &&
            replacement.fingerprint === fingerprint &&
            (reason === 'signInRequired' || reason === 'identityMismatch')
        ) {
            replacementFingerprint = ClustersClient.getExpectedFingerprint(clusterId, connection.entraIdentity);
            const currentFingerprint = ClustersClient.getBinding(clusterId)?.fingerprint;
            if (
                replacementFingerprint === undefined ||
                fingerprint !== replacementFingerprint ||
                (currentFingerprint !== undefined && currentFingerprint !== fingerprint)
            ) {
                throw new ConnectionUnavailableError('credentialsChanged');
            }
            replaceFailedWorker = true;
        }
        if (sameCluster && this._relay?.epoch === epoch) {
            const currentFingerprint = ClustersClient.getBinding(clusterId)?.fingerprint;
            if (
                (fingerprint !== undefined &&
                    ((!replaceFailedWorker && fingerprint !== this._workerFingerprint) ||
                        (currentFingerprint !== undefined && fingerprint !== currentFingerprint))) ||
                (!replaceFailedWorker && pin && entraPin && !sameEntraIdentity(pin, entraPin))
            ) {
                throw new ConnectionUnavailableError('credentialsChanged');
            }
        }
        if (
            !replaceFailedWorker &&
            (pin || fingerprint) &&
            (reason === 'signInRequired' || reason === 'identityMismatch')
        ) {
            throw createWorkerAuthError(reason);
        }
        if (replaceFailedWorker && replacement) {
            consumedWorkerReplacements.add(replacement);
        }
        const needsSpawn = replaceFailedWorker || !sameCluster || !!reason || this._relay?.epoch !== epoch;

        const initStartTime = Date.now();
        let learnedBinding: PlaygroundWorkerBinding | undefined;
        let initMsg: Extract<MainToWorkerMessage, { type: 'init' }>;
        if (needsSpawn || !this._sessionInitMessage) {
            onProgress?.(l10n.t('Initializing…'));
            this.assertConnectionAvailable(clusterId);
            const pinned = connection.entraIdentity ?? pin;
            const expected = replacementFingerprint ?? ClustersClient.getExpectedFingerprint(clusterId, pinned);
            if (fingerprint !== undefined && fingerprint !== expected) {
                throw new ConnectionUnavailableError('credentialsChanged');
            }
            if (pin && entraPin && !sameEntraIdentity(pin, entraPin) && !fingerprint) {
                throw new ConnectionUnavailableError('credentialsChanged');
            }
            initMsg = this.buildInitMessage(connection);
            if (this._workerManager.isAlive || this._workerManager.workerState === 'spawning') {
                this._workerManager.killWorker();
            }
            this.resetSession();
            const workerPin = initMsg.authMechanism === 'MicrosoftEntraID' ? (entraPin ?? pinned) : undefined;
            this._pinContext = workerPin && { clusterId, identity: workerPin };
            this._sessionInitMessage = initMsg;
            this._workerFingerprint = expected;
            this._sessionId = randomUUID();
            this._sessionAuthMethod = initMsg.authMechanism;
            const originalUri = initMsg.connectionString;
            this._relay = new WorkerTokenRelay(clusterId, initMsg, epoch, this._sessionId, workerPin, (identity) => {
                this._pinContext = { clusterId, identity };
                this._workerFingerprint = computeConnectionFingerprint({
                    connectionString: originalUri,
                    principal: identity,
                });
                learnedBinding = { fingerprint: this._workerFingerprint, entraIdentity: identity };
            });
        } else {
            initMsg = this._sessionInitMessage;
        }

        const relay = this._relay;
        const isCurrentRelay = (): boolean => relay === this._relay && epoch === ClustersClient.getEpoch(clusterId);
        const assertCurrent = (): void => {
            this.assertConnectionAvailable(clusterId);
            if (!isCurrentRelay()) {
                throw new ConnectionUnavailableError('credentialsChanged');
            }
        };
        onProgress?.(l10n.t('Authenticating…'));
        let originalFailure: { error: unknown } | undefined;
        try {
            await callWithTelemetryAndErrorHandling('playground.connect', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;
                context.telemetry.properties.authMethod = initMsg.authMechanism;
                context.telemetry.properties.needsSpawn = needsSpawn ? 'true' : 'false';
                try {
                    assertCurrent();
                    await this._workerManager.ensureWorker(clusterId, initMsg, getConnectionTimeoutMs(), {
                        sessionId: this._sessionId,
                    });
                } catch (error) {
                    originalFailure = { error };
                    throw error;
                }
            });
        } catch (error) {
            originalFailure ??= { error };
        }
        // The telemetry wrapper swallows cancellation even when rethrow is enabled.
        if (originalFailure) {
            this.recordWorkerFailure(clusterId, relay, originalFailure.error);
            // Startup can fail after sign-in; keep the document pinned without replaying its query.
            if (
                learnedBinding &&
                fingerprint === undefined &&
                !(originalFailure.error instanceof UserCancelledError) &&
                isCurrentRelay() &&
                !this._disposed &&
                !ClustersClient.getLatchReason(clusterId)
            ) {
                onFirstBinding?.(learnedBinding);
            }
            throw originalFailure.error;
        }
        assertCurrent();
        this._authFailure = undefined;
        if (fingerprint === undefined && this._workerFingerprint !== undefined) {
            onFirstBinding?.({ fingerprint: this._workerFingerprint, entraIdentity: this._pinContext?.identity });
        }
        this._lastInitDurationMs = needsSpawn ? Date.now() - initStartTime : 0;

        // Reset console output counter for this eval run
        this._lastEvalConsoleOutputCount = 0;

        // Send eval message and await result
        onProgress?.(l10n.t('Running query…'));
        assertCurrent();

        this._sessionEvalCount++;

        const evalMsg: MainToWorkerMessage & { type: 'eval' } = {
            type: 'eval',
            requestId: '',
            code,
            databaseName: connection.databaseName,
            displayBatchSize: getBatchSizeSetting(),
        };

        try {
            const workerResult = await this._workerManager.sendEval(evalMsg);
            return this.deserializeResult(workerResult.result);
        } catch (error) {
            this.recordWorkerFailure(clusterId, relay, error);
            throw error;
        }
    }

    /**
     * Gracefully shut down the worker: close the database client, then terminate thread.
     * Returns after the worker has confirmed shutdown or after a timeout.
     */
    async shutdown(): Promise<void> {
        ext.outputChannel?.trace('[PlaygroundEvaluator] Shutting down worker');
        this.resetSession();
        this._pinContext = undefined;
        this._authFailure = undefined;
        await this._workerManager.shutdown();
    }

    /**
     * Force-terminate the worker thread immediately.
     * Used for infinite loop recovery (timeout) and cancellation.
     */
    killWorker(): void {
        const clusterId = this._workerManager.workerClusterId;
        const reason = this._workerManager.authFailure;
        if (clusterId && reason) {
            this._authFailure ??= { clusterId, reason };
        }
        this._workerManager.killWorker();
        this.resetSession();
    }

    dispose(): void {
        this._disposed = true;
        this._workerManager.dispose();
        this.resetSession();
        this._pinContext = undefined;
        this._authFailure = undefined;
    }

    private assertConnectionAvailable(clusterId: string): void {
        const reason = ClustersClient.getLatchReason(clusterId);
        if (reason || this._disposed) {
            throw new ConnectionUnavailableError(reason ?? 'connectionRemoved');
        }
    }

    private recordWorkerFailure(clusterId: string, relay: WorkerTokenRelay | undefined, error: unknown): void {
        const reason = getWorkerAuthReason(error);
        if (
            reason &&
            relay === this._relay &&
            relay?.epoch === ClustersClient.getEpoch(clusterId) &&
            !ClustersClient.getLatchReason(clusterId)
        ) {
            this._authFailure = { clusterId, reason };
        }
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

        const authMechanism = credentials.authMechanism ?? AuthMethodId.NativeAuth;

        // Build connection string
        let connectionString: string;
        if (authMechanism === AuthMethodId.NativeAuth) {
            connectionString = CredentialCache.getConnectionStringWithPassword(connection.clusterId);
        } else {
            // Entra ID and NoAuth: use connection string without embedded credentials
            connectionString = credentials.connectionString;
        }

        // Build serializable MongoClientOptions
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
            databaseName: connection.databaseName,
            authMechanism: authMechanism as 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth',
            tenantId:
                authMechanism === AuthMethodId.ManagedIdentity
                    ? credentials.managedIdentityConfig?.tenantId
                    : credentials.entraIdConfig?.tenantId,
            managedIdentityClientId: credentials.managedIdentityConfig?.clientId,
        };
    }

    // ─── Private: Result deserialization ─────────────────────────────────────

    /**
     * Deserialize the worker result — printable is a canonical EJSON string from the worker.
     * Canonical EJSON preserves all BSON types (ObjectId, Date, Decimal128, Int32,
     * Long, Double, etc.) so that SchemaAnalyzer correctly identifies field types.
     */
    private deserializeResult(serResult: {
        type: string | null;
        printable: string;
        durationMs: number;
        cursorHasMore?: boolean;
        source?: { namespace?: { db: string; collection: string } };
    }): ExecutionResult {
        let printable: unknown;
        try {
            printable = EJSON.parse(serResult.printable, { relaxed: false });
        } catch {
            meterSilentCatch('PlaygroundEvaluator_ejson');
            // Fallback to JSON.parse if EJSON fails, then raw string
            try {
                printable = JSON.parse(serResult.printable) as unknown;
            } catch {
                meterSilentCatch('PlaygroundEvaluator_json');
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

        this._sessionInitMessage = undefined;
        this._relay = undefined;
        this._workerFingerprint = undefined;
        this._sessionId = undefined;
        this._sessionEvalCount = 0;
        this._sessionAuthMethod = undefined;
    }
}
