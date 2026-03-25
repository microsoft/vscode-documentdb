/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document, type WithId } from 'mongodb';
import * as vscode from 'vscode';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ScratchpadEvaluator } from '../../documentdb/scratchpad/ScratchpadEvaluator';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { formatError, formatResult } from '../../documentdb/scratchpad/resultFormatter';
import { type ExecutionResult, type ScratchpadConnection } from '../../documentdb/scratchpad/types';

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
export async function executeScratchpadCode(code: string): Promise<void> {
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

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Running scratchpad…'),
            cancellable: true,
        },
        async (_progress, token) => {
            // Cancel kills the worker — user can re-run to respawn
            token.onCancellationRequested(() => {
                evaluator?.killWorker();
            });

            const startTime = Date.now();
            try {
                const result = await evaluator!.evaluate(connection, code);
                const formattedOutput = formatResult(result, code, connection);

                // Feed document results to SchemaStore for cross-tab schema sharing
                feedResultToSchemaStore(result, connection);

                const resultLabel = l10n.t('{0}/{1} — Results', connection.clusterDisplayName, connection.databaseName);

                await openReadOnlyContent(
                    { label: resultLabel, fullId: `scratchpad-results-${Date.now()}` },
                    formattedOutput,
                    '.jsonc',
                    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                );
            } catch (error: unknown) {
                const durationMs = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                const formattedOutput = formatError(error, code, durationMs, connection);

                const errorLabel = l10n.t('{0}/{1} — Error', connection.clusterDisplayName, connection.databaseName);

                await openReadOnlyContent(
                    { label: errorLabel, fullId: `scratchpad-error-${Date.now()}` },
                    formattedOutput,
                    '.jsonc',
                    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                );

                void vscode.window.showErrorMessage(l10n.t('Scratchpad execution failed: {0}', errorMessage));
            } finally {
                service.setExecuting(false);
            }
        },
    );
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

    // Normalize to array
    const items: unknown[] = Array.isArray(printable) ? printable : [printable];

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
 * Fisher–Yates shuffle-based random sample of `count` items from `array`.
 * Returns a new array of length `count` with randomly selected items.
 */
function randomSample<T>(array: T[], count: number): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
}
