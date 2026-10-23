/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { fixupDocumentDbExplain } from '../utils/fixupDocumentDbExplain';
import { analyzeExplainForStage2 } from './analyzeExplainForStage2';
import { ExplainPlanAnalyzer } from './ExplainPlanAnalyzer';
import { buildStaticAnalysisSummary } from './staticAnalysisSummary';

function explainWith(executionStages: Document): Document {
    return {
        queryPlanner: { namespace: 'db.coll', winningPlan: { stage: 'COLLSCAN' } },
        executionStats: {
            executionSuccess: true,
            nReturned: 5,
            executionTimeMillis: 12,
            totalKeysExamined: 0,
            totalDocsExamined: 100,
            executionStages,
        },
    };
}

describe('ExplainPlanAnalyzer with non-array child stages', () => {
    it.each([
        ['shards as an object', { stage: 'COLLSCAN', nReturned: 5, shards: { s0: { stage: 'COLLSCAN' } } }],
        ['shards as a number', { stage: 'COLLSCAN', nReturned: 5, shards: 2 }],
        ['inputStages as an object', { stage: 'OR', nReturned: 5, inputStages: { a: { stage: 'COLLSCAN' } } }],
    ])('analyzes the plan when a stage has %s', (_label, executionStages) => {
        const explain = explainWith(executionStages);

        expect(() => ExplainPlanAnalyzer.analyzeExecutionStats(explain)).not.toThrow();
        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(explain);
        expect(analyzed.nReturned).toBe(5);
        expect(analyzed.totalDocsExamined).toBe(100);
        expect(() => analyzeExplainForStage2(explain, 1000, {}, 'find')).not.toThrow();
    });

    it('keeps the original explain untouched in rawStats', () => {
        const executionStages = { stage: 'COLLSCAN', shards: { s0: { stage: 'COLLSCAN' } } };
        const explain = explainWith(executionStages);

        const analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(explain);

        expect(analyzed.rawStats).toBe(explain);
        expect(executionStages.shards).toEqual({ s0: { stage: 'COLLSCAN' } });
    });
});

/** Azure DocumentDB plan where `_id_` only provides order: `indexUsage` is `{}`, not an array. */
function documentDbIdOrderPlan(): Document {
    const ixscan = {
        stage: 'IXSCAN',
        nReturned: 0,
        executionTimeMillis: 0.614,
        executionStartAtTimeMillis: 0.614,
        totalDocsExamined: 1000,
        indexName: '_id_',
        indexUsage: {},
        totalKeysExamined: 0,
        totalDocsRemovedByRuntimeFilter: 1000,
        numBlocksFromCache: 67,
    };
    const runtimeFilterSet = [{ 'address.building': { $gt: 30000 } }, { $unknown: {} }];
    return {
        explainVersion: 2,
        command: "db.runCommand({explain: { 'find' : 'restaurants', 'filter' : { 'address.building' : { '$gt' : 30000 } } }})",
        queryPlanner: {
            namespace: 'MyDatabase.restaurants',
            winningPlan: {
                stage: 'FETCH',
                cursorScanType: 'streamingPrimaryKey',
                runtimeFilterSet,
                estimatedTotalKeysExamined: 167,
                inputStage: {
                    stage: 'IXSCAN',
                    cursorScanType: 'streamingPrimaryKey',
                    indexName: '_id_',
                    direction: 'Forward',
                    indexUsage: {},
                    runtimeFilterSet,
                    estimatedTotalKeysExamined: 167,
                },
            },
        },
        executionStats: {
            nReturned: 0,
            executionTimeMillis: 0.614,
            executionStartAtTimeMillis: 0.614,
            totalDocsExamined: 1000,
            totalKeysExamined: 0,
            executionStages: {
                stage: 'FETCH',
                nReturned: 0,
                executionTimeMillis: 0.614,
                totalDocsExamined: 1000,
                totalKeysExamined: 0,
                totalDocsRemovedByRuntimeFilter: 1000,
                numBlocksFromCache: 67,
                inputStage: ixscan,
            },
        },
        ok: 1,
    };
}

describe('DocumentDB plan with indexUsage as an empty object', () => {
    const filter = { 'address.building': { $gt: 30000 } };

    it.each([
        ['as returned by the server', (): Document => documentDbIdOrderPlan()],
        [
            'after the Azure DocumentDB fixup',
            (): Document => {
                const plan = documentDbIdOrderPlan();
                fixupDocumentDbExplain(plan, { domainInfo_isAzure: 'true', domainInfo_api: 'vCore' });
                return plan;
            },
        ],
    ])('completes Stage 2 analysis %s', (_label, makePlan) => {
        const stage2 = analyzeExplainForStage2(makePlan(), 1000, filter, 'find');

        expect(stage2.documentsReturned).toBe(0);
        expect(stage2.totalDocsExamined).toBe(1000);
        // The `_id_` walk is a primary-key order scan, so it is reported as a collection scan.
        expect(stage2.usedIndexNames).toEqual([]);
        expect(stage2.hadCollectionScan).toBe(true);
        expect(() => buildStaticAnalysisSummary(stage2, 1000)).not.toThrow();
    });
});
