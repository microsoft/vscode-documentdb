/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it, vi } from 'vitest';
import { inspectStandaloneInput } from './queryInsightsStandaloneInput';
import { samplePlan } from './samplePlans';
import type { StandaloneInput } from './types';

vi.mock('vscode', () => ({ l10n: { t: (text: string): string => text } }));
vi.mock('../../../commands/llmEnhancedCommands/indexAdvisorCommands', () => ({
    CommandType: { Find: 'find', Aggregate: 'aggregate', Count: 'count' },
}));

const blank: StandaloneInput = {
    explain: '', query: '', commandType: 'auto', collectionStats: '', indexes: '',
    databaseName: '', collectionName: '', clusterType: 'documentdb',
};

describe('Configure-step inspection', () => {
    it('is not ready, and reports nothing, before an explain plan is pasted', () => {
        expect(inspectStandaloneInput(blank)).toEqual({ ready: false });
    });

    it.each([
        ['find', 'find', ['IXSCAN', 'FETCH', 'SORT']],
        ['aggregate', 'aggregate', ['COLLSCAN', '$group', '$sort']],
        ['count', 'count', ['COUNT_SCAN', 'COUNT']],
    ] as const)('parses the %s sample plan, its namespace, plan and query', (sample, command, stages) => {
        const result = inspectStandaloneInput({ ...blank, explain: samplePlan(sample) });
        expect(result.ready).toBe(true);
        expect(result.explain).toEqual({
            ok: true, detectedCommandType: command, databaseName: 'shop', collectionName: 'orders', planStages: stages,
        });
        expect(result.commandType).toBe(command);
        expect(result.queryIsExtracted).toBe(true);
        expect(result.query).toContain(sample === 'count' ? 'pending' : 'shipped');
    });

    it('reports the 1-based line and column of a syntax error', () => {
        const result = inspectStandaloneInput({ ...blank, explain: '{\n  "queryPlanner": {},\n  "executionStats": }' });
        expect(result.ready).toBe(false);
        expect(result.explain).toMatchObject({ ok: false, line: 3, column: 21 });
        expect(result.explain?.ok === false && result.explain.message).not.toMatch(/\(\d+:\d+\)/);
    });

    it('rejects parsable JSON that is not an explain plan', () => {
        expect(inspectStandaloneInput({ ...blank, explain: '{"ok": 1}' }).explain).toMatchObject({ ok: false });
    });

    it('summarizes optional context and flags each invalid field on its own', () => {
        const explain = samplePlan('find');
        const ok = inspectStandaloneInput({
            ...blank, explain, collectionStats: '{ count: 48210 }',
            indexes: "[ { v: 2, key: { _id: 1 }, name: '_id_' }, { key: { status: 1 }, name: 'status_1' } ]",
        });
        expect(ok.collectionStats).toEqual({ ok: true, documentCount: 48210 });
        expect(ok.indexes).toEqual({ ok: true, names: ['_id_', 'status_1'] });
        expect(ok.ready).toBe(true);

        const bad = inspectStandaloneInput({ ...blank, explain, collectionStats: '[]', indexes: '[{ name: }]' });
        expect(bad.collectionStats).toMatchObject({ ok: false, message: 'Collection statistics must be a JSON object.' });
        expect(bad.indexes).toMatchObject({ ok: false, line: 1 });
        expect(bad.explain?.ok).toBe(true);
        expect(bad.ready).toBe(false);
    });

    it('keeps a user query override and reports an invalid one without blocking explain detection', () => {
        const explain = samplePlan('find');
        expect(inspectStandaloneInput({ ...blank, explain, query: '{ priority: 1 }' })).toMatchObject({
            ready: true, queryIsExtracted: false,
        });
        const invalid = inspectStandaloneInput({ ...blank, explain, query: '{ priority: }' });
        expect(invalid.queryIssue).toMatchObject({ line: 1 });
        expect(invalid.explain?.ok).toBe(true);
        expect(invalid.ready).toBe(false);
        expect(inspectStandaloneInput({ ...blank, explain, commandType: 'aggregate', query: '{}' }).queryIssue).toBeDefined();
    });
});
