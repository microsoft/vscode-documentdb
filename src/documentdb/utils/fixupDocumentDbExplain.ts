/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { type ClusterMetadata } from './getClusterMetadata';

/**
 * TEMPORARY WORKAROUNDS (connector-side).
 *
 * 1. **keysExamined**: When connected to Azure DocumentDB, the explain plan data for
 *    queries that do not use an index (COLLSCAN) reports `totalKeysExamined` equal to
 *    `totalDocsExamined`. The expected value is 0 since no index keys were examined.
 *
 * 2. **docsExamined with SORT**: When a SORT stage wraps the execution plan, the
 *    top-level `executionStats.totalDocsExamined` is incorrectly set to `nReturned`
 *    (documents returned) instead of the actual number of documents scanned by the
 *    underlying stage (e.g. COLLSCAN). The correct value is found deeper in the
 *    stage tree.
 *
 * These issues have been reported and these fixes will remain here until they are
 * fixed server-side.
 *
 * This function patches the explain result in flight so downstream UI and LLM
 * consumers see accurate metrics.
 *
 * No-op for non-DocumentDB clusters.
 */

/** Returns true when connected to Azure DocumentDB. */
export function isAzureDocumentDb(metadata: ClusterMetadata | undefined): boolean {
    return metadata?.domainInfo_isAzure === 'true' && metadata?.domainInfo_api === 'vCore';
}

/**
 * Patches the explain result **in place** to correct known Azure DocumentDB issues:
 * - `totalKeysExamined` / `keysExamined` for COLLSCAN plans
 * - `totalDocsExamined` when a SORT stage hides the real scan count
 *
 * The input document is mutated directly; the return value is the same reference.
 *
 * @returns The mutated explain result, or undefined if input was undefined.
 */
export function fixupDocumentDbExplain(
    explainResult: Document | undefined,
    metadata: ClusterMetadata | undefined,
): Document | undefined {
    if (!explainResult || !isAzureDocumentDb(metadata)) {
        return explainResult;
    }

    const queryPlanner = explainResult.queryPlanner as Document | undefined;
    if (!queryPlanner) {
        return explainResult;
    }

    if (planUsesNoIndex(queryPlanner.winningPlan as Document | undefined)) {
        // Zero out keysExamined in executionStats (top-level for unsharded, nested for sharded)
        zeroOutKeysExamined(explainResult.executionStats as Document | undefined);
    }

    // Fix totalDocsExamined when a SORT stage hides the actual scan count
    fixupTotalDocsExamined(explainResult.executionStats as Document | undefined);

    return explainResult;
}

/** True when no index scan stage appears anywhere in the plan tree. */
function planUsesNoIndex(plan: Document | undefined): boolean {
    if (!plan) return false;

    let hasIndexScan = false;
    walkStages(plan, (stage) => {
        const s = stage.stage as string | undefined;
        if (s === 'IXSCAN' || s === 'DISTINCT_SCAN' || s === 'COUNT_SCAN') {
            hasIndexScan = true;
        }
    });

    return !hasIndexScan;
}

function zeroOutKeysExamined(stats: Document | undefined): void {
    if (!stats) return;

    if (typeof stats.totalKeysExamined === 'number') {
        stats.totalKeysExamined = 0;
    }

    walkStages(stats.executionStages as Document | undefined, (stage) => {
        if (typeof stage.keysExamined === 'number') {
            stage.keysExamined = 0;
        }
    });

    // Sharded clusters nest per-shard executionStats
    const shards = stats.shards as Document[] | undefined;
    if (Array.isArray(shards)) {
        for (const shard of shards) {
            zeroOutKeysExamined(shard);
        }
    }
}

/**
 * Corrects `totalDocsExamined` when a SORT stage causes the top-level value
 * to be set to `nReturned` instead of the actual documents scanned.
 *
 * Walks the execution stage tree and uses the maximum `totalDocsExamined` found
 * at any stage. This is safe because:
 * - Without SORT, the leaf stage value already matches the top-level (no change).
 * - With SORT, the deeper scan stage (COLLSCAN/FETCH) has the true count.
 */
function fixupTotalDocsExamined(stats: Document | undefined): void {
    if (!stats) return;

    const stages = stats.executionStages as Document | undefined;
    if (stages) {
        const maxDocs = findMaxDocsExamined(stages);
        if (typeof stats.totalDocsExamined === 'number' && maxDocs > stats.totalDocsExamined) {
            stats.totalDocsExamined = maxDocs;
        }
    }

    // Sharded clusters nest per-shard executionStats
    const shards = stats.shards as Document[] | undefined;
    if (Array.isArray(shards)) {
        for (const shard of shards) {
            fixupTotalDocsExamined(shard);
        }
    }
}

/** Walks the stage tree and returns the maximum `totalDocsExamined` found. */
function findMaxDocsExamined(node: Document | undefined): number {
    let max = 0;
    walkStages(node, (stage) => {
        if (typeof stage.totalDocsExamined === 'number' && stage.totalDocsExamined > max) {
            max = stage.totalDocsExamined;
        }
    });
    return max;
}

function walkStages(node: Document | undefined, visit: (stage: Document) => void): void {
    if (!node || typeof node !== 'object') return;

    visit(node);

    const input = node.inputStage as Document | undefined;
    if (input) walkStages(input, visit);

    const inputs = node.inputStages as Document[] | undefined;
    if (Array.isArray(inputs)) inputs.forEach((s) => walkStages(s, visit));

    const shards = node.shards as Document[] | undefined;
    if (Array.isArray(shards)) shards.forEach((s) => walkStages(s, visit));
}
