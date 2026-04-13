/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document, type WithId } from 'mongodb';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { PlaygroundEvaluator } from '../../documentdb/playground/PlaygroundEvaluator';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { formatError, formatResult } from '../../documentdb/playground/resultFormatter';
import { type ExecutionResult, type PlaygroundConnection } from '../../documentdb/playground/types';
import { getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { addDomainInfoToProperties } from '../../documentdb/utils/getClusterMetadata';
import { ext } from '../../extensionVariables';

/** Shared evaluator instance — lazily created, reused across runs. */
let evaluator: PlaygroundEvaluator | undefined;

/**
 * Dispose the shared evaluator instance (kills the worker thread).
 * Called during extension deactivation.
 */
export function disposeEvaluator(): void {
    evaluator?.dispose();
    evaluator = undefined;
}

/**
 * Gracefully shut down the evaluator's worker thread (closes MongoClient).
 * Called when the query playground connection is cleared or when all query playground editors close.
 * The worker will be re-spawned lazily on the next Run.
 */
export function shutdownEvaluator(): void {
    void evaluator?.shutdown();
}

/**
 * Executes query playground code and displays the result in a read-only side panel.
 * Used by both `runAll` and `runSelected` commands.
 */
export type PlaygroundRunMode = 'runAll' | 'runSelected';

export async function executePlaygroundCode(code: string, runMode: PlaygroundRunMode): Promise<void> {
    const service = PlaygroundService.getInstance();
    const connection = service.getConnection();
    if (!connection) {
        void vscode.window.showInformationMessage(
            l10n.t('Connect to a database before running. Right-click a database in the DocumentDB panel.'),
        );
        return;
    }

    // Prevent concurrent runs — no queuing
    if (service.isExecuting) {
        void vscode.window.showInformationMessage(l10n.t('A playground is already running. Wait for it to finish.'));
        return;
    }

    if (!evaluator) {
        evaluator = new PlaygroundEvaluator();
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
                    feedResultToSchemaStore(result, connection);

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
                    const errorMessage = error instanceof Error ? error.message : String(error);
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

/**
 * Maximum number of documents to feed to SchemaStore per execution.
 * If the result set is larger, a random sample of this size is used.
 */
const SCHEMA_DOC_CAP = 100;

/**
 * Very conservative schema feeding: only feed 'Cursor' and 'Document' result types.
 * Extracts documents from the printable result and adds them to SchemaStore.
 *
 * Caps at {@link SCHEMA_DOC_CAP} documents (randomly sampled if more).
 */
function feedResultToSchemaStore(result: ExecutionResult, connection: PlaygroundConnection): void {
    // Only feed known document-producing result types
    if (result.type !== 'Cursor' && result.type !== 'Document') {
        return;
    }

    const ns = result.source?.namespace;
    if (!ns?.collection) {
        return;
    }

    const printable = result.printable;
    if (printable === null || printable === undefined) {
        return;
    }

    // CursorIterationResult from @mongosh wraps documents in { cursorHasMore, documents }.
    // Only unwrap when the full wrapper shape is present to avoid false positives
    // on user documents that happen to have a `documents` field.
    let items: unknown[];
    if (
        typeof printable === 'object' &&
        !Array.isArray(printable) &&
        'cursorHasMore' in printable &&
        typeof (printable as Record<string, unknown>).cursorHasMore === 'boolean' &&
        'documents' in printable &&
        Array.isArray((printable as { documents: unknown }).documents)
    ) {
        items = (printable as { documents: unknown[] }).documents;
    } else if (Array.isArray(printable)) {
        items = printable;
    } else {
        items = [printable];
    }

    // Filter to actual document objects with _id (not primitives, not nested arrays,
    // not projection results with _id: 0 which have artificial shapes)
    let docs = items.filter(
        (d): d is WithId<Document> =>
            d !== null && d !== undefined && typeof d === 'object' && !Array.isArray(d) && '_id' in d,
    );

    if (docs.length === 0) {
        return;
    }

    // Cap at SCHEMA_DOC_CAP documents — randomly sample if more
    if (docs.length > SCHEMA_DOC_CAP) {
        docs = randomSample(docs, SCHEMA_DOC_CAP);
    }

    SchemaStore.getInstance().addDocuments(connection.clusterId, ns.db, ns.collection, docs);
}

/**
 * Partial Fisher–Yates random sample of `count` items from `array`.
 * Only performs `count` swaps instead of shuffling the entire array.
 */
function randomSample<T>(array: T[], count: number): T[] {
    const n = Math.min(count, array.length);
    const copy = [...array];
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
}
