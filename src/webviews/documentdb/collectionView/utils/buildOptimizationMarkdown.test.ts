/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildOptimizationMarkdown, type OptimizationMarkdownInput } from './buildOptimizationMarkdown';

const base: OptimizationMarkdownInput = {
    databaseName: 'shop',
    collectionName: 'orders',
    analysis: '### Performance Summary\nCollection scan.',
    recommendations: [
        {
            action: 'create',
            indexSpec: { status: 1, orderDate: -1 },
            indexOptions: { name: 'status_1_orderDate_-1' },
            indexName: 'status_1_orderDate_-1',
            shellCommand: 'db.getCollection("orders").createIndex({"status": 1, "orderDate": -1})',
            justification: 'Avoids the collection scan.',
            priority: 'high',
            risks: 'Adds write overhead.',
        },
        {
            action: 'none',
            kind: 'verify',
            indexSpec: {},
            indexName: '',
            shellCommand: 'db.getCollection("orders").find({}).explain("executionStats")',
            justification: 'Re-run the explain after the change.',
            priority: 'medium',
        },
        {
            action: 'modify',
            indexSpec: { status: 1 },
            indexName: 'status_1',
            shellCommand: 'db.getCollection("orders").hideIndex("status_1")',
            justification: 'Redundant after the compound index.',
            priority: 'low',
        },
    ],
    educational: '### Query Execution Overview\nCOLLSCAN then SORT.',
    model: {
        modelDisplayName: 'GPT-5',
        modelId: 'copilot-gpt-5',
        durationMs: 12_340,
        usage: { promptTokens: 19_000, responseTokens: 900, credits: 1, usageSource: 'provider' },
        modelInputs: {
            userQuery: 'db.orders.find({ status: "<value>" })',
            contextData: '## Collection Information\n- **Collection_Stats**: {"count": 48210}',
            promptSource: 'local-resource-file',
        },
    },
    generatedAt: new Date('2026-10-23T10:00:00Z'),
};

describe('buildOptimizationMarkdown', () => {
    it('lists the cards in display order, then the configuration', () => {
        const markdown = buildOptimizationMarkdown(base);
        const order = [
            '# Query Insights: Optimization Opportunities',
            '`shop.orders` · 2026-10-23T10:00:00.000Z',
            '## Query Performance Analysis',
            '### 1. Recommendation: Create Index (High priority)',
            '### 2. Verify (Medium priority)',
            '### 3. Recommendation: Modify Index (Low priority)',
            '## Understanding Your Query Execution Plan',
            '## Query Insights Configuration',
            '### Inputs sent to the model',
        ].map((text) => markdown.indexOf(text));
        expect(order.every((position) => position >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('includes index details, commands and risks', () => {
        const markdown = buildOptimizationMarkdown(base);
        expect(markdown).toContain('```json\n{\n  "status": 1,\n  "orderDate": -1\n}\n```');
        expect(markdown).toContain('**Index Options**');
        expect(markdown).toContain('```javascript\ndb.getCollection("orders").hideIndex("status_1")\n```');
        expect(markdown).toContain('**Index Name**: `status_1`');
        expect(markdown).toContain('Risks: Adds write overhead.');
        expect(markdown).toContain('Re-run the explain after the change.');
    });

    it('describes the model, prompt source, usage and the exact inputs', () => {
        const markdown = buildOptimizationMarkdown(base);
        expect(markdown).toContain('- **Model**: GPT-5 (`copilot-gpt-5`)');
        expect(markdown).toContain('- **Prompt**: local-resource-file');
        expect(markdown).toContain('- **Duration**: 12.3 s');
        expect(markdown).toContain('- **Tokens**: 19000 in / 900 out');
        expect(markdown).toContain('- **Credits**: 1');
        expect(markdown).toContain('```javascript\ndb.orders.find({ status: "<value>" })\n```');
        expect(markdown).toContain('```markdown\n## Collection Information');
    });

    it('says when the inputs are not available and when there are no recommendations', () => {
        const markdown = buildOptimizationMarkdown({
            ...base,
            recommendations: [],
            model: { modelDisplayName: 'GPT-5' },
        });
        expect(markdown).toContain('No index changes recommended.');
        expect(markdown).toContain('Not available for this analysis.');
        expect(markdown).toContain('- **Model**: GPT-5');
    });

    it('uses a longer fence when the content contains backticks', () => {
        const markdown = buildOptimizationMarkdown({
            ...base,
            model: {
                ...base.model,
                modelInputs: { userQuery: 'q', contextData: 'a ```json fence``` inside', promptSource: 'built-in' },
            },
        });
        expect(markdown).toContain('````markdown\na ```json fence``` inside\n````');
    });

    it('adds the execution error section when the query failed', () => {
        const markdown = buildOptimizationMarkdown({ ...base, executionErrors: ['Query timed out.'] });
        expect(markdown).toContain('## Query Execution Failed\n\nQuery timed out.');
    });

    it('leaves out the prompt source and the model inputs for the shareable summary', () => {
        expect(buildOptimizationMarkdown({ ...base, includeModelInputs: true })).toBe(buildOptimizationMarkdown(base));
        const markdown = buildOptimizationMarkdown({ ...base, includeModelInputs: false });
        expect(markdown).toContain('## Recommendations');
        expect(markdown).toContain('## Query Insights Configuration');
        expect(markdown).toContain('- **Model**: GPT-5 (`copilot-gpt-5`)');
        expect(markdown).toContain('- **Tokens**: 19000 in / 900 out');
        expect(markdown).not.toContain('**Prompt**');
        expect(markdown).not.toContain('local-resource-file');
        expect(markdown).not.toContain('Inputs sent to the model');
        expect(markdown).not.toContain('db.orders.find({ status: "<value>" })');
        expect(markdown).not.toContain('Collection_Stats');
    });
});
