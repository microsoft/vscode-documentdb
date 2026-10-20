/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStandaloneInput } from './queryInsightsStandaloneInput';
import { queryInsightsStandaloneRouter, type StandaloneRouterContext } from './queryInsightsStandaloneRouter';
import type { StandaloneInput } from './types';
import type { QueryInsightsStreamEvent } from '../collectionView/types/queryInsightsStream';

const mocks = vi.hoisted(() => ({ stream: vi.fn(), executeCommand: vi.fn(), openDocument: vi.fn() }));
vi.mock('vscode', () => ({ env: { language: 'en-US' }, l10n: { t: (text: string): string => text }, commands: { executeCommand: mocks.executeCommand } }));
vi.mock('../../../commands/llmEnhancedCommands/indexAdvisorCommands', () => ({
    CommandType: { Find: 'find', Aggregate: 'aggregate', Count: 'count' },
}));
vi.mock('../../../services/ai/QueryInsightsAIService', () => ({
    QueryInsightsAIService: class {
        getOptimizationRecommendationsStreaming = mocks.stream;
    },
}));
vi.mock('../../../utils/readOnlyJsonDocumentProvider', () => ({
    readOnlyJsonDocumentProvider: { openDocument: mocks.openDocument },
}));
vi.mock('../../_integration/trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    const trpc = initTRPC.create();
    return { router: trpc.router, publicProcedure: trpc.procedure, publicProcedureWithTelemetry: trpc.procedure };
});

const explain = {
    queryPlanner: { namespace: 'db.items', winningPlan: { stage: 'COLLSCAN', direction: 'forward' }, parsedQuery: { status: 'active' } },
    executionStats: { executionSuccess: true, executionTimeMillis: 12, nReturned: 2, totalDocsExamined: 100, totalKeysExamined: 0,
        executionStages: { stage: 'COLLSCAN', nReturned: 2, docsExamined: 100 } },
    command: { find: 'items', filter: { status: 'active' }, sort: { date: -1 } },
};
const input: StandaloneInput = {
    explain: JSON.stringify(explain), query: '', commandType: 'auto',
    collectionStats: '{"count":200}', indexes: '[{"name":"status_1","key":{"status":1}}]',
    databaseName: 'db', collectionName: 'items', clusterType: 'documentdb', modelId: 'picked-model',
};

