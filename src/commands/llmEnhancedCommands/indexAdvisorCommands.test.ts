/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandType, optimizeQuery, optimizeQueryStreaming, type QueryOptimizationContext } from './indexAdvisorCommands';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    getAvailableModels: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    getTemplate: vi.fn(),
}));

vi.mock('vscode', () => ({
    LanguageModelChatMessage: { User: (text: string): { text: string } => ({ text }) },
    l10n: { t: (message: string): string => message },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class extends Error {},
}));
vi.mock('../../documentdb/ClusterSession', () => ({ ClusterSession: { getSession: mocks.getSession } }));
vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: { trace: vi.fn() } } }));
vi.mock('../../services/ai/modelSelection', () => ({ getAvailableModels: mocks.getAvailableModels }));
vi.mock('../../services/copilotService', () => ({
    CopilotService: { sendMessage: mocks.sendMessage, streamMessage: mocks.streamMessage },
}));
vi.mock('../../services/promptTemplateService', () => ({
    PromptTemplateService: { getIndexAdvisorPromptTemplate: mocks.getTemplate },
}));
vi.mock('./promptTemplates', () => ({ getLastPromptSource: (): string => 'custom-file' }));

function actionContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as IActionContext;
}

function providedContext(): QueryOptimizationContext {
    return {
        sessionId: '',
        databaseName: 'test',
        collectionName: 'items',
        commandType: CommandType.Find,
        queryObject: { filter: { status: 'active' } },
        executionPlan: { executionStats: { nReturned: 1 } },
        providedData: { clusterInfo: { domainInfo_isAzure: 'false' } },
        modelId: 'picked-model',
        staticAnalysisSummary: 'Static verdict',
    };
}

describe('Query Insights optimization inputs', () => {
    const response = {
        text: '{}',
        modelId: 'picked-model',
        modelFamily: 'picked-model',
        modelDisplayName: 'Picked model',
        modelVersion: '1',
        durationMs: 1,
    };

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getAvailableModels.mockResolvedValue({ models: [{ id: 'picked-model' }] });
        mocks.getTemplate.mockResolvedValue('Local prompt');
        mocks.sendMessage.mockResolvedValue(response);
    });

    it('builds exactly three messages without a session or fetching missing optional statistics', async () => {
        const context = actionContext();
        await optimizeQuery(context, providedContext());

        expect(mocks.getSession).not.toHaveBeenCalled();
        const [messages, options] = mocks.sendMessage.mock.calls[0] as [{ text: string }[], unknown];
        expect(messages).toHaveLength(3);
        expect(messages[0].text).toBe('Local prompt');
        expect(messages[1].text).toContain('"status": "active"');
        expect(messages[2].text).toContain('**Collection_Stats**: N/A');
        expect(messages[2].text).toContain('**Indexes_Stats**: N/A');
        expect(messages[2].text).toContain('"nReturned": 1');
        expect(messages[2].text).toContain('Static verdict');
        expect(options).toMatchObject({ modelSelection: 'user', modelId: 'picked-model' });
        expect(context.telemetry.properties.connectionless).toBe('true');
    });

    it('requires an execution plan in provided-data mode', async () => {
        await expect(optimizeQuery(actionContext(), { ...providedContext(), executionPlan: undefined })).rejects.toThrow(
            /execution plan is required/,
        );
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.getSession).not.toHaveBeenCalled();
    });

    it('uses the same provided-data messages and selection for streaming', async () => {
        mocks.streamMessage.mockReturnValue({ fragments: [], completion: Promise.resolve(response) });
        const handle = await optimizeQueryStreaming(actionContext(), providedContext());
        await handle.completion;
        await optimizeQuery(actionContext(), providedContext());
        expect(mocks.streamMessage).toHaveBeenCalledWith(...mocks.sendMessage.mock.calls[0]);
    });

    it('keeps the connected preloaded path and its statistics unchanged', async () => {
        const input = providedContext();
        const client = {
            getClusterMetadata: vi.fn().mockResolvedValue({ domainInfo_isAzure: 'false' }),
            getCollectionStats: vi.fn().mockResolvedValue({ count: 42 }),
            listIndexes: vi.fn().mockResolvedValue([]),
            getIndexStats: vi.fn().mockResolvedValue([]),
        };
        mocks.getSession.mockReturnValue({ getClient: () => client });
        await optimizeQuery(actionContext(), { ...input, sessionId: 'session', providedData: undefined });
        expect(mocks.getSession).toHaveBeenCalledWith('session');
        expect(client.getCollectionStats).toHaveBeenCalledWith('test', 'items');
        expect(client.listIndexes).toHaveBeenCalledWith('test', 'items');
        expect(mocks.sendMessage).toHaveBeenCalled();
    });
});
