/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { getAnalysisProfilePresentation } from '../../queryInsightsShared/analysisProfilePresentation';
import { formatCount, formatTime } from '../queryInsightsTab/components/metricsRow/formatUtils';
import {
    type PerformanceDiagnostic,
    type PerformanceRating,
    type QueryInsightsStage2Response,
} from '../types/queryInsights';
import { type OptimizationMarkdownInput } from './buildOptimizationMarkdown';
import { createImprovementCardConfig } from './createImprovementCard';
import { createInsightCardConfig } from './createInsightCard';
import { formatSelectivityForDisplay } from './formatSelectivityForDisplay';
import {
    escapeHtml,
    markdownToEmailHtml,
    shareFontStack,
    shareMonospaceStack,
    sharePalette,
} from './markdownToEmailHtml';
import { getVisibleDiagnostics } from './visibleDiagnostics';

/** The Stage 2 static analysis values the report shows. */
export type OptimizationShareMetrics = Pick<
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

export interface OptimizationShareHtmlInput extends Omit<OptimizationMarkdownInput, 'includeModelInputs'> {
    /** Stage 2 static analysis. Omitted when it is not available. */
    metrics?: OptimizationShareMetrics;
}

const cellBorder = `border:1px solid ${sharePalette.border};`;
const tableStyle = 'border-collapse:collapse;margin:8px 0;';
const headerCellStyle = `${cellBorder}padding:6px 10px;background-color:${sharePalette.subtleBackground};text-align:left;vertical-align:top;font-weight:600;`;
const cellStyle = `${cellBorder}padding:6px 10px;text-align:left;vertical-align:top;`;
const sectionHeadingStyle = `margin:24px 0 8px 0;font-size:18px;font-weight:600;color:${sharePalette.text};`;
const paragraphStyle = `margin:8px 0;line-height:1.5;color:${sharePalette.text};`;
const mutedStyle = `color:${sharePalette.muted};`;
const inlineCodeStyle = `font-family:${shareMonospaceStack};font-size:90%;`;

/** Light backgrounds with dark text; the rating is always also given as text and a shape. */
const ratingStyles: Record<PerformanceRating['score'], { marker: string; background: string; border: string }> = {
    excellent: { marker: '🔼', background: '#dff6dd', border: '#9fd89f' },
    good: { marker: '🔼', background: '#e7f4e4', border: '#b4d8ae' },
    fair: { marker: '⚠️', background: '#fff4ce', border: '#f2d57a' },
    poor: { marker: '🔻', background: '#fde7e9', border: '#eeacb2' },
};

