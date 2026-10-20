/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { SSRProvider } from '@fluentui/react-components';
import { act, type ReactNode } from 'react';
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
// jsdom has no layout engine; leave Fluent's floating-popup positioning out of this state/selection test.
vi.mock('@fluentui/react-components', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@fluentui/react-components')>();
    return {
        ...actual,
        Dropdown: ({
            children,
            disabled,
            value,
            placeholder,
            onOptionSelect,
        }: {
            children: ReactNode;
            disabled?: boolean;
            value: string;
            placeholder: string;
            onOptionSelect: (event: React.MouseEvent, data: { optionValue: string }) => void;
        }): ReactNode => (
            <div>
                <button role="combobox" disabled={disabled}>{value || placeholder}</button>
                <div onClick={(event) => {
                    const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
                    if (option?.dataset.value && !disabled) {
                        onOptionSelect(event, { optionValue: option.dataset.value });
                    }
                }}>{children}</div>
            </div>
        ),
        Option: ({ children, value }: { children: ReactNode; value: string }): ReactNode => (
            <button role="option" data-value={value}>{children}</button>
        ),
        OptionGroup: ({ children, label }: { children: ReactNode; label: string }): ReactNode => (
            <div role="group" aria-label={label}>{children}</div>
        ),
    };
});
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
    effectiveReason: 'first-available',
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
        expect(host.textContent).toContain('Default: first available model · May use premium requests');
        expect(host.textContent).toContain('Prompt: Custom file private.md');
        expect(host.textContent).not.toContain('._local');
        expect(onChange).toHaveBeenLastCalledWith(available.models[0]);
        expect(host.querySelector('.query-insights-model-picker-compact')).not.toBeNull();
    });

    it('orders utility first, displays token counts and persists a selection', async () => {
        mocks.setSelectedModel.mockResolvedValue({
            ...available, savedModelId: 'utility', effectiveModelId: 'utility', effectiveReason: 'saved',
        });
        await renderPicker();
        await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')?.click());
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map((option) => option.textContent)).toEqual(['Utility model64KUtility', 'Premium model128KOther']);
        await act(async () => options[0].click());
        expect(mocks.setSelectedModel).toHaveBeenCalledWith({ modelId: 'utility' });
        expect(host.textContent).toContain('Saved choice');
        expect(host.textContent).not.toContain('May use premium requests');
    });

    it('shows an empty state and disables the picker when no models are available', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            models: [], savedModelId: null, effectiveModelId: null, effectiveReason: null,
        });
        mocks.getPromptSourceInfo.mockResolvedValue({ source: 'built-in' });
        const onChange = vi.fn();
        await renderPicker(onChange);
        expect(host.textContent).toContain('No Copilot models available');
        expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it('groups non-utility models and shows only present selected-model metadata', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            models: [
                { ...available.models[0], category: 'powerful', pricing: '1x', priceCategory: 'high',
                    inputCost: 0, outputCost: 6, cacheCost: 0.25, longContextInputCost: 4,
                    supportsToolCalling: true, supportsImageToText: false },
                available.models[1],
                { ...available.models[0], id: 'light', name: 'Light model', category: 'lightweight' },
                { ...available.models[0], id: 'future', name: 'Future model', category: 'new-category' },
            ],
        });
        await renderPicker();
        expect([...host.querySelectorAll('[role="option"]')].map((element) => element.getAttribute('data-value')))
            .toEqual(['utility', 'premium', 'light', 'future']);
        expect([...host.querySelectorAll('[role="group"]')].map((element) => element.getAttribute('aria-label')))
            .toEqual(['Powerful', 'Lightweight', 'Other']);
        const rows = Object.fromEntries([...host.querySelectorAll('tr')].map((row) => {
            const cells = row.querySelectorAll(':scope > td');
            return [cells[0]?.textContent ?? '', cells[1]?.textContent ?? ''];
        }));
        expect(rows.Cost).toContain('High cost');
        expect(rows.Cost).toContain('Credits per 1M tokens');
        expect(rows.Cost).toContain('Standard0');
        expect(rows.Cost).toContain('Long context4');
        expect(rows.Cost).not.toContain('Cache write');
        expect(rows.Capabilities).toBe('Tool calling · No image input');
        expect(rows['Model ID']).toBe('premium');
        expect(rows.Prompt).toBe('Custom file private.md');
        expect(host.querySelector('details')).toBeNull();
        expect(host.textContent).toContain('Thinking level and context size follow this model\'s settings in the VS Code Chat model picker.');
    });

    it('keeps the compact variant to one line plus an accessible details tooltip, without a toggle', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available, models: [{ ...available.models[0], priceCategory: 'very_high' }, available.models[1]],
        });
        await renderPicker(vi.fn(), true);
        expect(host.querySelector('.query-insights-model-compact-details')?.textContent).toContain('Very high cost');
        expect(host.querySelector('button[aria-label="Selected model details"]')).not.toBeNull();
        expect(host.querySelector('details')).toBeNull();
    });

    it('says explicitly when a model reports no pricing instead of hiding the row', async () => {
        await renderPicker();
        const costRow = [...host.querySelectorAll('tr')].find((row) => row.querySelector('td')?.textContent === 'Cost');
        expect(costRow?.textContent).toContain('Not reported for this model');
        expect(host.textContent).toContain('128,000 tokens');
        expect(host.querySelector('details')).toBeNull();
    });
});
