/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Document } from 'mongodb';
import * as l10n from '@vscode/l10n';
import type { QueryInsightsAnalysisProfile, QueryInsightsMetric, QueryInsightsStage2Response } from '../../webviews/documentdb/collectionView/types/queryInsights';
import { ExplainPlanAnalyzer, type ExecutionStatsAnalysis } from './ExplainPlanAnalyzer';
import { StagePropertyExtractor } from './StagePropertyExtractor';
import { createFailedQueryResponse, transformStage2Response } from './transformations';
import { applyCountRating, asExplainObject, findCountedResult, getInitialExplainPlan, getPipelineStageNames } from './analysisProfiles';

export function analyzeExplainForStage2(
    explain: Document,
    totalDocs?: number,
    filter?: Document,
    profile: QueryInsightsAnalysisProfile = 'find',
    existingAnalysis?: ExecutionStatsAnalysis,
): QueryInsightsStage2Response {
    const initialPlan = getInitialExplainPlan(explain, profile);
    const stats = asExplainObject(initialPlan.executionStats);
    const counted = profile === 'count' ? findCountedResult(stats) : undefined;
    const analysisPlan = profile === 'count' && stats
        ? { ...initialPlan, executionStats: { ...stats, nReturned: counted ?? 0 } } : initialPlan;
    const analyzed = existingAnalysis ?? ExplainPlanAnalyzer.analyzeExecutionStats(analysisPlan, filter);
    const executionStages = stats?.executionStages as Document | undefined;
    if (executionStages) {
        analyzed.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(executionStages);
        const planner = initialPlan.queryPlanner as Document | undefined;
        const winningPlan = planner?.winningPlan as Document | undefined;
        if (winningPlan) {
            StagePropertyExtractor.enrichWithQueryPlannerInfo(analyzed.extendedStageInfo, winningPlan);
        }
    }
    if (analyzed.executionError) {
        const failed = createFailedQueryResponse(analyzed, explain);
        return profile === 'find' ? failed : { ...failed, analysisProfile: profile, notApplicable: [] };
    }
    if (profile === 'count') applyCountRating(analyzed, totalDocs);
    ExplainPlanAnalyzer.addIndexStrategyAdvisories(analyzed, totalDocs, analysisPlan, filter, { skipCoverage: profile === 'count' });
    const response = transformStage2Response(analyzed, profile === 'count' ? undefined : totalDocs);
    if (profile === 'find') return response;

    const notApplicable: QueryInsightsMetric[] = [];
    const analysisNotes: string[] = [];
    if (profile === 'count') {
        notApplicable.push('selectivity', 'fetchOverhead', 'inMemorySort', 'examinedToReturnedRatio');
        if (counted === undefined) notApplicable.push('documentsReturned');
        response.documentsReturned = counted ?? 0;
        response.efficiencyAnalysis.selectivity = null;
        response.concerns = response.concerns.filter((concern) => !concern.startsWith('High selectivity issue:'));
        analysisNotes.push(l10n.t('Count uses nCounted, not nReturned. Selectivity, returned-document efficiency, coverage and sort rules are not applicable. The rating uses index access and documents examined versus collection size.'));
        if (counted === undefined) analysisNotes.push(l10n.t('This explain does not expose nCounted; the count result is unavailable, not zero.'));
    } else {
        const stages = getPipelineStageNames(explain);
        let initialPrefix = true;
        const laterStages = Array.isArray(explain.stages) ? stages : stages.filter((stage) => {
            if (initialPrefix && (stage === '$match' || stage === '$sort')) return false;
            initialPrefix = false;
            return true;
        });
        response.unassessedPipelineStages = laterStages;
        const note = l10n.t('Only the initial index-backed stage ($match/$sort) is analyzed; later pipeline stages ({0}) are not rated.', laterStages.join(', ') || l10n.t('none reported'));
        analysisNotes.push(note);
        response.efficiencyAnalysis.performanceRating.diagnostics.push({
            diagnosticId: 'aggregate_initial_stage_only', type: 'neutral',
            message: l10n.t('Initial pipeline stage only'), details: note,
        });
        if (stages.includes('$sort') && !analyzed.hasInMemorySort) {
            notApplicable.push('inMemorySort');
            response.efficiencyAnalysis.performanceRating.diagnostics =
                response.efficiencyAnalysis.performanceRating.diagnostics.filter(
                    (diagnostic) => diagnostic.diagnosticId !== 'no_sorting_required' && diagnostic.diagnosticId !== 'efficient_sorting',
                );
        }
    }
    return { ...response, rawExecutionStats: explain, analysisProfile: profile, notApplicable, analysisNotes };
}
