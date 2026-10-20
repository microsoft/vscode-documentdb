/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Document } from 'mongodb';
import type { QueryInsightsStage2Response } from '../../webviews/documentdb/collectionView/types/queryInsights';
import { ExplainPlanAnalyzer, type ExecutionStatsAnalysis } from './ExplainPlanAnalyzer';
import { StagePropertyExtractor } from './StagePropertyExtractor';
import { createFailedQueryResponse, transformStage2Response } from './transformations';

export function analyzeExplainForStage2(
    explain: Document,
    totalDocs?: number,
    filter?: Document,
    analyzed: ExecutionStatsAnalysis = ExplainPlanAnalyzer.analyzeExecutionStats(explain, filter),
): QueryInsightsStage2Response {
    const stats = explain.executionStats as Document | undefined;
    const executionStages = stats?.executionStages as Document | undefined;
    if (executionStages) {
        analyzed.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(executionStages);
        const planner = explain.queryPlanner as Document | undefined;
        const winningPlan = planner?.winningPlan as Document | undefined;
        if (winningPlan) {
            StagePropertyExtractor.enrichWithQueryPlannerInfo(analyzed.extendedStageInfo, winningPlan);
        }
    }
    if (analyzed.executionError) {
        return createFailedQueryResponse(analyzed, explain);
    }
    ExplainPlanAnalyzer.addIndexStrategyAdvisories(analyzed, totalDocs, explain, filter);
    return transformStage2Response(analyzed, totalDocs);
}
