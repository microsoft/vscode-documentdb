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
 * Optionally includes scanKeys in the execution stats IXSCAN to simulate single/compound.
 */
function makeExplainResult(
    options: {
        isBitmap?: boolean;
        indexName?: string;
        scanKeys?: string[];
        rawIndexUsage?: Array<{ scanKeys: string[] }>;
        nReturned?: number;
    } = {},
): Document {
    const ixscan: Document = {
        stage: 'IXSCAN',
        indexName: options.indexName ?? 'someIndex_1',
    };
    if (options.isBitmap !== undefined) {
        ixscan.isBitmap = options.isBitmap;
    }

    const execIxscan: Document = {
        stage: 'IXSCAN',
        indexName: options.indexName ?? 'someIndex_1',
    };
    if (options.rawIndexUsage) {
        execIxscan.indexUsage = options.rawIndexUsage;
    } else if (options.scanKeys) {
        execIxscan.indexUsage = [{ scanKeys: options.scanKeys }];
    }

    return {
        queryPlanner: {
            winningPlan: {
                stage: 'FETCH',
                inputStage: ixscan,
            },
        },
        executionStats: {
            nReturned: options.nReturned ?? 100,
            executionTimeMillis: 13,
            totalDocsExamined: 100,
            totalKeysExamined: 100,
            executionStages: {
                stage: 'FETCH',
                inputStage: execIxscan,
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

        it('does not affect performance score when scanKeys is missing (cannot determine single-field)', () => {
            const analysis = makeAnalysis({ efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({ isBitmap: true });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('excellent');
        });

        it('does not demote score for single-field bitmap when selectivity < 20%', () => {
            // nReturned=100, totalDocs=1000 → 10% coverage, below threshold
            const analysis = makeAnalysis({ nReturned: 100, efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({
                isBitmap: true,
                scanKeys: ['key 1: [(isInequality: false, estimatedEntryCount: 100)]'],
            });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('excellent');
            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('neutral');
        });

        it('demotes score one level for single-field bitmap when selectivity >= 20%', () => {
            // nReturned=350, totalDocs=1000 → 35% coverage, above threshold
            const analysis = makeAnalysis({ nReturned: 350, efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({
                isBitmap: true,
                nReturned: 350,
                scanKeys: ['key 1: [(isInequality: false, estimatedEntryCount: 350)]'],
            });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('good'); // demoted from excellent
            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('negative');
        });

        it('does not demote score for compound bitmap index even with high selectivity', () => {
            // nReturned=500, totalDocs=1000 → 50% coverage, but compound (2 scanKeys)
            const analysis = makeAnalysis({ nReturned: 500, efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({
                isBitmap: true,
                nReturned: 500,
                scanKeys: [
                    'key 1: [(isInequality: false, estimatedEntryCount: 500)]',
                    'key 2: [(isInequality: false, estimatedEntryCount: 100)]',
                ],
            });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('excellent'); // not demoted
            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('neutral');
        });

        it('does not demote score when indexUsage has mixed single/multi-key entries', () => {
            // nReturned=500, totalDocs=1000 → 50% coverage, but multiple indexUsage entries
            // with a mix of key counts — conservatively treated as compound
            const analysis = makeAnalysis({ nReturned: 500, efficiencyRatio: 1.0 });
            const explainResult = makeExplainResult({
                isBitmap: true,
                nReturned: 500,
                rawIndexUsage: [
                    { scanKeys: ['key 1: [(isInequality: false, estimatedEntryCount: 500)]'] },
                    {
                        scanKeys: [
                            'key 1: [(isInequality: false, estimatedEntryCount: 500)]',
                            'key 2: [(isInequality: false, estimatedEntryCount: 100)]',
                        ],
                    },
                ],
            });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('excellent'); // not demoted
            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('neutral');
        });

        it('demotes from good to fair for single-field bitmap at 55% selectivity', () => {
            // Simulates the isFamilyFriendly demo case
            const analysis = makeAnalysis({
                nReturned: 550,
                efficiencyRatio: 1.0,
                performanceRating: { score: 'good', diagnostics: [] },
            });
            const explainResult = makeExplainResult({
                isBitmap: true,
                nReturned: 550,
                scanKeys: ['key 1: [(isInequality: false, estimatedEntryCount: 550)]'],
            });

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            expect(analysis.performanceRating.score).toBe('fair'); // demoted from good
        });

        it('does not demote when planner and exec IXSCAN have different index names', () => {
            // Simulates a plan where findStageInPlan returns different IXSCAN stages
            // for the planner (bitmap) vs execution stats (different index)
            const analysis = makeAnalysis({ nReturned: 500, efficiencyRatio: 1.0 });
            const explainResult: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'FETCH',
                        inputStage: {
                            stage: 'IXSCAN',
                            indexName: 'bitmapIndex_1',
                            isBitmap: true,
                        },
                    },
                },
                executionStats: {
                    nReturned: 500,
                    executionTimeMillis: 13,
                    totalDocsExamined: 100,
                    totalKeysExamined: 100,
                    executionStages: {
                        stage: 'FETCH',
                        inputStage: {
                            stage: 'IXSCAN',
                            indexName: 'otherIndex_1',
                            indexUsage: [
                                {
                                    scanKeys: [
                                        'key 1: [(isInequality: false, estimatedEntryCount: 500)]',
                                    ],
                                },
                            ],
                        },
                    },
                },
            };

            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, 1000, explainResult);

            // Badge should still appear (isBitmap is true) but not demote
            // because the exec IXSCAN doesn't match the bitmap planner IXSCAN
            expect(analysis.performanceRating.score).toBe('excellent');
            const badge = analysis.performanceRating.diagnostics.find((d) => d.diagnosticId === 'bitmap_index');
            expect(badge?.type).toBe('neutral');
        });
    });
});
