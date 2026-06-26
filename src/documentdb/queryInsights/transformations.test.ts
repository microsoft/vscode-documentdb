/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ExecutionStatsAnalysis } from './ExplainPlanAnalyzer';
import { transformStage2Response } from './transformations';

function createExecutionStatsAnalysis(overrides: Partial<ExecutionStatsAnalysis> = {}): ExecutionStatsAnalysis {
    return {
        executionTimeMillis: 12,
        totalDocsExamined: 1,
        totalKeysExamined: 1,
        nReturned: 1,
        efficiencyRatio: 1,
        usedIndexes: ['idx_a'],
        isCollectionScan: false,
        isCovered: false,
        hasInMemorySort: false,
        isIndexScan: true,
        performanceRating: {
            score: 'excellent',
            diagnostics: [],
        },
        rawStats: {},
        ...overrides,
    };
}

describe('transformStage2Response - selectivity computation', () => {
    it('returns numeric precision below 0.1% for non-zero selectivity', () => {
        const analyzed = createExecutionStatsAnalysis({
            nReturned: 1,
        });

        const result = transformStage2Response(analyzed, 12_000);

        expect(result.efficiencyAnalysis.selectivity).toBeCloseTo(0.008333333333333333, 10);
    });

    it('returns numeric percent at or above 0.1%', () => {
        const analyzed = createExecutionStatsAnalysis({
            nReturned: 1,
        });

        const result = transformStage2Response(analyzed, 1_000);

        expect(result.efficiencyAnalysis.selectivity).toBe(0.1);
    });
});
