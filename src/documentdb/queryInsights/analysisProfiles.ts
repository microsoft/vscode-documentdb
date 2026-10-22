/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import type { Document } from 'mongodb';
import type { QueryInsightsAnalysisProfile } from '../../webviews/documentdb/collectionView/types/queryInsights';
import type { ExecutionStatsAnalysis } from './ExplainPlanAnalyzer';

export function asExplainObject(value: unknown): Document | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Document) : undefined;
}

export function getInitialExplainPlan(explain: Document, profile: QueryInsightsAnalysisProfile): Document {
    if (profile !== 'aggregate' || !Array.isArray(explain.stages)) return explain;
    const first = asExplainObject((explain.stages as unknown[])[0]);
    return asExplainObject(first?.$cursor) ?? asExplainObject(first?.$geoNearCursor) ?? explain;
}

export function getPipelineStageNames(explain: Document): string[] {
    if (Array.isArray(explain.stages)) {
        return (explain.stages as unknown[])
            .slice(1)
            .flatMap((stage) => Object.keys(asExplainObject(stage) ?? {}).filter((key) => key.startsWith('$')));
    }
    const pipeline = asExplainObject(explain.command)?.pipeline as unknown;
    if (!Array.isArray(pipeline)) return [];
    return pipeline.flatMap((stage) => Object.keys(asExplainObject(stage) ?? {}).filter((key) => key.startsWith('$')));
}

export function findCountedResult(value: unknown): number | undefined {
    const node = asExplainObject(value);
    if (!node) return undefined;
    if (typeof node.nCounted === 'number' && Number.isFinite(node.nCounted) && node.nCounted >= 0) {
        return node.nCounted;
    }
    const executionCount = findCountedResult(node.executionStages);
    if (executionCount !== undefined) return executionCount;
    const children: unknown[] = [node.inputStage];
    for (const key of ['inputStages', 'shards']) {
        if (Array.isArray(node[key])) children.push(...(node[key] as unknown[]));
    }
    const counts = children.map(findCountedResult).filter((count): count is number => count !== undefined);
    return counts.length > 0 ? counts.reduce((sum, count) => sum + count, 0) : undefined;
}

export function applyCountRating(analysis: ExecutionStatsAnalysis, totalDocs?: number): void {
    const indexed = analysis.usedIndexes.length > 0;
    const examinedFraction = totalDocs && totalDocs > 0 ? analysis.totalDocsExamined / totalDocs : undefined;
    let score: ExecutionStatsAnalysis['performanceRating']['score'];
    if (analysis.totalDocsExamined === 0) score = 'excellent';
    else if (indexed && examinedFraction !== undefined && examinedFraction < 0.1) score = 'excellent';
    else if (indexed && (examinedFraction === undefined || examinedFraction < 0.5)) score = 'good';
    else if (indexed || (examinedFraction !== undefined && examinedFraction < 0.5)) score = 'fair';
    else score = 'poor';
    const skipped = new Set([
        'no_matching_documents',
        'high_efficiency_ratio',
        'moderate_efficiency_ratio',
        'low_efficiency_ratio',
        'very_low_efficiency_ratio',
        'in_memory_sort',
        'efficient_sorting',
        'no_sorting_required',
    ]);
    analysis.performanceRating = {
        score,
        diagnostics: [
            ...analysis.performanceRating.diagnostics.filter((diagnostic) => !skipped.has(diagnostic.diagnosticId)),
            {
                diagnosticId: 'count_scan_work',
                type: score === 'excellent' || score === 'good' ? 'positive' : 'neutral',
                message: l10n.t('Count scan work'),
                details:
                    examinedFraction === undefined
                        ? l10n.t(
                              'The count examined {0} documents. Collection size is unavailable; the rating uses index access and examined documents, not returned-document selectivity.',
                              analysis.totalDocsExamined,
                          )
                        : l10n.t(
                              'The count examined {0}% of the collection. The rating uses index access and examined documents, not returned-document selectivity.',
                              (examinedFraction * 100).toFixed(1),
                          ),
            },
        ],
    };
}
