/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { type QueryInsightsStage3Model } from '../collectionViewContext';
import { createImprovementCardConfig } from './createImprovementCard';
import { createInsightCardConfig } from './createInsightCard';

export interface OptimizationMarkdownInput {
    databaseName: string;
    collectionName: string;
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

/** Wraps content in a fence longer than any backtick run inside it. */
function fence(content: string, language = ''): string {
    const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
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
 * Builds a shareable Markdown document of the Optimization Opportunities section: every card in
 * display order, followed by the model, prompt source and the inputs the model received.
 */
export function buildOptimizationMarkdown(input: OptimizationMarkdownInput): string {
    const sections: string[] = [
        `# ${l10n.t('Query Insights: Optimization Opportunities')}`,
        `**${l10n.t('Collection')}**: \`${input.databaseName}.${input.collectionName}\` · ${input.generatedAt.toISOString()}`,
    ];
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
