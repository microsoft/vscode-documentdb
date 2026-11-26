/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    UserCancelledError,
    callWithTelemetryAndErrorHandling,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { feedResultToSchemaStore } from '../../documentdb/feedResultToSchemaStore';
import { PlaygroundEvaluator } from '../../documentdb/playground/PlaygroundEvaluator';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { formatError, formatResult } from '../../documentdb/playground/resultFormatter';
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { getWorkerAuthReason, type WorkerAuthReason } from '../../documentdb/playground/workerTypes';
import { extractErrorCode } from '../../documentdb/shell/ShellOutputFormatter';
import { getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { addDomainInfoToProperties } from '../../documentdb/utils/getClusterMetadata';
import { ext } from '../../extensionVariables';
import { ErrorExplanationService } from '../../services/errorExplanationService';
import { recordSurveyActivity } from '../../services/survey/SurveyService';
import { classifyCodeBlock } from '../../utils/classifyCommand';
import { canSignInAgainForWorker, signInAgainForWorker } from '../signInAgain/signInAgain';
import { promptAndConnectPlayground } from './connectDatabase';

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

/** Stop an evaluator immediately without changing the open documents or their bindings. */
export function stopPlaygroundEvaluator(clusterId: string): void {
    const evaluator = evaluators.get(clusterId);
    evaluators.delete(clusterId);
    evaluator?.dispose();
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
    let connection = service.getConnection(documentUri);
    if (!connection) {
        // The playground isn't bound to a database (e.g. a saved file reopened in a
        // fresh session). Instead of dead-ending, launch the connection picker; if
        // the user picks a database we continue the run, otherwise we bail quietly.
        connection = await callWithTelemetryAndErrorHandling(
            'playground.connectOnRun',
            async (context: IActionContext) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.runMode = runMode;
                return promptAndConnectPlayground(context, documentUri, 'playground.connectOnRun');
            },
        );
        if (!connection) {
            return; // user cancelled the connection picker
        }
    }
    let boundConnection: PlaygroundConnection = connection;

    const { clusterId } = boundConnection;
    const latchReason = ClustersClient.getLatchReason(clusterId);
    if (latchReason) {
        const recovery = getPlaygroundRecovery(new ConnectionUnavailableError(latchReason), connection);
        void vscode.window.showWarningMessage(recovery?.message ?? l10n.t('This connection is unavailable.'));
        return;
    }

    // Prevent concurrent runs on the same cluster — no queuing
    if (service.isExecuting(boundConnection.clusterId)) {
        void vscode.window.showInformationMessage(
            l10n.t('A playground is already running on this cluster. Wait for it to finish.'),
        );
        return;
    }

    // Get or create the evaluator for this cluster
    let evaluator = evaluators.get(boundConnection.clusterId);
    const isNewEvaluator = !evaluator;
    if (!evaluator) {
        evaluator = new PlaygroundEvaluator();
        evaluators.set(boundConnection.clusterId, evaluator);
    }

    service.setExecuting(boundConnection.clusterId, true);

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
        context.telemetry.measurements.sessionEvalCount = evaluator!.sessionEvalCount;
        context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';
        context.telemetry.properties.isNewEvaluator = isNewEvaluator ? 'true' : 'false';
        context.telemetry.measurements.activeEvaluatorCount = evaluators.size;
        context.telemetry.properties.runMode = runMode;
        context.telemetry.measurements.codeLineCount = code.split('\n').length;

        // Command classification — understand what operations are being run
        const classification = classifyCodeBlock(code);
        context.telemetry.properties.primaryCommandCategory = classification.primaryCategory;
        context.telemetry.measurements.totalCommandsInBlock = classification.totalCommands;
        // Write per-category counts as individual measurements for aggregation
        for (const [category, count] of Object.entries(classification.categoryCounts)) {
            context.telemetry.measurements[`cmd_${category}`] = count;
        }

        // Domain info — privacy-safe hashed host data for platform analytics
        const domainProps: Record<string, string | undefined> = {};
        if (isNewEvaluator) {
            collectDomainTelemetry(boundConnection, domainProps);
        }
        Object.assign(context.telemetry.properties, domainProps);

        // Link to server metadata via connectionCorrelationId
        try {
            const existingClient = ClustersClient.getExistingClient(boundConnection.clusterId);
            if (existingClient?.connectionCorrelationId) {
                context.telemetry.properties.connectionCorrelationId = existingClient.connectionCorrelationId;
            }
        } catch {
            // Best-effort
        }

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
                    // killWorker() terminates the worker thread but the evaluator
                    // instance stays in the pool. The next evaluate() call will
                    // detect the dead worker and transparently spawn a new one.
                    evaluator?.killWorker();
                });

                const startTime = Date.now();
                const sourceUri = documentUri;

                try {
                    if (evaluators.get(clusterId) !== evaluator) {
                        throw new UserCancelledError('playground.execute');
                    }
                    const result = await evaluator!.evaluate(
                        boundConnection,
                        code,
                        (message) => {
                            progress.report({ message });
                        },
                        (binding) => {
                            boundConnection =
                                service.captureWorkerBinding(documentUri, boundConnection, binding) ?? boundConnection;
                        },
                    );

                    if (evaluators.get(clusterId) !== evaluator) {
                        return;
                    }
                    // ── Post-execution telemetry (known after success) ────
                    context.telemetry.properties.resultType = result.type ?? 'null';
                    context.telemetry.measurements.initDurationMs = evaluator!.lastInitDurationMs;
                    // sessionId/sessionEvalCount may have changed after evaluate (if worker was spawned)
                    context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
                    context.telemetry.measurements.sessionEvalCount = evaluator!.sessionEvalCount;
                    context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';

                    let formattedOutput = formatResult(result, code, boundConnection);
                    feedResultToSchemaStore(result, boundConnection.clusterId);

                    // If console output was produced, append a hint to check the output channel
                    if (evaluator!.lastEvalConsoleOutputCount > 0) {
                        formattedOutput +=
                            '\n\n// Note: Output was printed to the "DocumentDB Query Playground Output" channel';
                    }

                    if (sourceUri) {
                        await ext.playgroundResultProvider.showResult(sourceUri, formattedOutput);
                    }

                    if (!cancelled) {
                        recordSurveyActivity('queryPlayground');
                    }
                    // result: 'Succeeded' is set automatically by the framework
                } catch (error: unknown) {
                    if (error instanceof UserCancelledError) {
                        throw error;
                    }
                    // Update session telemetry even on failure (worker may have spawned before failing)
                    context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
                    context.telemetry.measurements.sessionEvalCount = evaluator!.sessionEvalCount;
                    context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';
                    context.telemetry.measurements.initDurationMs = evaluator!.lastInitDurationMs;

                    if (cancelled || evaluators.get(clusterId) !== evaluator) {
                        // Throw UserCancelledError so framework marks result as 'Canceled'
                        throw new UserCancelledError('playground.execute');
                    }

                    // Show our own error UI before re-throwing
                    const rawMessage = error instanceof Error ? error.message : String(error);
                    // Strip technical error codes for clean user-facing output;
                    // the extracted code is preserved for future telemetry.
                    const { message: errorMessage } = extractErrorCode(rawMessage);
                    const durationMs = Date.now() - startTime;
                    const recovery = getPlaygroundRecovery(error, boundConnection);
                    const displayError = recovery ? new Error(recovery.message) : error;
                    const formattedOutput = formatError(displayError, code, durationMs, boundConnection);

                    if (sourceUri) {
                        await ext.playgroundResultProvider.showResult(sourceUri, formattedOutput);
                    }

                    if (recovery) {
                        offerPlaygroundRecovery(context, sourceUri, boundConnection, recovery);
                        throw error;
                    }

                    const explanation = await ErrorExplanationService.explain({
                        clusterId: boundConnection.clusterId,
                        error,
                    });

                    void vscode.window.showErrorMessage(
                        explanation?.message ?? l10n.t('Query playground execution failed: {0}', errorMessage),
                    );

                    // Re-throw so framework automatically captures result: 'Failed',
                    // error, and errorMessage in telemetry
                    throw error;
                } finally {
                    service.setExecuting(boundConnection.clusterId, false);
                }
            },
        );
    });
}

