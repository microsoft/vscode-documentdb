/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { fixupDocumentDbExplain } from '../utils/fixupDocumentDbExplain';
import { analyzeExplainForStage2 } from './analyzeExplainForStage2';
import { isPrimaryKeyOrderScan } from './documentDbPlanRefinements';
import { ExplainPlanAnalyzer } from './ExplainPlanAnalyzer';
import { buildStaticAnalysisSummary } from './staticAnalysisSummary';
import { transformStage1Response } from './transformations';

const filter = { 'address.building': { $gte: 50000 } };
const runtimeFilterSet = [{ 'address.building': { $gte: 50000 } }, { $unknown: {} }];

/** Azure DocumentDB `find` on a non-indexed field: a streaming cursor walks `_id_` (from a real cluster). */
function primaryKeyWalkPlan(overrides: { indexFilterSet?: Document[]; indexName?: string } = {}): Document {
    const indexName = overrides.indexName ?? '_id_';
    const plannerIxscan: Document = {
        stage: 'IXSCAN',
        cursorScanType: 'streamingPrimaryKey',
        indexName,
        direction: 'Forward',
        indexUsage: {},
        runtimeFilterSet,
        estimatedTotalKeysExamined: 10782,
        ...(overrides.indexFilterSet ? { indexFilterSet: overrides.indexFilterSet } : {}),
    };
    return {
        explainVersion: 2,
        command:
            "db.runCommand({explain: { 'find' : 'restaurants', 'filter' : { 'address.building' : { '$gte' : 50000 } } }})",
        queryPlanner: {
            namespace: 'Yelp.restaurants',
            winningPlan: {
                stage: 'FETCH',
                cursorScanType: 'streamingPrimaryKey',
                runtimeFilterSet,
                estimatedTotalKeysExamined: 10782,
                inputStage: plannerIxscan,
            },
            indexCosts: [
                {
                    namespace: 'Yelp.restaurants',
                    costs: [{ indexName, selectivity: 1, boundarySelectivity: 1, estimatedTotalIndexEntries: 64694 }],
                },
            ],
        },
        executionStats: {
            nReturned: 10,
            executionTimeMillis: 50.221,
            executionStartAtTimeMillis: 4.449,
            totalDocsExamined: 64694,
            totalKeysExamined: 10,
            executionStages: {
                stage: 'FETCH',
                nReturned: 10,
                executionTimeMillis: 50.221,
                totalDocsExamined: 64694,
                totalKeysExamined: 10,
                totalDocsRemovedByRuntimeFilter: 64684,
                numBlocksFromCache: 65196,
                inputStage: {
                    stage: 'IXSCAN',
                    nReturned: 10,
                    executionTimeMillis: 50.221,
                    totalDocsExamined: 64694,
                    indexName,
                    indexUsage: {},
                    totalKeysExamined: 10,
                    totalDocsRemovedByRuntimeFilter: 64684,
                    numBlocksFromCache: 65196,
                },
            },
        },
        ok: 1,
    };
}

/** Native MongoDB `find` that genuinely uses `_id_` (no DocumentDB-only fields). */
function mongoIdScanPlan(): Document {
    const ixscan = {
        stage: 'IXSCAN',
        nReturned: 10,
        keysExamined: 10,
        indexName: '_id_',
        keyPattern: { _id: 1 },
        direction: 'forward',
        indexBounds: { _id: ['[MinKey, ObjectId("65000000000000000000000a")]'] },
    };
    return {
        queryPlanner: {
            namespace: 'Yelp.restaurants',
            winningPlan: { stage: 'FETCH', inputStage: { ...ixscan } },
            rejectedPlans: [],
        },
        executionStats: {
            executionSuccess: true,
            nReturned: 10,
            executionTimeMillis: 1,
            totalKeysExamined: 10,
            totalDocsExamined: 10,
            executionStages: { stage: 'FETCH', nReturned: 10, docsExamined: 10, inputStage: ixscan },
        },
        serverInfo: { version: '7.0.12' },
        ok: 1,
    };
}

const vCore = { domainInfo_isAzure: 'true', domainInfo_api: 'vCore' } as const;

