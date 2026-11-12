/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { getAnalysisProfilePresentation } from '../../queryInsightsShared/analysisProfilePresentation';
import { type QueryInsightsStage3Model } from '../collectionViewContext';
import { formatCount, formatTime } from '../queryInsightsTab/components/metricsRow/formatUtils';
import { type PerformanceRating, type QueryInsightsStage2Response } from '../types/queryInsights';
import { createImprovementCardConfig } from './createImprovementCard';
import { createInsightCardConfig } from './createInsightCard';
import { formatSelectivityForDisplay } from './formatSelectivityForDisplay';
import { getVisibleDiagnostics } from './visibleDiagnostics';

/** The Stage 2 static analysis values the report shows. */
export type OptimizationStaticAnalysis = Pick<
    QueryInsightsStage2Response,
    | 'analysisProfile'
    | 'notApplicable'
    | 'executionTimeScope'
    | 'executionTimeMs'
    | 'documentsReturned'
    | 'totalDocsExamined'
    | 'totalKeysExamined'
> & {
    efficiencyAnalysis: Pick<
        QueryInsightsStage2Response['efficiencyAnalysis'],
        'selectivity' | 'indexUsed' | 'fetchOverhead' | 'hasInMemorySort' | 'performanceRating'
    >;
};

export interface OptimizationMarkdownInput {
    databaseName: string;
    collectionName: string;
    /** The "Query Efficiency Analysis" panel (static analysis). Omitted when it is not available. */
    staticAnalysis?: OptimizationStaticAnalysis;
    /** The "Query Performance Analysis" card (AI `analysis`). */
    analysis?: string;
    /** Shown as "Query Execution Failed" when the query itself failed. */
    executionErrors?: readonly string[];
    recommendations: readonly AIIndexRecommendation[];
    /** The "Understanding Your Query Execution Plan" card (AI `educationalContent`). */
    educational?: string;
    model?: QueryInsightsStage3Model;
    generatedAt: Date;
}

/** Shapes, not colors, carry the meaning so the report reads the same in any target. */
const ratingMarkers: Record<PerformanceRating['score'], string> = {
    excellent: '🔼',
    good: '🔼',
    fair: '⚠️',
    poor: '🔻',
};
const diagnosticMarkers: Record<PerformanceRating['diagnostics'][number]['type'], string> = {
    positive: '🔼',
    neutral: 'ℹ️',
    negative: '🔻',
};

function ratingLabel(score: PerformanceRating['score']): string {
    switch (score) {
        case 'excellent':
            return l10n.t('Excellent');
        case 'good':
            return l10n.t('Good');
        case 'fair':
            return l10n.t('Fair');
        default:
            return l10n.t('Poor');
    }
}

function staticAnalysisMarkdown(analysis: OptimizationStaticAnalysis): string {
    const profile = analysis.analysisProfile ?? 'find';
    const notApplicable = analysis.notApplicable ?? [];
    const isCount = profile === 'count';
    const efficiency = analysis.efficiencyAnalysis;
    const lines = [`## ${l10n.t('Query Efficiency Analysis')}`, ''];
    if (!notApplicable.includes('performanceRating')) {
        const score = efficiency.performanceRating.score;
        lines.push(`**${l10n.t('Performance Rating')}**: ${ratingMarkers[score]} ${ratingLabel(score)}`, '');
    }
    const metric = (label: string, value: string): void => {
        lines.push(`- **${label}**: ${value}`);
    };
    if (!notApplicable.includes('executionTime')) {
        metric(
            analysis.executionTimeScope === 'pipeline-estimate'
                ? l10n.t('Overall execution time (estimate)')
                : l10n.t('Execution Time'),
            formatTime(analysis.executionTimeMs),
        );
    }
    if (!notApplicable.includes('documentsReturned')) {
        metric(getAnalysisProfilePresentation(profile).resultLabel, formatCount(analysis.documentsReturned));
    }
    metric(l10n.t('Documents Examined'), formatCount(analysis.totalDocsExamined));
    metric(l10n.t('Keys Examined'), formatCount(analysis.totalKeysExamined));
    if (!isCount && !notApplicable.includes('selectivity')) {
        const lowSelectivityLabel = l10n.t(
            'below {0}%',
            (0.1).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        );
        metric(
            profile === 'aggregate' ? l10n.t('Initial-stage selectivity') : l10n.t('Selectivity'),
            formatSelectivityForDisplay(efficiency.selectivity, lowSelectivityLabel) ?? l10n.t('Not available'),
        );
    }
    metric(
        l10n.t('Index Used'),
        efficiency.indexUsed ? `\`${efficiency.indexUsed}\`` : l10n.t('None (collection scan)'),
    );
    if (!isCount && !notApplicable.includes('fetchOverhead')) {
        metric(l10n.t('Fetch Overhead'), efficiency.fetchOverhead);
    }
    if (!isCount && !notApplicable.includes('inMemorySort')) {
        metric(l10n.t('In-Memory Sort'), efficiency.hasInMemorySort ? l10n.t('Yes') : l10n.t('No'));
    }
    const diagnostics = notApplicable.includes('performanceRating')
        ? []
        : getVisibleDiagnostics(efficiency.performanceRating.diagnostics);
    if (diagnostics.length > 0) {
        lines.push('', `**${l10n.t('Diagnostics')}**`, '');
        for (const diagnostic of diagnostics) {
            lines.push(`- ${diagnosticMarkers[diagnostic.type]} ${diagnostic.message}`);
        }
    }
    return lines.join('\n');
}

