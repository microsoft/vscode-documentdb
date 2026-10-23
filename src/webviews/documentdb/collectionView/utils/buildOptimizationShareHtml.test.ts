/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    buildOptimizationShareHtml,
    type OptimizationShareHtmlInput,
    type OptimizationShareMetrics,
} from './buildOptimizationShareHtml';

const metrics: OptimizationShareMetrics = {
    executionTimeMs: 12,
    documentsReturned: 2,
    totalDocsExamined: 100,
    totalKeysExamined: 0,
    efficiencyAnalysis: {
        selectivity: 0.05,
        indexUsed: null,
        fetchOverhead: 'Collection scan',
        hasInMemorySort: true,
        performanceRating: {
            score: 'poor',
            diagnostics: [
                { diagnosticId: 'collection_scan', type: 'negative', message: 'Collection scan', details: 'd' },
                { diagnosticId: 'fast_execution', type: 'positive', message: 'Fast execution', details: 'd' },
                { diagnosticId: 'sort', type: 'neutral', message: 'No sort', details: 'd' },
                { diagnosticId: 'hidden_positive', type: 'positive', message: 'Hidden positive', details: 'd' },
            ],
        },
    },
};

const base: OptimizationShareHtmlInput = {
    databaseName: 'shop',
    collectionName: 'items',
    analysis:
        '### Key Issues\n1. 🔻 Critical: collection scan over 64,694 documents.\n2. 🔼 Good: the filter is simple.',
    recommendations: [
        {
            action: 'create',
            indexSpec: { status: 1 },
            indexName: 'status_1',
            shellCommand: 'db.getCollection("items").createIndex({"status": 1})',
            justification: 'Avoids the collection scan.',
            priority: 'high',
            risks: 'Adds write overhead.',
        },
        {
            action: 'none',
            kind: 'verify',
            indexSpec: {},
            indexName: '',
            shellCommand: 'db.getCollection("items").find({}).explain("executionStats")',
            justification: 'Re-run the explain after the change.',
            priority: 'medium',
        },
        {
            action: 'none',
            kind: 'support',
            indexSpec: {},
            indexName: '',
            shellCommand: '',
            justification: 'Planner statistics could help.',
            priority: 'low',
        },
    ],
    educational: '### Query Execution Overview\nCOLLSCAN then **SORT**.',
    model: {
        modelDisplayName: 'Copilot utility',
        modelId: 'copilot-utility',
        modelInputs: {
            userQuery: 'SECRET_QUERY_TEXT',
            contextData: 'SECRET_CONTEXT_DATA',
            promptSource: 'SECRET_PROMPT_SOURCE',
        },
    },
    generatedAt: new Date('2026-10-23T10:00:00Z'),
    metrics,
};

function tableRows(html: string): string[][] {
    return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
        [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, '')),
    );
}

