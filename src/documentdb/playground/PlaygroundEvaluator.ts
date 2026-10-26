/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
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
import { traceAuthFlow, traceAuthOperation, type AuthTraceContext } from '../../utils/authTrace';
import { getBatchSizeSetting, getConnectionTimeoutMs } from '../../utils/workspacUtils';
import { AuthMethodId } from '../auth/AuthMethod';
import { previewAcquireToken, previewResolve } from '../auth/previewDiagnostics/previewDiagnostics';
import {
    resolveInteractiveTokenResource,
    resolveManagedIdentityTokenResource,
    TokenResourceResolutionError,
} from '../auth/documentdbTokenResource';
import { clearEntraTokenFailure, recordEntraTokenFailure } from '../auth/entraErrors/entraTokenFailures';
import { CredentialCache } from '../CredentialCache';
import { withTokenAcquisitionTiming, type ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { resolveAllowInvalidCertificates } from '../utils/tlsException';
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
            onTokenRequest: (
                msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
                postResponse: (response: MainToWorkerMessage) => void,
                timings?: ConnectionStartupTimings,
                traceContext?: AuthTraceContext,
            ) => this.handleTokenRequest(msg, postResponse, timings, traceContext),
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
        let originalFailure: { error: unknown } | undefined;
        try {
            await callWithTelemetryAndErrorHandling('playground.connect', async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;
                context.telemetry.properties.authMethod = initMsg.authMechanism;
                context.telemetry.properties.needsSpawn = needsSpawn ? 'true' : 'false';
                try {
                    await this._workerManager.ensureWorker(connection.clusterId, initMsg, getConnectionTimeoutMs(), {
                        sessionId: this._sessionId,
                    });
                } catch (error) {
                    originalFailure = { error };
                    throw error;
                }
            });
        } catch (error) {
            throw originalFailure ? originalFailure.error : error;
        }
        // The telemetry wrapper swallows cancellation even when rethrow is enabled.
        if (originalFailure) {
            throw originalFailure.error;
        }
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
            // TLS-allow-invalid is keyed off `disableEmulatorSecurity` (design §7), honored ONLY for
            // local/private hosts ("hybrid" runtime policy): an orphaned flag on a public host is not
            // activated; an explicit URL param is still honored by the driver (we never force `false`).
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

    // ─── Private: Token handling ─────────────────────────────────────────────

    /**
     * Handle a token request from the worker (Entra ID OIDC).
     * Token acquisition stays on the main thread so there is one credential and one cache per window.
     */
    private async handleTokenRequest(
        msg: Extract<WorkerToMainMessage, { type: 'tokenRequest' }>,
        postResponse: (response: MainToWorkerMessage) => void,
        timings?: ConnectionStartupTimings,
        traceContext?: AuthTraceContext,
    ): Promise<void> {
        try {
            const clusterId = this._workerManager.workerClusterId;
            const credentials = clusterId ? CredentialCache.getCredentials(clusterId) : undefined;
            if (!clusterId || !credentials) {
                throw new Error(l10n.t('No credentials found for the query playground connection.'));
            }
            let resolved: Awaited<ReturnType<typeof resolveInteractiveTokenResource>>;
            try {
                resolved = await previewResolve(credentials, 'playground', traceContext, async () =>
                    msg.source === 'managedIdentity'
                        ? await resolveManagedIdentityTokenResource(credentials.connectionString)
                        : await resolveInteractiveTokenResource(credentials.connectionString), msg.source === 'managedIdentity');
                traceAuthFlow('entraCloud.resolved', resolved.details, msg.requestId, traceContext);
            } catch (error) {
                if (error instanceof TokenResourceResolutionError) {
                    traceAuthFlow('entraCloud.unresolved', error.details, msg.requestId, traceContext);
                }
                throw error;
            }
            let accessToken: string;

            if (msg.source === 'managedIdentity') {
                const { getManagedIdentityAccessToken } = await import('../auth/managedIdentityTokenProvider');
                this._sessionId ??= randomUUID();
                try {
                    accessToken = (
                        await previewAcquireToken(clusterId, 'playground', traceContext, () => withTokenAcquisitionTiming(timings, () =>
                            getManagedIdentityAccessToken(
                                [resolved.scope],
                                msg.clientId,
                                msg.tenantId,
                                this._sessionId,
                                traceContext,
                            ),
                        ), (result) => result.accessToken, msg.tenantId, true)
                    ).accessToken;
                } catch (error) {
                    if (traceContext?.startupProperties) {
                        traceContext.startupProperties.errorKind = 'tokenAcquisitionFailed';
                    }
                    recordEntraTokenFailure(clusterId, {
                        cloudCategory: resolved.cloudCategory,
                        authMethod: 'managedIdentity',
                    });
                    throw error;
                }
            } else {
                const { getSessionFromVSCode } = await import(
                    // eslint-disable-next-line import/no-internal-modules
                    '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode'
                );
                let session: vscode.AuthenticationSession | undefined;
                try {
                    session = await previewAcquireToken(clusterId, 'playground', traceContext, () => traceAuthOperation(
                        'interactiveEntra.getSession',
                        () =>
                            withTokenAcquisitionTiming(timings, () =>
                                getSessionFromVSCode([resolved.scope], msg.tenantId, { createIfNone: true }),
                            ),
                        {
                            tenantSpecified: !!msg.tenantId,
                            createIfNone: true,
                            cloudCategory: resolved.cloudCategory,
                            tokenResourceReason: resolved.reason,
                        },
                        msg.requestId,
                        traceContext,
                    ), (result) => result?.accessToken, msg.tenantId);

                    if (!session) {
                        throw new Error(l10n.t('Failed to obtain Entra ID token.'));
                    }
                } catch (error) {
                    if (traceContext?.startupProperties) {
                        traceContext.startupProperties.errorKind = 'tokenAcquisitionFailed';
                    }
                    recordEntraTokenFailure(clusterId, {
                        cloudCategory: resolved.cloudCategory,
                        authMethod: 'interactive',
                    });
                    throw error;
                }

                accessToken = session.accessToken;
            }

            clearEntraTokenFailure(clusterId);
            postResponse({
                type: 'tokenResponse',
                requestId: msg.requestId,
                accessToken,
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
