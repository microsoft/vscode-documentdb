/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { type ClusterMetadata } from './getClusterMetadata';

/**
 * TEMPORARY WORKAROUND (connector-side).
 *
 * When connected to Azure DocumentDB, the explain plan data for queries that do not
 * use an index (COLLSCAN) reports `totalKeysExamined` equal to `totalDocsExamined`.
 * The expected value is 0 since no index keys were examined. This issue has been
 * reported and this fix will remain here until it is fixed server-side.
 *
 * This function patches the explain result in flight so downstream UI and LLM
 * consumers see accurate metrics.
 *
 * No-op for non-DocumentDB clusters and for plans that use an index scan.
 */

/** Returns true when connected to Azure DocumentDB. */
export function isAzureDocumentDb(metadata: ClusterMetadata | undefined): boolean {
    return metadata?.domainInfo_isAzure === 'true' && metadata?.domainInfo_api === 'vCore';
}

/**
 * Patches the explain result to correct `totalKeysExamined` / `keysExamined` for
 * Azure DocumentDB when no index is used.
 *
 * @returns The (potentially mutated) explain result, or undefined if input was undefined.
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

    if (!planUsesNoIndex(queryPlanner.winningPlan as Document | undefined)) {
        return explainResult;
    }

    // Zero out keysExamined in executionStats (top-level for unsharded, nested for sharded)
    zeroOutKeysExamined(explainResult.executionStats as Document | undefined);

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