interface PlaygroundRecovery {
    readonly message: string;
    readonly authReason?: WorkerAuthReason;
}

function getPlaygroundRecovery(error: unknown, connection: PlaygroundConnection): PlaygroundRecovery | undefined {
    const authReason = getWorkerAuthReason(error);
    if (authReason) {
        switch (authReason) {
            case 'signInRequired':
                return {
                    authReason,
                    message:
                        connection.entraIdentity &&
                        canSignInAgainForWorker(connection.clusterId, connection.entraIdentity)
                            ? l10n.t('Microsoft sign-in expired for this playground. Sign in again to continue.')
                            : l10n.t(
                                  'Microsoft sign-in expired for this playground. Re-pick its connection from the tree.',
                              ),
                };
            case 'identityMismatch':
                return {
                    authReason,
                    message: l10n.t(
                        'This playground is bound to a different Microsoft account. Re-pick its connection from the tree.',
                    ),
                };
            case 'destinationRejected':
                return {
                    authReason,
                    message: l10n.t(
                        'This connection is not allowed for Microsoft sign-in. Review the trusted server settings, then re-pick the playground connection.',
                    ),
                };
            case 'refreshFailed':
                return {
                    authReason,
                    message: l10n.t(
                        'The sign-in token could not be refreshed. Run the query again to reconnect with the same connection.',
                    ),
                };
        }
    }

    if (!(error instanceof ConnectionUnavailableError)) {
        return undefined;
    }
    if (error.reason === 'credentialsChanged' || error.reason === 'identityChanged') {
        return {
            message: l10n.t(
                'This playground is bound to the previous connection. Re-pick its connection from the tree.',
            ),
        };
    }
    return {
        message: l10n.t('This connection is unavailable. Reconnect from the tree, then re-pick it here.'),
    };
}

