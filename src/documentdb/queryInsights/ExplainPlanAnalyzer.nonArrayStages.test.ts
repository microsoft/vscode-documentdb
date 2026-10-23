/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { analyzeExplainForStage2 } from './analyzeExplainForStage2';
import { ExplainPlanAnalyzer } from './ExplainPlanAnalyzer';

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
