/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Second analysis pass for DocumentDB explain plans.
 *
 * The first pass (`@mongodb-js/explain-plan-helper`) reads any MongoDB API explain plan and
 * reports which indexes appear in it. Some DocumentDB plans use an index for a purpose that the
 * first pass cannot see, so this pass corrects the extracted access facts BEFORE the performance
 * rating is computed. Every rule here keys off fields that only DocumentDB emits, so plans from
 * other engines pass through unchanged.
 */

import * as l10n from '@vscode/l10n';
import { type Document } from 'mongodb';
import { type PerformanceDiagnostic } from './ExplainPlanAnalyzer';

/** How the plan reads documents, as extracted by the first pass. */
export interface PlanAccessFacts {
    usedIndexes: string[];
    isCollectionScan: boolean;
    isCovered: boolean;
    isIndexScan: boolean;
}

/** Stable identifiers of the corrections applied, for telemetry and tests. */
export type PlanRefinementId = 'primaryKeyOrderScan';

export interface PlanRefinementResult {
    facts: PlanAccessFacts;
    refinements: PlanRefinementId[];
    /** Explanatory badges to show next to the rating diagnostics. */
    diagnostics: PerformanceDiagnostic[];
}

const PRIMARY_KEY_INDEX = '_id_';
/** `cursorScanType` of DocumentDB's batched (streaming) cursor that resumes by primary key. */
const STREAMING_PRIMARY_KEY_CURSOR = 'streamingPrimaryKey';

function asDocument(value: unknown): Document | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Document) : undefined;
}

function collectStages(stage: Document | undefined, into: Document[] = []): Document[] {
    if (!stage) return into;
    into.push(stage);
    collectStages(asDocument(stage.inputStage), into);
    if (Array.isArray(stage.inputStages)) {
        for (const child of stage.inputStages) collectStages(asDocument(child), into);
    }
    return into;
}

function hasConditions(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

/**
 * True when a DocumentDB plan walks the `_id_` index only to page through the collection.
 *
 * A batched `find` runs as a streaming cursor that resumes from the last `(shard key, _id)` it
 * returned, so DocumentDB turns a sequential scan into a walk of the `_id_` index
 * (`cursorScanType: "streamingPrimaryKey"`). The explain then shows `IXSCAN` on `_id_`, but no
 * query condition is applied in the index (`indexFilterSet` is absent) and every document is read
 * and filtered afterwards (`runtimeFilterSet`): a collection scan. A real `_id` lookup or range
 * keeps its conditions in `indexFilterSet` and is not matched.
 */
export function isPrimaryKeyOrderScan(explain: Document): boolean {
    const winningPlan = asDocument(asDocument(explain.queryPlanner)?.winningPlan);
    const stages = collectStages(winningPlan);
    if (!stages.some((stage) => stage.cursorScanType === STREAMING_PRIMARY_KEY_CURSOR)) {
        return false;
    }
    const indexScans = stages.filter((stage) => typeof stage.indexName === 'string' || stage.stage === 'IXSCAN');
    return (
        indexScans.length > 0 &&
        indexScans.every((stage) => stage.indexName === PRIMARY_KEY_INDEX && !hasConditions(stage.indexFilterSet))
    );
}

/**
 * Applies the DocumentDB corrections to the facts extracted by the first pass.
 * Returns the facts unchanged (and no refinements) for every other plan.
 */
export function refineDocumentDbPlanFacts(explain: Document, facts: PlanAccessFacts): PlanRefinementResult {
    const onlyPrimaryKey =
        facts.usedIndexes.length > 0 && facts.usedIndexes.every((name) => name === PRIMARY_KEY_INDEX);
    if (!onlyPrimaryKey || !isPrimaryKeyOrderScan(explain)) {
        return { facts, refinements: [], diagnostics: [] };
    }
    return {
        facts: { usedIndexes: [], isCollectionScan: true, isCovered: false, isIndexScan: false },
        refinements: ['primaryKeyOrderScan'],
        diagnostics: [
            {
                diagnosticId: 'primary_key_order_scan',
                type: 'neutral',
                message: l10n.t('Collection read in _id order'),
                details: l10n.t(
                    'The plan lists an index scan on _id_, but no query condition is applied in that index. DocumentDB reads the documents in _id order so the results can be returned in batches, and checks every document against the filter afterwards. This is a full collection scan.\n\nKeys Examined counts only the documents that passed the filter, not every index entry that was read.',
                ),
            },
        ],
    };
}