describe('DocumentDB second pass: primary-key order scan', () => {
    it.each([
        ['as returned by the server', (): Document => primaryKeyWalkPlan()],
        [
            'after the Azure DocumentDB fixup',
            (): Document => {
                const plan = primaryKeyWalkPlan();
                fixupDocumentDbExplain(plan, vCore);
                return plan;
            },
        ],
    ])('reports a collection scan, not an index, %s', (_label, makePlan) => {
        const plan = makePlan();
        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(plan, filter);

        expect(analyzed.planRefinements).toEqual(['primaryKeyOrderScan']);
        expect(analyzed).toMatchObject({
            usedIndexes: [],
            isCollectionScan: true,
            isIndexScan: false,
            isCovered: false,
        });
        const ids = analyzed.performanceRating.diagnostics.map((d) => d.diagnosticId);
        expect(ids).not.toContain('index_used');
        expect(ids).toContain('full_collection_scan');
        expect(ids.indexOf('primary_key_order_scan')).toBe(ids.indexOf('full_collection_scan') + 1);
        expect(analyzed.performanceRating.score).toBe('poor');

        const stage2 = analyzeExplainForStage2(plan, 64694, filter, 'find');
        expect(stage2.efficiencyAnalysis.indexUsed).toBeNull();
        expect(stage2.efficiencyAnalysis.fetchOverheadKind).toBe('collectionScan');
        expect(stage2.executionStrategy).toBe('Collection Scan');
        expect(stage2.hadCollectionScan).toBe(true);

        const summary = buildStaticAnalysisSummary(stage2, 64694);
        expect(summary).toContain('- **Index Used**: None (collection scan)');
        expect(summary).toContain('**Collection read in _id order**');
        expect(summary).not.toContain('**Index used**');
    });

    it('keeps the full collection scan neutral for an unfiltered query', () => {
        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(primaryKeyWalkPlan(), {});
        const badge = analyzed.performanceRating.diagnostics.find((d) => d.diagnosticId === 'full_collection_scan');
        expect(badge?.type).toBe('neutral');
    });

    it('applies to the Stage 1 (queryPlanner) summary too', () => {
        const plan = primaryKeyWalkPlan();
        delete plan.executionStats;
        const stage1 = transformStage1Response(ExplainPlanAnalyzer.analyzeQueryPlanner(plan), 0);
        expect(stage1.efficiencyAnalysis.indexUsed).toBeNull();
        expect(stage1.efficiencyAnalysis.executionStrategy).toBe('Collection Scan');
    });

    it('keeps a real _id lookup (conditions in indexFilterSet) as an index scan', () => {
        const plan = primaryKeyWalkPlan({ indexFilterSet: [{ _id: { $gte: 'x' } }] });
        expect(isPrimaryKeyOrderScan(plan)).toBe(false);
        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(plan, { _id: { $gte: 'x' } });
        expect(analyzed.planRefinements).toEqual([]);
        expect(analyzed.usedIndexes).toEqual(['_id_']);
        expect(analyzed.performanceRating.diagnostics.map((d) => d.diagnosticId)).toContain('index_used');
    });

    it('keeps a secondary index on a streaming cursor as an index scan', () => {
        const plan = primaryKeyWalkPlan({ indexName: 'address.building_1' });
        expect(isPrimaryKeyOrderScan(plan)).toBe(false);
        expect(ExplainPlanAnalyzer.analyzeExecutionStats(plan, filter).usedIndexes).toEqual(['address.building_1']);
    });

    it('leaves native MongoDB plans that use _id_ untouched', () => {
        const plan = mongoIdScanPlan();
        expect(isPrimaryKeyOrderScan(plan)).toBe(false);
        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(plan, { _id: { $lte: 'x' } });
        expect(analyzed.planRefinements).toEqual([]);
        expect(analyzed.usedIndexes).toEqual(['_id_']);
        expect(analyzed.isIndexScan).toBe(true);
        expect(analyzed.performanceRating.diagnostics.map((d) => d.diagnosticId)).toContain('index_used');
    });
});
