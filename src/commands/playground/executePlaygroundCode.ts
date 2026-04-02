/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    UserCancelledError,
    callWithTelemetryAndErrorHandling,
    openReadOnlyContent,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document, type WithId } from 'mongodb';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ScratchpadEvaluator } from '../../documentdb/scratchpad/ScratchpadEvaluator';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { formatError, formatResult } from '../../documentdb/scratchpad/resultFormatter';
import { type ExecutionResult, type ScratchpadConnection } from '../../documentdb/scratchpad/types';
import { getHostsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { addDomainInfoToProperties } from '../../documentdb/utils/getClusterMetadata';

/** Shared evaluator instance — lazily created, reused across runs. */
let evaluator: ScratchpadEvaluator | undefined;

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
 * Called when the scratchpad connection is cleared or when all scratchpad editors close.
 * The worker will be re-spawned lazily on the next Run.
 */
export function shutdownEvaluator(): void {
    void evaluator?.shutdown();
}

/**
 * Executes scratchpad code and displays the result in a read-only side panel.
 * Used by both `runAll` and `runSelected` commands.
 */
export type ScratchpadRunMode = 'runAll' | 'runSelected';

export async function executeScratchpadCode(code: string, runMode: ScratchpadRunMode): Promise<void> {
    const service = ScratchpadService.getInstance();
    const connection = service.getConnection();
    if (!connection) {
        return;
    }

    // Prevent concurrent runs — no queuing
    if (service.isExecuting) {
        return;
    }

    if (!evaluator) {
        evaluator = new ScratchpadEvaluator();
    }

    service.setExecuting(true);

    // callWithTelemetryAndErrorHandling automatically tracks:
    //   - duration (measured from callback start to end)
    //   - result: 'Succeeded' | 'Failed' | 'Canceled'
    //   - error / errorMessage (from thrown errors)
    // We add custom properties for scratchpad-specific analytics.
    await callWithTelemetryAndErrorHandling('scratchpad.execute', async (context) => {
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
                title: l10n.t('DocumentDB Scratchpad'),
                cancellable: true,
            },
            async (progress, token) => {
                let cancelled = false;

                token.onCancellationRequested(() => {
                    cancelled = true;
                    evaluator?.killWorker();
                });

                const startTime = Date.now();
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

                    const formattedOutput = formatResult(result, code, connection);
                    feedResultToSchemaStore(result, connection);

                    const resultLabel = l10n.t(
                        '{0}/{1} — Results',
                        connection.clusterDisplayName,
                        connection.databaseName,
                    );

                    await openReadOnlyContent(
                        { label: resultLabel, fullId: `scratchpad-results-${Date.now()}` },
                        formattedOutput,
                        '.jsonc',
                        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                    );

                    // result: 'Succeeded' is set automatically by the framework
                } catch (error: unknown) {
                    // Update session telemetry even on failure (worker may have spawned before failing)
                    context.telemetry.properties.sessionId = evaluator!.sessionId ?? 'none';
                    context.telemetry.properties.sessionEvalCount = String(evaluator!.sessionEvalCount);
                    context.telemetry.properties.authMethod = evaluator!.sessionAuthMethod ?? 'unknown';
                    context.telemetry.measurements.initDurationMs = evaluator!.lastInitDurationMs;

                    if (cancelled) {
                        // Throw UserCancelledError so framework marks result as 'Canceled'
                        throw new UserCancelledError('scratchpad.execute');
                    }

                    // Show our own error UI before re-throwing
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const durationMs = Date.now() - startTime;
                    const formattedOutput = formatError(error, code, durationMs, connection);

                    const errorLabel = l10n.t(
                        '{0}/{1} — Error',
                        connection.clusterDisplayName,
                        connection.databaseName,
                    );

                    await openReadOnlyContent(
                        { label: errorLabel, fullId: `scratchpad-error-${Date.now()}` },
                        formattedOutput,
                        '.jsonc',
                        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                    );

                    void vscode.window.showErrorMessage(l10n.t('Scratchpad execution failed: {0}', errorMessage));

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
 * Collects domain info from the scratchpad connection's cached credentials.
 * Reuses the same hashing logic as the connection metadata telemetry.
 */
function collectDomainTelemetry(
    connection: ScratchpadConnection,
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
function feedResultToSchemaStore(result: ExecutionResult, connection: ScratchpadConnection): void {
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
    const copy = [...array];
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(Math.random() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
}
