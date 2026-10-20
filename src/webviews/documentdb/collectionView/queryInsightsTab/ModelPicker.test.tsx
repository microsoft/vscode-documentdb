/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { SSRProvider } from '@fluentui/react-components';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandType } from '../../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { AvailableModelsResult } from '../../../../services/ai/modelSelection';
import { ModelPicker } from '../../queryInsightsShared/ModelPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    getAvailableModels: vi.fn(),
    getPromptSourceInfo: vi.fn(),
    setSelectedModel: vi.fn(),
}));
const client = {
    ai: {
        getAvailableModels: { query: mocks.getAvailableModels },
        getPromptSourceInfo: { query: mocks.getPromptSourceInfo },
        setSelectedModel: { mutate: mocks.setSelectedModel },
    },
};
vi.mock('../../../_integration/useTrpcClient', () => ({ useTrpcClient: () => client }));
vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
}));

const available: AvailableModelsResult = {
    models: [
        { id: 'premium', name: 'Premium model', family: 'premium', vendor: 'copilot', version: '1', maxInputTokens: 128000, isUtility: false },
        { id: 'utility', name: 'Utility model', family: 'copilot-utility', vendor: 'copilot', version: '1', maxInputTokens: 64000, isUtility: true },
    ],
    savedModelId: null,
    effectiveModelId: 'premium',
};

describe('Shared Query Insights ModelPicker', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getAvailableModels.mockResolvedValue(available);
        mocks.getPromptSourceInfo.mockResolvedValue({ source: 'custom-file', path: '._local/prompts/private.md' });
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    async function renderPicker(onModelChange = vi.fn(), compact = false): Promise<void> {
        await act(async () => {
            root.render(
                <SSRProvider>
                    <ModelPicker commandType={'find' as CommandType} compact={compact} onModelChange={onModelChange} />
                </SSRProvider>,
            );
        });
    }

    it('shows the effective model, reason, premium hint and only the custom prompt basename', async () => {
        const onChange = vi.fn();
        await renderPicker(onChange, true);
        expect(host.textContent).toContain('Using Premium model · First available model');
        expect(host.textContent).toContain('May use premium requests');
        expect(host.textContent).toContain('Prompt: custom file private.md');
        expect(host.textContent).not.toContain('._local');
        expect(onChange).toHaveBeenLastCalledWith(available.models[0]);
        expect(host.querySelector('.query-insights-model-picker-compact')).not.toBeNull();
    });

    it('orders utility first, displays token counts and persists a selection', async () => {
        mocks.setSelectedModel.mockResolvedValue({ ...available, savedModelId: 'utility', effectiveModelId: 'utility' });
        await renderPicker();
        await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')?.click());
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map((option) => option.textContent)).toEqual(['Utility model64K tokens', 'Premium model128K tokens']);
        await act(async () => options[0].click());
        expect(mocks.setSelectedModel).toHaveBeenCalledWith({ modelId: 'utility' });
        expect(host.textContent).toContain('Using Utility model · Saved choice');
        expect(host.textContent).not.toContain('May use premium requests');
    });

    it('shows an empty state and disables the picker when no models are available', async () => {
        mocks.getAvailableModels.mockResolvedValue({ models: [], savedModelId: null, effectiveModelId: null });
        mocks.getPromptSourceInfo.mockResolvedValue({ source: 'built-in' });
        const onChange = vi.fn();
        await renderPicker(onChange);
        expect(host.textContent).toContain('No Copilot models available');
        expect(host.textContent).toContain('Prompt: built-in');
        expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });
});