/** Wraps content in a fence longer than any backtick run inside it. */
function fence(content: string, language = ''): string {
    const runs: readonly string[] = content.match(/`+/g) ?? [];
    const longestRun = Math.max(0, ...runs.map((run) => run.length));
    const ticks = '`'.repeat(Math.max(3, longestRun + 1));
    return `${ticks}${language}\n${content.replace(/\s+$/, '')}\n${ticks}`;
}

function priorityLabel(priority: AIIndexRecommendation['priority']): string {
    switch (priority) {
        case 'high':
            return l10n.t('High priority');
        case 'medium':
            return l10n.t('Medium priority');
        default:
            return l10n.t('Low priority');
    }
}

function recommendationMarkdown(recommendation: AIIndexRecommendation, index: number): string {
    const lines: string[] = [];
    if (recommendation.action === 'none') {
        const card = createInsightCardConfig(recommendation, index);
        lines.push(`### ${index + 1}. ${card.title} (${priorityLabel(card.priority)})`, '', card.description);
        if (card.shellCommand) lines.push('', fence(card.shellCommand, 'javascript'));
        if (card.details) lines.push('', `${l10n.t('Risks')}: ${card.details}`);
        return lines.join('\n');
    }
    const card = createImprovementCardConfig(recommendation, index, {
        clusterId: '',
        databaseName: '',
        collectionName: '',
    });
    lines.push(`### ${index + 1}. ${card.title} (${priorityLabel(card.priority)})`, '', card.description, '');
    if (recommendation.action === 'create') {
        lines.push(`**${l10n.t('Recommended Index')}**`, '', fence(card.recommendedIndex, 'json'));
    } else {
        lines.push(`**${l10n.t('Index Name')}**: \`${card.indexName}\``);
    }
    if (card.indexOptions) lines.push('', `**${l10n.t('Index Options')}**`, '', fence(card.indexOptions, 'json'));
    if (card.shellCommand) lines.push('', fence(card.shellCommand, 'javascript'));
    if (card.details) lines.push('', `${l10n.t('Risks')}: ${card.details}`);
    return lines.join('\n');
}

function configurationMarkdown(model: QueryInsightsStage3Model | undefined): string {
    const lines = [`## ${l10n.t('Query Insights Configuration')}`, ''];
    const name = model?.modelDisplayName ?? model?.modelId;
    const modelLabel = name
        ? model?.modelId && model.modelId !== name
            ? `${name} (\`${model.modelId}\`)`
            : name
        : l10n.t('Unknown');
    lines.push(`- **${l10n.t('Model')}**: ${modelLabel}`);
    if (model?.modelInputs?.promptSource) {
        lines.push(`- **${l10n.t('Prompt')}**: ${model.modelInputs.promptSource}`);
    }
    if (model?.durationMs !== undefined) {
        lines.push(`- **${l10n.t('Duration')}**: ${(model.durationMs / 1000).toFixed(1)} s`);
    }
    const usage = model?.usage;
    if (usage?.promptTokens !== undefined || usage?.responseTokens !== undefined) {
        lines.push(
            `- **${l10n.t('Tokens')}**: ${l10n.t('{0} in / {1} out', usage.promptTokens ?? '?', usage.responseTokens ?? '?')}${
                usage.usageSource === 'estimated' ? ` (${l10n.t('estimated')})` : ''
            }`,
        );
    }
    if (usage?.credits !== undefined) {
        lines.push(`- **${l10n.t('Credits')}**: ${usage.credits}`);
    }

    const inputs = model?.modelInputs;
    lines.push('', `### ${l10n.t('Inputs sent to the model')}`, '');
    if (!inputs) {
        lines.push(l10n.t('Not available for this analysis.'));
        return lines.join('\n');
    }
    lines.push(
        l10n.t('Exactly as sent, after literal values in filters were masked. The instruction prompt is not included.'),
        '',
        `#### ${l10n.t('Query')}`,
        '',
        fence(inputs.userQuery, 'javascript'),
        '',
        `#### ${l10n.t('Context')}`,
        '',
        fence(inputs.contextData, 'markdown'),
    );
    return lines.join('\n');
}

/**
 * Builds the Query Insights report as Markdown: the static analysis, every Optimization
 * Opportunities card in display order, and the model with the inputs it received. This is the single
 * source of the report; "Copy as rich text" renders the same Markdown with inline styles.
 */
export function buildOptimizationMarkdown(input: OptimizationMarkdownInput): string {
    const sections: string[] = [
        `# ${l10n.t('Query Insights: Optimization Opportunities')}`,
        `**${l10n.t('Collection')}**: \`${input.databaseName}.${input.collectionName}\` · ${input.generatedAt.toISOString()}`,
    ];
    if (input.staticAnalysis) {
        sections.push(staticAnalysisMarkdown(input.staticAnalysis));
    }
    if (input.analysis?.trim()) {
        sections.push(`## ${l10n.t('Query Performance Analysis')}`, input.analysis.trim());
    }
    if (input.executionErrors && input.executionErrors.length > 0) {
        sections.push(`## ${l10n.t('Query Execution Failed')}`, input.executionErrors.join('\n\n'));
    }
    sections.push(`## ${l10n.t('Recommendations')}`);
    sections.push(
        input.recommendations.length > 0
            ? input.recommendations.map(recommendationMarkdown).join('\n\n')
            : l10n.t('No index changes recommended.'),
    );
    if (input.educational?.trim()) {
        sections.push(`## ${l10n.t('Understanding Your Query Execution Plan')}`, input.educational.trim());
    }
    sections.push('---', configurationMarkdown(input.model));
    return `${sections.join('\n\n')}\n`;
}
