/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { type QueryInsightsStage2Response } from '../../webviews/documentdb/collectionView/types/queryInsights';

/**
 * Builds a compact text summary of the Stage 2 static analysis results
 * for inclusion in the AI prompt context. The summary includes the
 * performance score, summary indicators, and all diagnostic badges
 * with their details, so the LLM knows what the user has already been told.
 *
 * @param stage2 - The Stage 2 response shown to the user
 * @param totalCollectionDocs - Total documents in the collection (if available)
 * @returns A structured text summary suitable for inclusion in an LLM prompt
 */
export function buildStaticAnalysisSummary(stage2: QueryInsightsStage2Response, totalCollectionDocs?: number): string {
    const lines: string[] = [];
    const profile = stage2.analysisProfile ?? 'find';
    const notApplicable = new Set(stage2.notApplicable ?? []);

    lines.push('## Static Analysis Results (already shown to user)');
    lines.push('');
    lines.push('The user has already seen the following analysis before requesting AI help.');
    lines.push('Your analysis should build on these results, not contradict them without explanation.');
    lines.push('');

    if (profile !== 'find') {
        lines.push(`### Analysis Profile: ${profile.toUpperCase()} (preview, tuned for find queries)`);
        if (profile === 'count') {
            lines.push('Count results come from nCounted, not nReturned. A count returning zero documents does NOT mean zero matches.');
            lines.push('Skipped rules: returned-document efficiency ratio, collection-return selectivity/coverage, fetch-overhead assessment, and sort assessment. These find rules do not apply to count commands.');
            lines.push('The count rating uses index access and examined documents versus collection size. Do not reinstate skipped find diagnostics or infer missing nCounted as zero.');
        } else {
            lines.push(notApplicable.has('documentsReturned')
                ? 'This optimized single-plan explain does not expose a separate cursor boundary. Initial-stage returns, selectivity and rating are unavailable; do not substitute final pipeline output.'
                : 'Only the initial cursor / pushed-down $match and $sort stage is analyzed. Documents passed to pipeline and selectivity refer to that stage, NOT final pipeline output.');
            lines.push(`Later pipeline stages not rated: ${(stage2.unassessedPipelineStages ?? []).join(', ') || 'none reported'}.`);
            lines.push('Do not treat the initial-stage score as a rating of the complete aggregation pipeline.');
            if (notApplicable.has('inMemorySort')) {
                lines.push('Skipped rule: no-in-memory-sort / efficient-sorting conclusion. A pipeline $sort exists, but the cursor plan cannot determine its memory or disk usage.');
            }
        }
        for (const note of stage2.analysisNotes ?? []) lines.push(`- ${note}`);
        lines.push('');
    }

    // Collection context
    lines.push('### Collection Context');
    if (totalCollectionDocs !== undefined && totalCollectionDocs > 0) {
        lines.push(`- Total documents in collection: ${totalCollectionDocs.toLocaleString()}`);
    }
    if (profile === 'count') {
        lines.push(notApplicable.has('documentsReturned')
            ? '- Documents counted (nCounted): Unavailable in this explain'
            : `- Documents counted (nCounted): ${stage2.documentsReturned.toLocaleString()}`);
    } else if (profile === 'aggregate') {
        lines.push(`- Documents passed to pipeline (initial cursor): ${notApplicable.has('documentsReturned') ? 'Unavailable in this explain' : stage2.documentsReturned.toLocaleString()}`);
    } else {
        lines.push(`- Documents returned by query: ${stage2.documentsReturned.toLocaleString()}`);
    }
    lines.push(`- Documents examined: ${stage2.totalDocsExamined.toLocaleString()}`);
    lines.push(`- Keys examined: ${stage2.totalKeysExamined.toLocaleString()}`);
    let timeLabel = 'Execution time';
    if (profile === 'aggregate') {
        timeLabel = 'Initial cursor execution time';
        if (stage2.executionTimeScope === 'optimized-plan') timeLabel = 'Optimized plan execution time';
        if (stage2.executionTimeScope === 'pipeline-estimate') timeLabel = 'Overall pipeline execution time (estimate, not cursor-only)';
    }
    lines.push(`- ${timeLabel}: ${notApplicable.has('executionTime') ? 'Unavailable' : `${stage2.executionTimeMs}ms`}`);
    lines.push('');

    // Performance rating
    const rating = stage2.efficiencyAnalysis.performanceRating;
    lines.push(notApplicable.has('performanceRating') ? '### Performance Rating: Not assessed for this profile'
        : `### Performance Rating: ${rating.score.toUpperCase()} (scale: Excellent > Good > Fair > Poor)`);
    lines.push('');

    // Summary indicators
    lines.push(profile === 'find' ? '### Summary Indicators (4 cells shown to user)' : '### Summary Indicators (applicable cells only)');
    const formattedSelectivity =
        stage2.efficiencyAnalysis.selectivity !== null
            ? formatSelectivityForSummary(stage2.efficiencyAnalysis.selectivity)
            : 'Unknown';
    if (profile !== 'count' && !notApplicable.has('selectivity')) {
        lines.push(`- **${profile === 'aggregate' ? 'Initial-stage selectivity' : 'Selectivity'}**: ${formattedSelectivity}`);
    }
    lines.push(`- **Index Used**: ${stage2.efficiencyAnalysis.indexUsed ?? (profile === 'find' ? 'None (collection scan)' : 'None reported')}`);
    if (profile !== 'count' && !notApplicable.has('fetchOverhead')) {
        lines.push(`- **Fetch Overhead**: ${stage2.efficiencyAnalysis.fetchOverhead} (${stage2.efficiencyAnalysis.fetchOverheadKind})`);
    }
    if (profile !== 'count') {
        let sortDescription = stage2.efficiencyAnalysis.hasInMemorySort ? 'Yes' : 'No';
        if (notApplicable.has('inMemorySort')) sortDescription = 'Not rated for pipeline $sort';
        lines.push(`- **In-Memory Sort**: ${sortDescription}`);
    }
    lines.push('');

    // Diagnostic badges
    if (rating.diagnostics.length > 0) {
        lines.push('### Diagnostic Badges (shown to user)');
        for (const diag of rating.diagnostics) {
            const typeLabel = diag.type === 'positive' ? '[+]' : diag.type === 'negative' ? '[-]' : '[i]';
            lines.push(`- ${typeLabel} **${diag.message}**: ${diag.details}`);
        }
        lines.push('');
    }

    // Concerns
    if (stage2.concerns.length > 0) {
        lines.push('### Concerns');
        for (const concern of stage2.concerns) {
            lines.push(`- ${concern}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Formats numeric selectivity for static analysis summary text.
 * Values between 0 and 0.1 are rendered as a threshold label.
 *
 * Keep this formatting in sync with the webview selectivity formatter so Stage 3
 * summary text and the UI display stay consistent for the same underlying values.
 * We intentionally kept this duplicated for now to avoid a broader refactor.
 *
 * @param selectivity - Raw selectivity percentage value
 * @returns Formatted selectivity string for summary output
 */
function formatSelectivityForSummary(selectivity: number): string {
    const locale = vscode.env?.language || 'en-US';
    if (selectivity > 0 && selectivity < 0.1) {
        return `below ${(0.1).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }
    return `${selectivity.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