describe('buildOptimizationShareHtml', () => {
    it('starts with a header naming the collection, the date and the rating as text and shape', () => {
        const html = buildOptimizationShareHtml(base);
        const header = html.slice(0, html.indexOf('</table>'));
        expect(header).toContain('Query Insights · <code');
        expect(header).toContain('shop.items</code>');
        expect(header).toContain(
            base.generatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        );
        expect(header).toContain('Performance Rating');
        expect(header).toMatch(/background-color:#fde7e9;[^"]*">🔻 Poor<\/span>/);
    });

    it('maps every rating to a shape marker', () => {
        const rating = (score: OptimizationShareMetrics['efficiencyAnalysis']['performanceRating']['score']): string =>
            buildOptimizationShareHtml({
                ...base,
                metrics: {
                    ...metrics,
                    efficiencyAnalysis: {
                        ...metrics.efficiencyAnalysis,
                        performanceRating: { score, diagnostics: [] },
                    },
                },
            });
        expect(rating('excellent')).toContain('🔼 Excellent');
        expect(rating('good')).toContain('🔼 Good');
        expect(rating('fair')).toContain('⚠️ Fair');
        expect(rating('poor')).toContain('🔻 Poor');
    });

    it('lists the metrics as a two-column table', () => {
        const rows = tableRows(buildOptimizationShareHtml(base));
        const metricRows = rows.slice(rows.findIndex((row) => row[0] === 'Metric'));
        expect(metricRows.slice(0, 9)).toEqual([
            ['Metric', 'Value'],
            ['Execution Time', '12.00 ms'],
            ['Documents Returned', '2'],
            ['Documents Examined', '100'],
            ['Keys Examined', '0'],
            ['Selectivity', 'below 0.1%'],
            ['Index Used', 'None (collection scan)'],
            ['Fetch Overhead', 'Collection scan'],
            ['In-Memory Sort', 'Yes'],
        ]);
    });

    it('skips metrics that are not applicable', () => {
        const html = buildOptimizationShareHtml({
            ...base,
            metrics: {
                ...metrics,
                analysisProfile: 'aggregate',
                notApplicable: ['executionTime', 'inMemorySort', 'fetchOverhead', 'performanceRating'],
            },
        });
        const labels = tableRows(html).map((row) => row[0]);
        expect(labels).toContain('Documents passed to pipeline');
        expect(labels).toContain('Initial-stage selectivity');
        expect(labels).not.toContain('Execution Time');
        expect(labels).not.toContain('Fetch Overhead');
        expect(labels).not.toContain('In-Memory Sort');
        expect(html).not.toContain('Performance Rating');
        expect(html).not.toContain('Collection scan</li>');

        const count = buildOptimizationShareHtml({ ...base, metrics: { ...metrics, analysisProfile: 'count' } });
        const countLabels = tableRows(count).map((row) => row[0]);
        expect(countLabels).toContain('Documents counted');
        expect(countLabels).not.toContain('Selectivity');
        expect(count).not.toContain('Examined 100 documents');
    });

    it('shows the returned-to-examined bar with a caption', () => {
        const html = buildOptimizationShareHtml(base);
        expect(html).toContain('Examined 100 documents: 2 returned (2.0%)');
        expect(html).toMatch(/<td width="2%" style="width:2%;/);
        expect(html).toMatch(/<td width="98%" style="width:98%;/);
    });

    it('lists the visible static analysis badges with shape markers', () => {
        const html = buildOptimizationShareHtml(base);
        expect(html).toContain('🔼 Fast execution</li>');
        expect(html).toContain('ℹ️ No sort</li>');
        expect(html).toContain('🔻 Collection scan</li>');
        expect(html).not.toContain('Hidden positive');
        expect(html.indexOf('Fast execution')).toBeLessThan(html.indexOf('🔻 Collection scan'));
    });

    it('renders the sections in order', () => {
        const html = buildOptimizationShareHtml(base);
        const order = [
            '🔻 Poor',
            '>Query Efficiency Analysis</h2>',
            '>Metric</th>',
            '🔼 Fast execution',
            '>Query Performance Analysis</h2>',
            '>Key Issues</h3>',
            '>Recommendations</h2>',
            '>Understanding Your Query Execution Plan</h2>',
            '<strong>SORT</strong>',
            'Model: Copilot utility',
        ].map((text) => html.indexOf(text));
        expect(order.every((position) => position >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('renders the recommendations table with card titles, details and commands', () => {
        const html = buildOptimizationShareHtml(base);
        const rows = tableRows(html);
        const header = rows.findIndex((row) => row[0] === 'Priority');
        expect(rows[header]).toEqual(['Priority', 'Recommendation', 'Details', 'Command']);
        expect(rows[header + 1]).toEqual([
            'High',
            '1. Recommendation: Create IndexIndex Name: status_1',
            'Avoids the collection scan.Risks: Adds write overhead.',
            'db.getCollection(&quot;items&quot;).createIndex({&quot;status&quot;: 1})',
        ]);
        expect(rows[header + 2]).toEqual([
            'Medium',
            '2. Verify',
            'Re-run the explain after the change.',
            'db.getCollection(&quot;items&quot;).find({}).explain(&quot;executionStats&quot;)',
        ]);
        expect(rows[header + 3]).toEqual(['Low', '3. Contact Support', 'Planner statistics could help.', '']);
        expect(html).toMatch(/<code style="font-family:Consolas[^"]*white-space:pre-wrap;[^"]*">db\.getCollection/);
    });

    it('says when there are no recommendations and shows execution errors', () => {
        const html = buildOptimizationShareHtml({ ...base, recommendations: [], executionErrors: ['Timed out.'] });
        expect(html).toContain('No index changes recommended.');
        expect(html).toContain('>Query Execution Failed</h2>');
        expect(html).toContain('Timed out.');
        expect(html).not.toContain('>Priority</th>');
    });

    it('ends with a footer and leaves out the model inputs', () => {
        const html = buildOptimizationShareHtml(base);
        const footer = html.slice(html.lastIndexOf('<hr'));
        expect(footer).toContain('Model: Copilot utility');
        expect(footer).toContain('Generated by the DocumentDB extension for Visual Studio Code');
        expect(footer).toContain('AI responses may be inaccurate');
        expect(html).not.toMatch(/SECRET_|Inputs sent to the model|Query Insights Configuration/);
    });

    it('works without Stage 2 metrics', () => {
        const html = buildOptimizationShareHtml({ ...base, metrics: undefined });
        expect(html).not.toContain('Performance Rating');
        expect(html).not.toContain('>Metric</th>');
        expect(html).toContain('>Recommendations</h2>');
    });

    it('escapes every interpolated value and uses email-safe markup only', () => {
        const evil = '<script>alert("x")</script> & "quoted" \'single\'';
        const html = buildOptimizationShareHtml({
            ...base,
            databaseName: evil,
            collectionName: evil,
            analysis: `${evil}\n\n- ${evil}\n\n\`${evil}\``,
            educational: `\`\`\`\n${evil}\n\`\`\``,
            executionErrors: [evil],
            recommendations: [
                {
                    action: 'drop',
                    indexSpec: { [evil]: 1 },
                    indexName: evil,
                    shellCommand: `db.items.dropIndex("${evil}")`,
                    justification: evil,
                    risks: evil,
                    priority: 'high',
                },
                {
                    action: 'none',
                    indexSpec: {},
                    indexName: '',
                    shellCommand: evil,
                    justification: evil,
                    priority: 'low',
                },
            ],
            model: { modelDisplayName: evil },
            metrics: {
                ...metrics,
                efficiencyAnalysis: {
                    ...metrics.efficiencyAnalysis,
                    indexUsed: evil,
                    fetchOverhead: evil,
                    performanceRating: {
                        score: 'fair',
                        diagnostics: [{ diagnosticId: 'x', type: 'negative', message: evil, details: evil }],
                    },
                },
            },
        });
        expect(html).not.toContain('<script');
        expect(html).not.toContain('"quoted"');
        expect(html).not.toMatch(/&(?!(amp|lt|gt|quot|#39|nbsp);)/);
        expect(html).toContain(
            '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;single&#39;',
        );
        expect(html).not.toMatch(/<style|class=|var\(--|display:\s*flex|display:\s*grid|<img|<link|url\(/i);
        // Every attribute value is double-quoted, so no escaped value can open a new attribute.
        for (const tag of html.match(/<[a-z][^>]*>/g) ?? []) {
            expect(tag).toMatch(/^<[a-z0-9]+(\s+[a-z-]+="[^"]*")*\s*>$/);
        }
    });
});
