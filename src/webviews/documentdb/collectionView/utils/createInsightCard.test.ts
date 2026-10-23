/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { createInsightCardConfig } from './createInsightCard';

function rec(overrides: Partial<AIIndexRecommendation>): AIIndexRecommendation {
    return {
        action: 'none',
        indexSpec: {},
        indexName: '',
        shellCommand: '',
        justification: 'Some advice.',
        priority: 'medium',
        ...overrides,
    };
}

describe('createInsightCardConfig', () => {
    it('uses the kind field when present', () => {
        const card = createInsightCardConfig(rec({ kind: 'verify', justification: 'Run a hinted explain.' }), 2);
        expect(card).toMatchObject({
            type: 'insight',
            cardId: 'insight-2',
            kind: 'verify',
            title: 'Verify First',
            description: 'Run a hinted explain.',
        });
    });

    it.each([
        ['Query change: Add a limit.', 'query-change', 'Add a limit.'],
        ['Verify: Run a hinted explain.', 'verify', 'Run a hinted explain.'],
        ['Maintenance: Check TTL deletes.', 'maintenance', 'Check TTL deletes.'],
        ['Data model: Store a scalar.', 'data-model', 'Store a scalar.'],
        ['Support: Open a request.', 'support', 'Open a request.'],
    ])('derives the kind from the "%s" prefix and strips it', (justification, kind, description) => {
        const card = createInsightCardConfig(rec({ justification }), 0);
        expect(card.kind).toBe(kind);
        expect(card.description).toBe(description);
    });

    it('prefers the kind field and still strips a matching prefix', () => {
        const card = createInsightCardConfig(rec({ kind: 'maintenance', justification: 'Verify: Check it.' }), 0);
        expect(card.kind).toBe('maintenance');
        expect(card.description).toBe('Check it.');
    });

    it('falls back to a generic insight and keeps unknown prefixes', () => {
        const card = createInsightCardConfig(rec({ kind: 'mystery', justification: 'Note: keep this text.' }), 0);
        expect(card.kind).toBe('other');
        expect(card.title).toBe('Query Performance Insight');
        expect(card.description).toBe('Note: keep this text.');
    });

    it('omits an empty command and empty risks', () => {
        const card = createInsightCardConfig(rec({ shellCommand: '  ', risks: '' }), 0);
        expect(card.shellCommand).toBeUndefined();
        expect(card.details).toBeUndefined();
    });

    it('keeps the command and risks when provided', () => {
        const card = createInsightCardConfig(
            rec({ shellCommand: 'db.getCollection("c").find({}).explain()', risks: 'Changes results.' }),
            0,
        );
        expect(card.shellCommand).toBe('db.getCollection("c").find({}).explain()');
        expect(card.details).toBe('Changes results.');
    });
});