function offerPlaygroundRecovery(
    context: IActionContext,
    documentUri: vscode.Uri,
    connection: PlaygroundConnection,
    recovery: PlaygroundRecovery,
): void {
    if (
        recovery.authReason !== 'signInRequired' ||
        !connection.entraIdentity ||
        !canSignInAgainForWorker(connection.clusterId, connection.entraIdentity)
    ) {
        return;
    }
    const identity = connection.entraIdentity;
    const { clusterId } = connection;
    const service = PlaygroundService.getInstance();
    const evaluator = evaluators.get(clusterId);
    const epoch = ClustersClient.getEpoch(clusterId);
    const stillOwnsAction = (): boolean =>
        service.getConnection(documentUri) === connection &&
        evaluators.get(clusterId) === evaluator &&
        !service.isExecuting(clusterId);
    const action = l10n.t('Sign in again');
    void vscode.window.showWarningMessage(recovery.message, action).then(async (choice) => {
        if (choice !== action || ClustersClient.getEpoch(clusterId) !== epoch || !stillOwnsAction()) {
            return;
        }
        try {
            const result = await signInAgainForWorker(context, clusterId, identity);
            if (!result || ClustersClient.getEpoch(clusterId) !== result.epoch || !stillOwnsAction()) {
                return;
            }
            stopPlaygroundEvaluator(clusterId);
        } catch (error) {
            if (error instanceof UserCancelledError || !stillOwnsAction()) {
                return;
            }
            void vscode.window.showWarningMessage(
                l10n.t('Could not sign in again. Re-pick the playground connection from the tree.'),
            );
        }
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
