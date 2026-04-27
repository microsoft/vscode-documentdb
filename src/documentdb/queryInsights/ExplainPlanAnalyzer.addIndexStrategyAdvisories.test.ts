/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { ExplainPlanAnalyzer, type ExecutionStatsAnalysis, type PerformanceDiagnostic } from './ExplainPlanAnalyzer';

/**
 * Helper to create a minimal ExecutionStatsAnalysis for testing addIndexStrategyAdvisories.
 */
function makeAnalysis(overrides: Partial<ExecutionStatsAnalysis> = {}): ExecutionStatsAnalysis {
    return {
        executionTimeMillis: 13,
        totalDocsExamined: 100,
        totalKeysExamined: 100,
        nReturned: 100,
        efficiencyRatio: 1.0,
        usedIndexes: ['someIndex_1'],
        isCollectionScan: false,
        isCovered: false,
        hasInMemorySort: false,
        isIndexScan: true,
        performanceRating: { score: 'excellent', diagnostics: [] },
        rawStats: {},
        ...overrides,
    };
}

/**
 * Helper to build a minimal explain result with optional isBitmap on the IXSCAN stage.
 */
function makeExplainResult(options: { isBitmap?: boolean; indexName?: string } = {}): Document {
    const ixscan: Document = {
        stage: 'IXSCAN',
        indexName: options.indexName ?? 'someIndex_1',
    };
    if (options.isBitmap !== undefined) {
        ixscan.isBitmap = options.isBitmap;
    }

    return {
        queryPlanner: {
            winningPlan: {
                stage: 'FETCH',
                inputStage: ixscan,
            },
        },
        executionStats: {
            nReturned: 100,
            executionTimeMillis: 13,
            totalDocsExamined: 100,
            totalKeysExamined: 100,
            executionStages: {
                stage: 'FETCH',
                inputStage: {
                    stage: 'IXSCAN',
                    indexName: options.indexName ?? 'someIndex_1',
                },
            },
        },
    };
}

function getDiagnosticIds(diagnostics: PerformanceDiagnostic[]): string[] {
    return diagnostics.map((d) => d.diagnosticId);
}

describe('ExplainPlanAnalyzer.addIndexStrategyAdvisories', () => {
    describe('bitmap_index badge', () => {
        it('adds bitmap_index badge when isBitmap is true on IXSCAN', () => {
            const analysis = makeAnalysis();
            const explainResult = makeExplainResult({ isBitmap: true });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            const ids = getDiagnosticIds(analysis.performanceRating.diagnostics);
            expect(ids).toContain('bitmap_index');

            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('neutral');
            expect(badge?.message).toContain('Bitmap');
        });

        it('does not add bitmap_index badge when isBitmap is absent', () => {
            const analysis = makeAnalysis();
            const explainResult = makeExplainResult();

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            const ids = getDiagnosticIds(analysis.performanceRating.diagnostics);
            expect(ids).not.toContain('bitmap_index');
        });

        it('does not add bitmap_index badge when isBitmap is false', () => {
            const analysis = makeAnalysis();
            const explainResult = makeExplainResult({ isBitmap: false });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            const ids = getDiagnosticIds(analysis.performanceRating.diagnostics);
            expect(ids).not.toContain('bitmap_index');
        });

        it('shows bitmap_index badge even when efficiency is high (≥90%)', () => {
            // This is the key difference from low_cardinality_index which is gated on efficiency < 90%
            const analysis = makeAnalysis({ efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({ isBitmap: true });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            const ids = getDiagnosticIds(analysis.performanceRating.diagnostics);
            expect(ids).toContain('bitmap_index');
            // low_cardinality_index should NOT appear because efficiency ≥ 90%
            expect(ids).not.toContain('low_cardinality_index');
        });

        it('does not add bitmap_index badge for collection scans', () => {
            const analysis = makeAnalysis({ isIndexScan: false, isCollectionScan: true });
            const explainResult = makeExplainResult({ isBitmap: true });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            const ids = getDiagnosticIds(analysis.performanceRating.diagnostics);
            expect(ids).not.toContain('bitmap_index');
        });

        it('does not affect performance score (purely informational)', () => {
            const analysis = makeAnalysis({ efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({ isBitmap: true });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('excellent');
        });
    });
});