describe('Connectionless Query Insights', () => {
    beforeEach(() => vi.clearAllMocks());

    it('extracts a find query, supplied stats and indexes without a session', () => {
        const parsed = parseStandaloneInput(input);
        expect(parsed.commandType).toBe('find');
        expect(parsed.queryObject).toEqual({ filter: { status: 'active' }, sort: { date: -1 }, projection: undefined });
        expect(parsed.totalDocs).toBe(200);
        expect(parsed.indexStats?.[0].name).toBe('status_1');
    });

    it('accepts relaxed JSON and Extended JSON', () => {
        const parsed = parseStandaloneInput({ ...input, query: "{status: 'active', id: {$oid: '507f1f77bcf86cd799439011'}}" });
        expect(parsed.queryObject?.filter?.status).toBe('active');
        expect(String(parsed.queryObject?.filter?.id)).toBe('507f1f77bcf86cd799439011');
    });

    it.each(['aggregate', 'count'] as const)('detects %s and allows explicit command overrides', (commandType) => {
        const command = commandType === 'aggregate' ? { aggregate: 'items', pipeline: [{ $match: { status: 'active' } }] }
            : { count: 'items', query: { status: 'active' } };
        const parsed = parseStandaloneInput({ ...input, explain: JSON.stringify({ ...explain, command }) });
        expect(parsed.commandType).toBe(commandType);
        expect(parsed.queryObject).toBeUndefined();
        expect(parseStandaloneInput({ ...input, commandType: 'count' }).commandType).toBe('count');
    });

    it('uses parsedQuery when the command is absent and preserves edited query objects', () => {
        expect(parseStandaloneInput({ ...input, explain: JSON.stringify({ queryPlanner: explain.queryPlanner }) }).filter)
            .toEqual({ status: 'active' });
        expect(parseStandaloneInput({ ...input, query: '{"filter":{"priority":1},"limit":5}' }).queryObject)
            .toEqual({ filter: { priority: 1 }, limit: 5 });
    });

    it.each([
        { explain: '{}' }, { explain: 'not JSON' }, { collectionStats: '[]' }, { indexes: '{}' },
        { indexes: '[1]' }, { query: '[]' }, { commandType: 'aggregate' as const, query: '{}' },
    ])('rejects invalid supplied input: %j', (change) => {
        expect(() => parseStandaloneInput({ ...input, ...change })).toThrow();
    });

    it('exposes prefill and the same Stage 2 metrics without requiring cluster/session ids', async () => {
        const caller = queryInsightsStandaloneRouter.createCaller({ prefill: { databaseName: 'db' } } as StandaloneRouterContext);
        expect(await caller.getPrefill()).toEqual({ databaseName: 'db' });
        expect(await caller.validateInput(input)).toMatchObject({ commandType: 'find' });
        expect(await caller.inspectInput(input)).toMatchObject({ ready: true, commandType: 'find', explain: { ok: true } });
        expect(await caller.inspectInput({ ...input, explain: '' })).toMatchObject({ ready: false });
        expect(await caller.getStage1(input)).toBeDefined();
        const stage2 = await caller.getStage2(input);
        expect(stage2.executionTimeMs).toBe(12);
        expect(stage2.documentsReturned).toBe(2);
        expect(stage2.efficiencyAnalysis.selectivity).toBe(1);
    });

    it('opens the explorer through the same contributed command and acknowledges the mutation', async () => {
        const caller = queryInsightsStandaloneRouter.createCaller({});
        expect(await caller.openExplorer({ databaseName: 'db' })).toBe(true);
        expect(mocks.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.queryInsights.exploreWithOwnInput', { databaseName: 'db' },
        );
    });

    it('opens supplied raw explain without using a Collection View session', async () => {
        const caller = queryInsightsStandaloneRouter.createCaller({});
        expect(await caller.openRawExplain(input)).toBe(true);
        expect(mocks.openDocument).toHaveBeenCalledWith('Raw Explain Output', expect.stringContaining('"queryPlanner"'));
    });

    it.each(['azure-documentdb', 'documentdb', 'other'] as const)('applies Azure DocumentDB explain fixups only for %s', (clusterType) => {
        const raw = {
            queryPlanner: { winningPlan: { stage: 'SORT', inputStage: { stage: 'COLLSCAN' } } },
            executionStats: {
                executionSuccess: true, nReturned: 2, totalDocsExamined: 2, totalKeysExamined: 2,
                executionStages: { stage: 'SORT', totalDocsExamined: 2, totalKeysExamined: 2, inputStage: {
                    stage: 'COLLSCAN', nReturned: 2, totalDocsExamined: 100, totalKeysExamined: 100, keysExamined: 100,
                } },
            },
        };
        for (const aggregate of [false, true]) {
            const pasted = aggregate ? { stages: [{ $cursor: raw }, { $group: { _id: null }, nReturned: 1 }] } : raw;
            const parsed = parseStandaloneInput({ ...input, clusterType, explain: JSON.stringify(pasted) });
            const fixed = aggregate ? (parsed.explain.stages as Array<{ $cursor: typeof raw }>)[0].$cursor : parsed.explain as unknown as typeof raw;
            expect(fixed.executionStats.totalDocsExamined).toBe(clusterType === 'azure-documentdb' ? 100 : 2);
            expect(fixed.executionStats.totalKeysExamined).toBe(clusterType === 'azure-documentdb' ? 0 : 2);
            if (clusterType === 'azure-documentdb') {
                expect(parsed.clusterInfo).toMatchObject({ domainInfo_isAzure: 'true', domainInfo_api: 'vCore' });
            }
        }
    });

    it('auto-detects a cursor-format aggregate without command metadata and uses its parsed filter', () => {
        const parsed = parseStandaloneInput({
            ...input, explain: JSON.stringify({ stages: [{ $cursor: { queryPlanner: explain.queryPlanner, executionStats: explain.executionStats } }, { $group: { _id: null }, nReturned: 1 }] }),
        });
        expect(parsed.commandType).toBe('aggregate');
        expect(parsed.filter).toEqual({ status: 'active' });
        expect(JSON.parse(parsed.query)).toEqual([{ $match: { status: 'active' } }, { $group: { _id: null } }]);
    });

    it('streams parser events, model metadata and supplied context; aborts on completion', async () => {
        const json = JSON.stringify({ analysis: 'Analysis', educationalContent: 'Education', improvements: [] });
        mocks.stream.mockResolvedValue({
            fragments: (async function* (): AsyncGenerator<string> { yield json.slice(0, 30); yield json.slice(30); })(),
            completion: Promise.resolve({ improvements: [], modelId: 'picked-model', modelDisplayName: 'Picked' }),
        });
        const caller = queryInsightsStandaloneRouter.createCaller({});
        const stream = await caller.streamStage3({ ...input, requestKey: 'request-1' });
        const events: QueryInsightsStreamEvent[] = [];
        for await (const event of stream) events.push(event);
        expect(events[0]).toMatchObject({ type: 'status', phase: 'connecting' });
        expect(events.some((event) => event.type === 'summary')).toBe(true);
        expect(events.at(-1)).toMatchObject({ type: 'complete', modelId: 'picked-model' });
        const args = mocks.stream.mock.calls[0] as unknown[];
        expect(args[0]).toBe('');
        expect(args[7]).toMatchObject({
            modelId: 'picked-model', commandType: 'find', collectionStats: { count: 200 },
            providedData: { clusterInfo: { platform: 'documentdb' } },
        });
        expect((args[5] as AbortSignal).aborted).toBe(true);
    });

    it('aborts on iterator return and does not start an already cancelled model request', async () => {
        const controller = new AbortController();
        const caller = queryInsightsStandaloneRouter.createCaller({ signal: controller.signal });
        const stream = (await caller.streamStage3({ ...input, requestKey: 'cancel' }))[Symbol.asyncIterator]();
        await stream.next();
        await stream.return?.();
        expect(mocks.stream).not.toHaveBeenCalled();
        controller.abort();
        const cancelled = (await caller.streamStage3({ ...input, requestKey: 'already-cancelled' }))[Symbol.asyncIterator]();
        expect(await cancelled.next()).toEqual({ done: true, value: undefined });
    });

    it.each(['count', 'aggregate'] as const)('sends the %s applicability summary to Stage 3', async (commandType) => {
        const json = '{"analysis":"Analysis","educationalContent":"Education","improvements":[]}';
        mocks.stream.mockResolvedValue({
            fragments: (async function* (): AsyncGenerator<string> { yield json; })(),
            completion: Promise.resolve({ improvements: [] }),
        });
        const stream = await queryInsightsStandaloneRouter.createCaller({}).streamStage3({
            ...input, commandType, query: commandType === 'aggregate' ? '[]' : '{}', requestKey: 'scope',
        });
        for await (const _event of stream) { /* drain the model response */ }
        const args = mocks.stream.mock.calls[0] as unknown[];
        expect(args[6]).toContain(`Analysis Profile: ${commandType.toUpperCase()}`);
        if (commandType === 'count') expect(args[6]).toContain('Skipped rules: returned-document efficiency ratio');
        else expect(args[6]).toContain('NOT final pipeline output');
        expect(args[7]).toMatchObject({ commandType });
    });
});
