/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

    lines.push('## Static Analysis Results (already shown to user)');
    lines.push('');
    lines.push('The user has already seen the following analysis before requesting AI help.');
    lines.push('Your analysis should build on these results, not contradict them without explanation.');
    lines.push('');

    // Collection context
    lines.push('### Collection Context');
    if (totalCollectionDocs !== undefined && totalCollectionDocs > 0) {
        lines.push(`- Total documents in collection: ${totalCollectionDocs.toLocaleString()}`);
    }
    lines.push(`- Documents returned by query: ${stage2.documentsReturned.toLocaleString()}`);
    lines.push(`- Documents examined: ${stage2.totalDocsExamined.toLocaleString()}`);
    lines.push(`- Keys examined: ${stage2.totalKeysExamined.toLocaleString()}`);
    lines.push(`- Execution time: ${stage2.executionTimeMs}ms`);
    lines.push('');

    // Performance rating
    const rating = stage2.efficiencyAnalysis.performanceRating;
    lines.push(`### Performance Rating: ${rating.score.toUpperCase()}`);
    lines.push('');

    // Summary indicators
    lines.push('### Summary Indicators (4 cells shown to user)');
    lines.push(`- **Selectivity**: ${stage2.efficiencyAnalysis.selectivity ?? 'Unknown'}`);
    lines.push(`- **Index Used**: ${stage2.efficiencyAnalysis.indexUsed ?? 'None (collection scan)'}`);
    lines.push(
        `- **Fetch Overhead**: ${stage2.efficiencyAnalysis.fetchOverhead} (${stage2.efficiencyAnalysis.fetchOverheadKind})`,
    );
    lines.push(`- **In-Memory Sort**: ${stage2.efficiencyAnalysis.hasInMemorySort ? 'Yes' : 'No'}`);
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
