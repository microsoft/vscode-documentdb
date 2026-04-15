/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { feedResultToSchemaStore } from '../../documentdb/feedResultToSchemaStore';
import { PlaygroundEvaluator } from '../../documentdb/playground/PlaygroundEvaluator';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { formatError, formatResult } from '../../documentdb/playground/resultFormatter';
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { extractErrorCode } from '../../documentdb/shell/ShellOutputFormatter';
import { getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { addDomainInfoToProperties } from '../../documentdb/utils/getClusterMetadata';
import { ext } from '../../extensionVariables';

/** Per-cluster evaluator pool — one worker per cluster, lazily created. */
const evaluators = new Map<string, PlaygroundEvaluator>();

/**
 * Dispose all evaluator instances (kills all worker threads).
 * Called during extension deactivation.
 */
export function disposeEvaluators(): void {
    for (const ev of evaluators.values()) {
        ev.dispose();
    }
    evaluators.clear();
}

/**
 * Gracefully shut down a specific cluster's evaluator worker thread.
 * Called when all playground documents for that cluster are closed.
 * The worker will be re-spawned lazily on the next Run.
 */
export function shutdownEvaluator(clusterId: string): void {
    const ev = evaluators.get(clusterId);
    if (ev) {
        void ev.shutdown();
        evaluators.delete(clusterId);
    }
}

/**
 * Shut down all evaluators that have no remaining open playground documents.
 * Called when playground documents close or state changes.
 *
 * Evaluators whose worker is currently executing are skipped — they will be
 * cleaned up after the execution completes (the next state-change event
 * re-triggers this function).
 */
export function shutdownOrphanedEvaluators(): void {
    const service = PlaygroundService.getInstance();
    const activeClusterIds = service.getActiveClusterIds();

    for (const [clusterId, ev] of evaluators) {
        if (!activeClusterIds.has(clusterId)) {
            // Don't kill a worker mid-execution; defer until it finishes
            if (ev.workerState === 'executing') {
                continue;
            }
            void ev.shutdown();
            evaluators.delete(clusterId);
        }
    }
}

/**
 * Returns all current playground evaluator instances.
 * Used by the worker task manager debug command to report stats.
 */
export function getPlaygroundEvaluators(): ReadonlyMap<string, PlaygroundEvaluator> {
    return evaluators;
}

/**
 * Executes query playground code and displays the result in a read-only side panel.
 * Used by both `runAll` and `runSelected` commands.
 */
export type PlaygroundRunMode = 'runAll' | 'runSelected';

export async function executePlaygroundCode(
    code: string,
    runMode: PlaygroundRunMode,
    documentUri: vscode.Uri,
): Promise<void> {
    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(documentUri);
    if (!connection) {
        void vscode.window.showInformationMessage(
            l10n.t('This playground has no connection. Create a new playground from the DocumentDB panel.'),
        );
        return;
    }

    // Prevent concurrent runs — no queuing
    if (service.isExecuting) {
        void vscode.window.showInformationMessage(l10n.t('A playground is already running. Wait for it to finish.'));
        return;
    }

    // Get or create the evaluator for this cluster
    let evaluator = evaluators.get(connection.clusterId);
    if (!evaluator) {
        evaluator = new PlaygroundEvaluator();
        evaluators.set(connection.clusterId, evaluator);
    }

    service.setExecuting(true);

    // callWithTelemetryAndErrorHandling automatically tracks:
    //   - duration (measured from callback start to end)
    //   - result: 'Succeeded' | 'Failed' | 'Canceled'
    //   - error / errorMessage (from thrown errors)
    // We add custom properties for playground-specific analytics.
    await callWithTelemetryAndErrorHandling('playground.execute', async (context) => {
        context.errorHandling.suppressDisplay = true; // we show our own error UI
        context.errorHandling.rethrow = false;

        // ── Pre-execution telemetry (known before eval) ──────────────
        context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
        context.telemetry.properties.sessionEvalCount = String(evaluator!.sessionEvalCount);
        context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';
        context.telemetry.properties.runMode = runMode;
        context.telemetry.measurements.codeLineCount = code.split('\n').length;

        // Domain info — privacy-safe hashed host data for platform analytics
        const domainProps: Record<string, string | undefined> = {};
        collectDomainTelemetry(connection, domainProps);
        Object.assign(context.telemetry.properties, domainProps);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t('Query Playground'),
                cancellable: true,
            },
            async (progress, token) => {
                let cancelled = false;

                token.onCancellationRequested(() => {
                    cancelled = true;
                    evaluator?.killWorker();
                });

                const startTime = Date.now();
                const sourceUri = vscode.window.activeTextEditor?.document.uri;

                try {
                    const result = await evaluator!.evaluate(connection, code, (message) => {
                        progress.report({ message });
                    });

                    // ── Post-execution telemetry (known after success) ────
                    context.telemetry.properties.resultType = result.type ?? 'null';
                    context.telemetry.measurements.initDurationMs = evaluator!.lastInitDurationMs;
                    // sessionId/sessionEvalCount may have changed after evaluate (if worker was spawned)
                    context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
                    context.telemetry.properties.sessionEvalCount = String(evaluator!.sessionEvalCount);
                    context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';

                    let formattedOutput = formatResult(result, code, connection);
                    feedResultToSchemaStore(result, connection.clusterId);

                    // If console output was produced, append a hint to check the output channel
                    if (evaluator!.lastEvalConsoleOutputCount > 0) {
                        formattedOutput +=
                            '\n\n// Note: Output was printed to the "DocumentDB Query Playground Output" channel';
                    }

                    if (sourceUri) {
                        await ext.playgroundResultProvider.showResult(sourceUri, formattedOutput);
                    }

                    // result: 'Succeeded' is set automatically by the framework
                } catch (error: unknown) {
                    // Update session telemetry even on failure (worker may have spawned before failing)
                    context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
                    context.telemetry.properties.sessionEvalCount = String(evaluator!.sessionEvalCount);
                    context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';
                    context.telemetry.measurements.initDurationMs = evaluator!.lastInitDurationMs;

                    if (cancelled) {
                        // Throw UserCancelledError so framework marks result as 'Canceled'
                        throw new UserCancelledError('playground.execute');
                    }

                    // Show our own error UI before re-throwing
                    const rawMessage = error instanceof Error ? error.message : String(error);
                    // Strip technical error codes for clean user-facing output;
                    // the extracted code is preserved for future telemetry.
                    const { message: errorMessage } = extractErrorCode(rawMessage);
                    const durationMs = Date.now() - startTime;
                    const formattedOutput = formatError(error, code, durationMs, connection);

                    if (sourceUri) {
                        await ext.playgroundResultProvider.showResult(sourceUri, formattedOutput);
                    }

                    void vscode.window.showErrorMessage(l10n.t('Query playground execution failed: {0}', errorMessage));

                    // Re-throw so framework automatically captures result: 'Failed',
                    // error, and errorMessage in telemetry
                    throw error;
                } finally {
                    service.setExecuting(false);
                }
            },
        );
    });
}

// ─── Domain telemetry ────────────────────────────────────────────────────────

/**
 * Collects domain info from the query playground connection's cached credentials.
 * Reuses the same hashing logic as the connection metadata telemetry.
 */
function collectDomainTelemetry(
    connection: PlaygroundConnection,
    properties: Record<string, string | undefined>,
): void {
    try {
        const credentials = CredentialCache.getCredentials(connection.clusterId);
        if (!credentials?.connectionString) {
            return;
        }
        const hosts = getHostsFromConnectionString(credentials.connectionString);
        addDomainInfoToProperties(hosts, properties);
    } catch {
        // Domain info is best-effort — don't fail telemetry if parsing fails
    }
}
