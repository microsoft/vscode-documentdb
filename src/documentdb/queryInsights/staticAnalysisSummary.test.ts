/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QueryInsightsStage2Response } from '../../webviews/documentdb/collectionView/types/queryInsights';
import { buildStaticAnalysisSummary } from './staticAnalysisSummary';

function makeStage2Response(overrides: Partial<QueryInsightsStage2Response> = {}): QueryInsightsStage2Response {
    return {
        executionTimeMs: 50,
        totalKeysExamined: 100,
        totalDocsExamined: 100,
        documentsReturned: 50,
        examinedToReturnedRatio: 2.0,
        keysToDocsRatio: 1.0,
        executionStrategy: 'Index Scan + Fetch',
        indexUsed: true,
        usedIndexNames: ['rating_1'],
        hadInMemorySort: false,
        hadCollectionScan: false,
        isCoveringQuery: false,
        concerns: [],
        efficiencyAnalysis: {
            selectivity: '5.0%',
            indexUsed: 'rating_1',
            fetchOverhead: 'Direct fetch',
            fetchOverheadKind: 'directFetch',
            hasInMemorySort: false,
            performanceRating: {
                score: 'good',
                diagnostics: [
                    {
                        diagnosticId: 'high_efficiency_ratio',
                        type: 'positive',
                        message: 'High efficiency ratio',
                        details: 'Your query returns 50% of examined documents.',
                    },
                    {
                        diagnosticId: 'fast_execution',
                        type: 'positive',
                        message: 'Fast execution',
                        details: 'Query executed in 50ms.',
                    },
                    {
                        diagnosticId: 'index_used',
                        type: 'positive',
                        message: 'Index used',
                        details: 'The query used index "rating_1".',
                    },
                ],
            },
        },
        stages: [],
        rawExecutionStats: {},
        ...overrides,
    };
}