const diagnosticMarkers: Record<PerformanceDiagnostic['type'], string> = {
    positive: '🔼',
    negative: '🔻',
    neutral: 'ℹ️',
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

function priorityLabel(priority: AIIndexRecommendation['priority']): string {
    switch (priority) {
        case 'high':
            return l10n.t('High');
        case 'medium':
            return l10n.t('Medium');
        default:
            return l10n.t('Low');
    }
}

/** Escapes text and keeps its line breaks. */
function textHtml(value: string): string {
    return escapeHtml(value.trim()).replace(/\r?\n/g, '<br>');
}

function sectionHeading(title: string): string {
    return `<h2 style="${sectionHeadingStyle}">${escapeHtml(title)}</h2>`;
}

function headerHtml(input: OptimizationShareHtmlInput, generatedAt: string): string {
    const metrics = input.metrics;
    const showRating = !!metrics && !(metrics.notApplicable ?? []).includes('performanceRating');
    const panel = `padding:12px 16px;background-color:${sharePalette.subtleBackground};${cellBorder}vertical-align:middle;`;
    let rating = '';
    if (showRating) {
        const score = metrics.efficiencyAnalysis.performanceRating.score;
        const style = ratingStyles[score];
        rating = `<td align="right" style="${panel}border-left:0;text-align:right;white-space:nowrap;">
<div style="font-size:12px;${mutedStyle}">${escapeHtml(l10n.t('Performance Rating'))}</div>
<span style="display:inline-block;margin-top:4px;padding:4px 10px;background-color:${style.background};border:1px solid ${style.border};color:${sharePalette.text};font-size:15px;font-weight:600;">${style.marker} ${escapeHtml(ratingLabel(score))}</span>
</td>`;
    }
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px 0;">
<tr>
<td style="${panel}${showRating ? 'border-right:0;' : ''}">
<div style="font-size:20px;font-weight:600;color:${sharePalette.text};">${escapeHtml(l10n.t('Query Insights'))} · <code style="${inlineCodeStyle}">${escapeHtml(`${input.databaseName}.${input.collectionName}`)}</code></div>
<div style="margin-top:4px;font-size:12px;${mutedStyle}">${escapeHtml(generatedAt)}</div>
</td>
${rating}</tr>
</table>`;
}

function metricRows(metrics: OptimizationShareMetrics): [string, string][] {
    const profile = metrics.analysisProfile ?? 'find';
    const notApplicable = metrics.notApplicable ?? [];
    const isCount = profile === 'count';
    const analysis = metrics.efficiencyAnalysis;
    const rows: [string, string][] = [];
    if (!notApplicable.includes('executionTime')) {
        rows.push([
            metrics.executionTimeScope === 'pipeline-estimate'
                ? l10n.t('Overall execution time (estimate)')
                : l10n.t('Execution Time'),
            formatTime(metrics.executionTimeMs),
        ]);
    }
    if (!notApplicable.includes('documentsReturned')) {
        rows.push([getAnalysisProfilePresentation(profile).resultLabel, formatCount(metrics.documentsReturned)]);
    }
    rows.push([l10n.t('Documents Examined'), formatCount(metrics.totalDocsExamined)]);
    rows.push([l10n.t('Keys Examined'), formatCount(metrics.totalKeysExamined)]);
    if (!isCount && !notApplicable.includes('selectivity')) {
        const lowSelectivityLabel = l10n.t(
            'below {0}%',
            (0.1).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        );
        rows.push([
            profile === 'aggregate' ? l10n.t('Initial-stage selectivity') : l10n.t('Selectivity'),
            formatSelectivityForDisplay(analysis.selectivity, lowSelectivityLabel) ?? l10n.t('Not available'),
        ]);
    }
    rows.push([l10n.t('Index Used'), analysis.indexUsed ?? l10n.t('None (collection scan)')]);
    if (!isCount && !notApplicable.includes('fetchOverhead')) {
        rows.push([l10n.t('Fetch Overhead'), analysis.fetchOverhead]);
    }
    if (!isCount && !notApplicable.includes('inMemorySort')) {
        rows.push([l10n.t('In-Memory Sort'), analysis.hasInMemorySort ? l10n.t('Yes') : l10n.t('No')]);
    }
    return rows;
}

/** A proportional bar of returned vs. examined documents. The caption carries the meaning. */
function efficiencyBarHtml(metrics: OptimizationShareMetrics): string {
    const profile = metrics.analysisProfile ?? 'find';
    const notApplicable = metrics.notApplicable ?? [];
    if (
        profile === 'count' ||
        notApplicable.includes('examinedToReturnedRatio') ||
        notApplicable.includes('documentsReturned') ||
        metrics.totalDocsExamined <= 0
    ) {
        return '';
    }
    const ratio = Math.min(1, Math.max(0, metrics.documentsReturned / metrics.totalDocsExamined));
    const percent = (ratio * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const filled = ratio > 0 ? Math.max(1, Math.round(ratio * 100)) : 0;
    const bar = (width: number, color: string): string =>
        `<td width="${width}%" style="width:${width}%;height:8px;background-color:${color};font-size:0;line-height:0;">&nbsp;</td>`;
    const cells = [filled > 0 ? bar(filled, sharePalette.link) : '', filled < 100 ? bar(100 - filled, '#e0e0e0') : '']
        .filter(Boolean)
        .join('');
    const caption = l10n.t(
        'Examined {0} documents: {1} ({2}%)',
        formatCount(metrics.totalDocsExamined),
        getAnalysisProfilePresentation(profile).resultSummary(formatCount(metrics.documentsReturned)),
        percent,
    );
    return `<p style="${paragraphStyle}margin-bottom:4px;">${escapeHtml(caption)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;margin:0 0 8px 0;${cellBorder}">
<tr>${cells}</tr>
</table>`;
}

function metricsHtml(metrics: OptimizationShareMetrics): string {
    const rows = metricRows(metrics)
        .map(
            ([label, value]) =>
                `<tr><td style="${cellStyle}background-color:${sharePalette.subtleBackground};">${escapeHtml(label)}</td><td style="${cellStyle}">${escapeHtml(value)}</td></tr>`,
        )
        .join('\n');
    const parts = [
        sectionHeading(l10n.t('Query Efficiency Analysis')),
        `<table cellpadding="6" cellspacing="0" style="${tableStyle}min-width:320px;max-width:560px;">
<tr><th style="${headerCellStyle}">${escapeHtml(l10n.t('Metric'))}</th><th style="${headerCellStyle}">${escapeHtml(l10n.t('Value'))}</th></tr>
${rows}
</table>`,
        efficiencyBarHtml(metrics),
    ];
    if (!(metrics.notApplicable ?? []).includes('performanceRating')) {
        const diagnostics = getVisibleDiagnostics(metrics.efficiencyAnalysis.performanceRating.diagnostics);
        if (diagnostics.length > 0) {
            parts.push(
                `<ul style="margin:8px 0;padding-left:24px;color:${sharePalette.text};">
${diagnostics.map((d) => `<li style="margin:4px 0;">${diagnosticMarkers[d.type]} ${escapeHtml(d.message)}</li>`).join('\n')}
</ul>`,
            );
        }
    }
    return parts.filter(Boolean).join('\n');
}

interface RecommendationRow {
    priority: AIIndexRecommendation['priority'];
    title: string;
    indexName?: string;
    description: string;
    risks?: string;
    command?: string;
}

function recommendationRow(recommendation: AIIndexRecommendation, index: number): RecommendationRow {
    if (recommendation.action === 'none') {
        const card = createInsightCardConfig(recommendation, index);
        return {
            priority: card.priority,
            title: card.title,
            description: card.description,
            risks: card.details,
            command: card.shellCommand,
        };
    }
    const card = createImprovementCardConfig(recommendation, index, {
        clusterId: '',
        databaseName: '',
        collectionName: '',
    });
    return {
        priority: card.priority,
        title: card.title,
        indexName: card.indexName || undefined,
        description: card.description,
        risks: card.details,
        command: card.shellCommand?.trim() || undefined,
    };
}

function recommendationsHtml(recommendations: readonly AIIndexRecommendation[]): string {
    if (recommendations.length === 0) {
        return `<p style="${paragraphStyle}">${escapeHtml(l10n.t('No index changes recommended.'))}</p>`;
    }
    const rows = recommendations.map((recommendation, index) => {
        const row = recommendationRow(recommendation, index);
        const indexName = row.indexName
            ? `<div style="margin-top:4px;font-size:12px;${mutedStyle}">${escapeHtml(l10n.t('Index Name'))}: <code style="${inlineCodeStyle}">${escapeHtml(row.indexName)}</code></div>`
            : '';
        const risks = row.risks
            ? `<div style="margin-top:6px;${mutedStyle}"><strong>${escapeHtml(l10n.t('Risks'))}:</strong> ${textHtml(row.risks)}</div>`
            : '';
        const command = row.command
            ? `<code style="font-family:${shareMonospaceStack};font-size:12px;white-space:pre-wrap;overflow-wrap:break-word;">${escapeHtml(row.command)}</code>`
            : '';
        return `<tr>
<td style="${cellStyle}white-space:nowrap;">${escapeHtml(priorityLabel(row.priority))}</td>
<td style="${cellStyle}font-weight:600;">${index + 1}. ${escapeHtml(row.title)}${indexName}</td>
<td style="${cellStyle}">${textHtml(row.description)}${risks}</td>
<td style="${cellStyle}background-color:${sharePalette.subtleBackground};">${command}</td>
</tr>`;
    });
    const header = [l10n.t('Priority'), l10n.t('Recommendation'), l10n.t('Details'), l10n.t('Command')]
        .map((label) => `<th style="${headerCellStyle}">${escapeHtml(label)}</th>`)
        .join('');
    return `<table cellpadding="6" cellspacing="0" width="100%" style="${tableStyle}width:100%;">
<tr>${header}</tr>
${rows.join('\n')}
</table>`;
}

function footerHtml(input: OptimizationShareHtmlInput, generatedAt: string): string {
    const model = input.model?.modelDisplayName ?? input.model?.modelId ?? l10n.t('Unknown');
    const parts = [
        l10n.t('Model: {0}', model),
        generatedAt,
        l10n.t('Generated by the DocumentDB extension for Visual Studio Code'),
        l10n.t('AI responses may be inaccurate'),
    ];
    return `<hr style="border:0;border-top:1px solid ${sharePalette.border};margin:24px 0 8px 0;">
<p style="margin:0;font-size:12px;${mutedStyle}">${parts.map(escapeHtml).join(' · ')}</p>`;
}

/**
 * Builds the "Copy as rich text" report: an email-safe HTML fragment (inline styles and tables
 * only, a fixed light palette, no external resources) for email, Teams and Word. Unlike the
 * Markdown export it leaves out the inputs sent to the model.
 */
export function buildOptimizationShareHtml(input: OptimizationShareHtmlInput): string {
    const generatedAt = input.generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const sections: string[] = [headerHtml(input, generatedAt)];
    if (input.metrics) {
        sections.push(metricsHtml(input.metrics));
    }
    if (input.analysis?.trim()) {
        sections.push(sectionHeading(l10n.t('Query Performance Analysis')), markdownToEmailHtml(input.analysis));
    }
    if (input.executionErrors && input.executionErrors.length > 0) {
        sections.push(
            sectionHeading(l10n.t('Query Execution Failed')),
            ...input.executionErrors.map((error) => `<p style="${paragraphStyle}">${textHtml(error)}</p>`),
        );
    }
    sections.push(sectionHeading(l10n.t('Recommendations')), recommendationsHtml(input.recommendations));
    if (input.educational?.trim()) {
        sections.push(
            sectionHeading(l10n.t('Understanding Your Query Execution Plan')),
            markdownToEmailHtml(input.educational),
        );
    }
    sections.push(footerHtml(input, generatedAt));
    return `<div style="font-family:${shareFontStack};font-size:14px;line-height:1.5;color:${sharePalette.text};background-color:#ffffff;max-width:960px;">
${sections.join('\n')}
</div>`;
}
