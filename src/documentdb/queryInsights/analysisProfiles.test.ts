/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it } from 'vitest';
import { analyzeExplainForStage2 } from './analyzeExplainForStage2';
import { findCountedResult, getInitialExplainPlan } from './analysisProfiles';
import { ExplainPlanAnalyzer } from './ExplainPlanAnalyzer';
import { transformStage2Response } from './transformations';
import { StagePropertyExtractor } from './StagePropertyExtractor';

function cursorPlan(): Record<string, unknown> {
    return {
        queryPlanner: { namespace: 'db.items', winningPlan: { stage: 'COLLSCAN' } },
        executionStats: {
            executionSuccess: true, executionTimeMillis: 12, nReturned: 35,
            totalDocsExamined: 100, totalKeysExamined: 0,
            executionStages: { stage: 'COLLSCAN', nReturned: 35, docsExamined: 100 },
        },
    };
}

describe('Command-aware Stage 2 analysis profiles', () => {
    it('keeps the find transformation and advisories exactly as before', () => {
        const explain = cursorPlan();
        const baseline = ExplainPlanAnalyzer.analyzeExecutionStats(explain, { status: 'active' });
        baseline.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(
            (explain.executionStats as { executionStages: Record<string, unknown> }).executionStages,
        );
        StagePropertyExtractor.enrichWithQueryPlannerInfo(
            baseline.extendedStageInfo, (explain.queryPlanner as { winningPlan: Record<string, unknown> }).winningPlan,
        );
        ExplainPlanAnalyzer.addIndexStrategyAdvisories(baseline, 200, explain, { status: 'active' });
        expect(analyzeExplainForStage2(cursorPlan(), 200, { status: 'active' }))
            .toEqual(transformStage2Response(baseline, 200));
    });

    it('analyzes cursor metrics and renders its stages, not the reduced aggregate output', () => {
        const cursor = cursorPlan();
        const explain = {
            stages: [
                { $cursor: cursor },
                { $group: { _id: '$status' }, nReturned: 1, executionTimeMillisEstimate: 500 },
                { $sort: { count: -1 }, nReturned: 1, executionTimeMillisEstimate: 700 },
            ],
        };
        const response = analyzeExplainForStage2(explain, 200, { status: 'active' }, 'aggregate');
        expect(response.analysisProfile).toBe('aggregate');
        expect(response.documentsReturned).toBe(35);
        expect(response.totalDocsExamined).toBe(100);
        expect(response.executionTimeMs).toBe(12);
        expect(response.efficiencyAnalysis.selectivity).toBe(17.5);
        expect(response.stages.map((stage) => stage.stage)).toEqual(['COLLSCAN']);
        expect(response.extendedStageInfo?.length).toBeGreaterThan(0);
        expect(response.unassessedPipelineStages).toEqual(['$group', '$sort']);
        expect(response.notApplicable).toContain('inMemorySort');
        expect(response.analysisNotes?.[0]).toContain('$group, $sort');
        expect(response.efficiencyAnalysis.performanceRating.diagnostics.map((diagnostic) => diagnostic.diagnosticId))
            .not.toContain('no_sorting_required');
        expect((cursor.executionStats as { nReturned: number }).nReturned).toBe(35);
        expect(getInitialExplainPlan(explain, 'aggregate')).toBe(cursor);
    });

    it('handles an optimized single-plan aggregate without inventing cursor stages', () => {
        const explain = { ...cursorPlan(), command: { aggregate: 'items', pipeline: [{ $match: { status: 'active' } }] } };
        const response = analyzeExplainForStage2(explain, 200, { status: 'active' }, 'aggregate');
        expect(response.documentsReturned).toBe(35);
        expect(response.stages[0].stage).toBe('COLLSCAN');
        expect(response.unassessedPipelineStages).toEqual([]);
        expect(response.efficiencyAnalysis.performanceRating.diagnostics)
            .toContainEqual(expect.objectContaining({ diagnosticId: 'aggregate_initial_stage_only', type: 'neutral' }));
    });

    it('keeps a known cursor SORT visible while warning that later pipeline stages are not rated', () => {
        const cursor = cursorPlan();
        const planner = { winningPlan: { stage: 'SORT', inputStage: { stage: 'COLLSCAN' } } };
        const stats = { ...(cursor.executionStats as Record<string, unknown>), executionStages: {
            stage: 'SORT', nReturned: 35, inputStage: { stage: 'COLLSCAN', nReturned: 35 },
        } };
        const response = analyzeExplainForStage2({
            stages: [{ $cursor: { queryPlanner: planner, executionStats: stats } }, { $sort: { status: 1 }, nReturned: 35 }],
        }, 200, {}, 'aggregate');
        expect(response.efficiencyAnalysis.hasInMemorySort).toBe(true);
        expect(response.notApplicable).not.toContain('inMemorySort');
    });

    it('does not label an optimized GROUP result as initial cursor throughput or rate its selectivity', () => {
        const base = cursorPlan();
        const response = analyzeExplainForStage2({
            ...base,
            queryPlanner: { winningPlan: { stage: 'GROUP', inputStage: { stage: 'COLLSCAN' } } },
            executionStats: { ...(base.executionStats as Record<string, unknown>), nReturned: 1,
                executionStages: { stage: 'GROUP', nReturned: 1, inputStage: { stage: 'COLLSCAN', nReturned: 35, docsExamined: 100 } } },
            command: { aggregate: 'items', pipeline: [{ $match: { status: 'active' } }, { $group: { _id: '$status' } }] },
        }, 200, { status: 'active' }, 'aggregate');
        expect(response.notApplicable).toEqual(expect.arrayContaining(['documentsReturned', 'selectivity', 'examinedToReturnedRatio', 'performanceRating']));
        expect(response.efficiencyAnalysis.selectivity).toBeNull();
        expect(response.analysisNotes?.[0]).toContain('does not expose a separate cursor boundary');
        expect(response.efficiencyAnalysis.performanceRating.diagnostics.some((diagnostic) => diagnostic.diagnosticId.includes('efficiency_ratio'))).toBe(false);
    });

    it.each([true, false])('does not invent zero cursor time when only a pipeline estimate is available: %s', (hasEstimate) => {
        const cursor = cursorPlan();
        const stats = { ...cursor.executionStats as Record<string, unknown> };
        delete stats.executionTimeMillis;
        const response = analyzeExplainForStage2({
            stages: [
                { $cursor: { ...cursor, executionStats: stats } },
                { $group: { _id: null }, nReturned: 1, ...(hasEstimate ? { executionTimeMillisEstimate: 500 } : {}) },
            ],
        }, 200, {}, 'aggregate');
        expect(response.documentsReturned).toBe(35);
        expect(response.notApplicable).toContain('performanceRating');
        if (hasEstimate) {
            expect(response.executionTimeMs).toBe(500);
            expect(response.executionTimeScope).toBe('pipeline-estimate');
            expect(response.notApplicable).not.toContain('executionTime');
        } else {
            expect(response.notApplicable).toContain('executionTime');
        }
        expect(response.efficiencyAnalysis.performanceRating.diagnostics.map((diagnostic) => diagnostic.diagnosticId))
            .not.toContain('fast_execution');
    });

    it('uses nCounted for COUNT_SCAN and does not punish an index-only count for nReturned=0', () => {
        const response = analyzeExplainForStage2({
            queryPlanner: { namespace: 'db.items', winningPlan: { stage: 'COUNT', inputStage: { stage: 'COUNT_SCAN', indexName: 'status_1', keyPattern: { status: 1 } } } },
            executionStats: {
                executionSuccess: true, executionTimeMillis: 1, nReturned: 0,
                totalDocsExamined: 0, totalKeysExamined: 80,
                executionStages: { stage: 'COUNT', nReturned: 0, nCounted: 80, inputStage: {
                    stage: 'COUNT_SCAN', indexName: 'status_1', keyPattern: { status: 1 }, keysExamined: 80,
                } },
            },
        }, 100, { status: 'active' }, 'count');
        expect(response.documentsReturned).toBe(80);
        expect(response.indexUsed).toBe(true);
        expect(response.efficiencyAnalysis.performanceRating.score).toBe('excellent');
        expect(response.efficiencyAnalysis.selectivity).toBeNull();
        expect(response.notApplicable).toEqual(expect.arrayContaining(['selectivity', 'fetchOverhead', 'inMemorySort', 'examinedToReturnedRatio']));
        const ids = response.efficiencyAnalysis.performanceRating.diagnostics.map((diagnostic) => diagnostic.diagnosticId);
        expect(ids).toContain('index_used');
        expect(ids).not.toContain('no_matching_documents');
        expect(ids).not.toContain('returns_majority_of_collection');
        expect(ids).not.toContain('low_filter_selectivity');
        expect(ids.some((id) => id.includes('efficiency_ratio'))).toBe(false);
    });

    it('rates a full-scan count by collection work even when nCounted=0', () => {
        const response = analyzeExplainForStage2({
            ...cursorPlan(),
            executionStats: { executionTimeMillis: 12, nReturned: 0, totalDocsExamined: 100, totalKeysExamined: 0,
                executionStages: { stage: 'COUNT', nCounted: 0, inputStage: { stage: 'COLLSCAN', docsExamined: 100 } } },
        }, 100, { missing: true }, 'count');
        expect(response.documentsReturned).toBe(0);
        expect(response.notApplicable).not.toContain('documentsReturned');
        expect(response.efficiencyAnalysis.performanceRating.score).toBe('poor');
        expect(response.efficiencyAnalysis.performanceRating.diagnostics.map((diagnostic) => diagnostic.diagnosticId))
            .not.toContain('no_matching_documents');
        expect(response.concerns.some((concern) => concern.includes('selectivity'))).toBe(false);
    });

    it('marks an absent nCounted as unavailable rather than claiming a zero result', () => {
        const response = analyzeExplainForStage2(cursorPlan(), 100, {}, 'count');
        expect(response.notApplicable).toContain('documentsReturned');
        expect(response.analysisNotes?.some((note) => note.includes('unavailable, not zero'))).toBe(true);
    });

    it('sums per-shard counted results once when summary statistics also repeat shard data', () => {
        const shards = [
            { executionStages: { stage: 'COUNT', nCounted: 30 } },
            { executionStages: { stage: 'COUNT', nCounted: 50 } },
        ];
        expect(findCountedResult({ executionStages: { stage: 'SHARD_MERGE', shards }, shards })).toBe(80);
    });
});