describe('buildStaticAnalysisSummary', () => {
    it('should include the header explaining context to the LLM', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).toContain('## Static Analysis Results');
        expect(summary).toContain('already shown to user');
        expect(summary).toContain('should build on these results');
    });

    it('should include collection context with total docs', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response(), 10000);
        expect(summary).toContain('Total documents in collection: 10,000');
        expect(summary).toContain('Documents returned by query: 50');
        expect(summary).toContain('Documents examined: 100');
    });

    it('should omit total docs when not available', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).not.toContain('Total documents in collection');
    });

    it('should include performance rating', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).toContain('### Performance Rating: GOOD');
    });

    it('should include all four summary indicators', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).toContain('**Selectivity**: 5.0%');
        expect(summary).toContain('**Index Used**: rating_1');
        expect(summary).toContain('**Fetch Overhead**: Direct fetch');
        expect(summary).toContain('**In-Memory Sort**: No');
    });

    it('should show Unknown when selectivity is null', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.selectivity = null;
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('**Selectivity**: Unknown');
    });

    it('should show None when no index used', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.indexUsed = null;
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('**Index Used**: None (collection scan)');
    });

    it('should show Yes for in-memory sort', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.hasInMemorySort = true;
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('**In-Memory Sort**: Yes');
    });

    it('should include diagnostic badges with type markers', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).toContain('[+] **High efficiency ratio**');
        expect(summary).toContain('[+] **Fast execution**');
        expect(summary).toContain('[+] **Index used**');
    });

    it('should use [-] marker for negative diagnostics', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.performanceRating.diagnostics = [
            {
                diagnosticId: 'full_collection_scan',
                type: 'negative',
                message: 'Full collection scan',
                details: 'Your query has filter criteria but no supporting index.',
            },
        ];
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('[-] **Full collection scan**');
    });

    it('should use [i] marker for neutral diagnostics', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.performanceRating.diagnostics = [
            {
                diagnosticId: 'low_cardinality_index',
                type: 'neutral',
                message: 'Low-cardinality index',
                details: 'The index has low cardinality.',
            },
        ];
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('[i] **Low-cardinality index**');
    });

    it('should include concerns when present', () => {
        const stage2 = makeStage2Response({
            concerns: ['Collection scan detected', 'In-memory sort required'],
        });
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('### Concerns');
        expect(summary).toContain('Collection scan detected');
        expect(summary).toContain('In-memory sort required');
    });

    it('should not include concerns section when empty', () => {
        const summary = buildStaticAnalysisSummary(makeStage2Response());
        expect(summary).not.toContain('### Concerns');
    });

    it('should produce a summary for a poor-performing collection scan query', () => {
        const stage2 = makeStage2Response({
            executionTimeMs: 2500,
            totalKeysExamined: 0,
            totalDocsExamined: 60000,
            documentsReturned: 5,
            examinedToReturnedRatio: 12000,
            keysToDocsRatio: null,
            executionStrategy: 'Collection Scan',
            indexUsed: false,
            usedIndexNames: [],
            hadInMemorySort: true,
            hadCollectionScan: true,
            concerns: ['Collection scan detected', 'In-memory sort required'],
            efficiencyAnalysis: {
                selectivity: '0.008%',
                indexUsed: null,
                fetchOverhead: 'Collection scan',
                fetchOverheadKind: 'collectionScan',
                hasInMemorySort: true,
                performanceRating: {
                    score: 'poor',
                    diagnostics: [
                        {
                            diagnosticId: 'very_low_efficiency_ratio',
                            type: 'negative',
                            message: 'Very low efficiency ratio',
                            details: 'Your query returns less than 1% of examined documents.',
                        },
                        {
                            diagnosticId: 'very_slow_execution',
                            type: 'negative',
                            message: 'Very slow execution',
                            details: 'Query took 2500ms to execute.',
                        },
                        {
                            diagnosticId: 'full_collection_scan',
                            type: 'negative',
                            message: 'Full collection scan',
                            details: 'Your query has filter criteria but no supporting index.',
                        },
                        {
                            diagnosticId: 'in_memory_sort',
                            type: 'negative',
                            message: 'In-memory sort required',
                            details: 'Database sorted results in memory.',
                        },
                    ],
                },
            },
        });
        const summary = buildStaticAnalysisSummary(stage2, 60000);
        expect(summary).toContain('Performance Rating: POOR');
        expect(summary).toContain('Total documents in collection: 60,000');
        expect(summary).toContain('Documents returned by query: 5');
        expect(summary).toContain('[-] **Very low efficiency ratio**');
        expect(summary).toContain('[-] **Full collection scan**');
        expect(summary).toContain('**In-Memory Sort**: Yes');
    });

    it('should produce a summary for a covered query', () => {
        const stage2 = makeStage2Response({
            totalDocsExamined: 0,
            totalKeysExamined: 50,
            documentsReturned: 50,
            isCoveringQuery: true,
            efficiencyAnalysis: {
                selectivity: '0.5%',
                indexUsed: 'status_1_createdAt_-1',
                fetchOverhead: 'Covered query',
                fetchOverheadKind: 'covered',
                hasInMemorySort: false,
                performanceRating: {
                    score: 'excellent',
                    diagnostics: [
                        {
                            diagnosticId: 'high_efficiency_ratio',
                            type: 'positive',
                            message: 'High efficiency ratio',
                            details: 'All examined documents were returned.',
                        },
                    ],
                },
            },
        });
        const summary = buildStaticAnalysisSummary(stage2, 10000);
        expect(summary).toContain('Performance Rating: EXCELLENT');
        expect(summary).toContain('Covered query (covered)');
    });

    it('should produce a summary with low-cardinality badge', () => {
        const stage2 = makeStage2Response();
        stage2.efficiencyAnalysis.performanceRating.diagnostics.push({
            diagnosticId: 'low_cardinality_index',
            type: 'neutral',
            message: 'Low-cardinality index',
            details:
                'The index on this field has low cardinality (few distinct values). This reduces index effectiveness and incurs unnecessary write overhead.',
        });
        const summary = buildStaticAnalysisSummary(stage2);
        expect(summary).toContain('[i] **Low-cardinality index**');
        expect(summary).toContain('low cardinality');
    });
});
