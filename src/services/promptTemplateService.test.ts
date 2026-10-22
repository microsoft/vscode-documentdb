/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandType } from '../commands/llmEnhancedCommands/indexAdvisorCommands';
import { getLastPromptSource } from '../commands/llmEnhancedCommands/promptTemplates';
import { getIndexAdvisorPromptSourceInfo, PromptTemplateService } from './promptTemplateService';

const mocks = vi.hoisted(() => ({
    settings: new Map<string, unknown>(),
    readFile: vi.fn(),
    access: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    trace: vi.fn(),
}));

vi.mock('fs/promises', () => ({ access: mocks.access, readFile: mocks.readFile }));
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (key: string, fallback?: unknown): unknown => mocks.settings.get(key) ?? fallback,
        }),
        workspaceFolders: [],
    },
    window: {
        showInformationMessage: mocks.showInformationMessage,
        showWarningMessage: mocks.showWarningMessage,
    },
    l10n: {
        t: (message: string, args?: Record<string, unknown>): string =>
            message.replace(/\{(\w+)\}/g, (match, key: string) => (args && key in args ? String(args[key]) : match)),
    },
}));
vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { trace: mocks.trace } } }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (
        _event: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        try {
            return await callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: {},
            } as IActionContext);
        } catch {
            return undefined;
        }
    },
}));
vi.mock('../commands/llmEnhancedCommands/indexAdvisorCommands', () => ({
    CommandType: { Find: 'find', Aggregate: 'aggregate', Count: 'count' },
}));
vi.mock('../commands/llmEnhancedCommands/queryGenerationCommands', () => ({
    QueryGenerationType: { SingleCollection: 'single', CrossCollection: 'cross' },
}));

describe('Index advisor prompt iteration', () => {
    const customSetting = 'documentDB.aiAssistant.indexAdvisorFindPromptPath';

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.clear();
        PromptTemplateService.clearCache();
        mocks.access.mockResolvedValue(undefined);
    });

    it('reads every custom-file edit even when a built-in prompt was already cached', async () => {
        const builtIn = await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find);
        mocks.settings.set(customSetting, 'prompts/local.md');
        mocks.readFile.mockResolvedValueOnce('First edit').mockResolvedValueOnce('Second edit');

        expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).toBe('First edit');
        expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).toBe('Second edit');
        expect(getLastPromptSource()).toBe('custom-file');
        expect(mocks.readFile).toHaveBeenCalledTimes(2);
        expect(mocks.trace.mock.calls.map(([message]) => message as string)).toEqual([
            expect.stringMatching(/^Query Insights prompt for find query: built-in \((resource-file|inline-fallback)/),
            'Query Insights prompt for find query: custom file prompts/local.md',
            'Query Insights prompt for find query: custom file prompts/local.md',
        ]);
        expect(mocks.showInformationMessage).not.toHaveBeenCalled();

        mocks.settings.delete(customSetting);
        expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).toBe(builtIn);
        expect(getLastPromptSource()).not.toBe('custom-file');
        // Served from the cache, still traced.
        expect(mocks.trace).toHaveBeenCalledTimes(4);
        expect(mocks.trace.mock.lastCall?.[0]).toMatch(/^Query Insights prompt for find query: built-in \(/);
    });

    it('does not cache a failed custom-file read and retries on the next request', async () => {
        mocks.settings.set(customSetting, 'prompts/local.md');
        mocks.readFile.mockRejectedValueOnce(new Error('not yet saved')).mockResolvedValueOnce('Fixed prompt');
        expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).not.toBe('Fixed prompt');
        expect(mocks.showWarningMessage).toHaveBeenCalledOnce();
        expect(mocks.trace.mock.lastCall?.[0]).toMatch(
            /^Query Insights prompt for find query: built-in \(.+\); the custom file prompts\/local\.md could not be read$/,
        );
        expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).toBe('Fixed prompt');
    });

    it('reports the configured source for every command type without reading the file', () => {
        expect(getIndexAdvisorPromptSourceInfo(CommandType.Find)).toEqual({ source: 'built-in' });
        for (const [commandType, setting] of [
            [CommandType.Find, 'documentDB.aiAssistant.indexAdvisorFindPromptPath'],
            [CommandType.Aggregate, 'documentDB.aiAssistant.indexAdvisorAggregatePromptPath'],
            [CommandType.Count, 'documentDB.aiAssistant.indexAdvisorCountPromptPath'],
        ] as const) {
            mocks.settings.set(setting, 'prompts/private.md');
            expect(getIndexAdvisorPromptSourceInfo(commandType)).toEqual({
                source: 'custom-file',
                path: 'prompts/private.md',
            });
        }
        expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('treats an empty or whitespace-only path as not configured and uses the built-in prompt', async () => {
        const builtIn = await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find);
        PromptTemplateService.clearCache();
        for (const blank of ['', '   ', '\t\n', null]) {
            mocks.settings.set(customSetting, blank);
            expect(getIndexAdvisorPromptSourceInfo(CommandType.Find)).toEqual({ source: 'built-in' });
            expect(await PromptTemplateService.getIndexAdvisorPromptTemplate(CommandType.Find)).toBe(builtIn);
        }
        expect(mocks.readFile).not.toHaveBeenCalled();
        expect(mocks.showWarningMessage).not.toHaveBeenCalled();
    });

    it('trims surrounding whitespace from a configured custom path', () => {
        mocks.settings.set(customSetting, '  prompts/local.md \n');
        expect(getIndexAdvisorPromptSourceInfo(CommandType.Find)).toEqual({
            source: 'custom-file',
            path: 'prompts/local.md',
        });
    });
});
