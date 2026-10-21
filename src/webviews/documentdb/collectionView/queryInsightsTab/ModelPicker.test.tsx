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
import { ModelPicker, type ModelPickerProps } from '../../queryInsightsShared/ModelPicker';
import { PerformanceInsightsCardComparison } from './components/optimizationCards/custom/PerformanceInsightsCardComparison';

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
            'aria-label': ariaLabel,
            onOpenChange,
            onOptionSelect,
        }: {
            children: ReactNode;
            disabled?: boolean;
            value: string;
            placeholder: string;
            'aria-label'?: string;
            onOpenChange?: (event: React.MouseEvent, data: { open: boolean }) => void;
            onOptionSelect: (event: React.MouseEvent, data: { optionValue: string }) => void;
        }): ReactNode => (
            <div>
                <button role="combobox" aria-label={ariaLabel} disabled={disabled}
                    onClick={(event) => onOpenChange?.(event, { open: true })}>{value || placeholder}</button>
                <div role="listbox" onClick={(event) => {
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
        Popover: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
        PopoverTrigger: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
        PopoverSurface: ({ children, 'aria-label': ariaLabel }: { children: ReactNode; 'aria-label'?: string }): ReactNode => (
            <div role="dialog" aria-label={ariaLabel}>{children}</div>
        ),
        MenuPopover: ({ children }: { children: ReactNode }): ReactNode => <div>{children}</div>,
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

    async function renderPicker(
        onModelChange = vi.fn(),
        onPromptLabelChange = vi.fn(),
        children?: ModelPickerProps['children'],
    ): Promise<void> {
        await act(async () => {
            root.render(
                <SSRProvider>
                    <ModelPicker
                        commandType={'find' as CommandType}
                        onModelChange={onModelChange}
                        onPromptLabelChange={onPromptLabelChange}
                        children={children}
                    />
                </SSRProvider>,
            );
        });
    }

    function details(): Record<string, string> {
        return Object.fromEntries([...host.querySelectorAll('[role="dialog"] dl > div')].map((row) => [
            row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? '',
        ]));
    }

    it('labels the dropdown and details button and reports only the custom prompt basename', async () => {
        const onChange = vi.fn();
        const onPrompt = vi.fn();
        await renderPicker(onChange, onPrompt);
        const combobox = host.querySelector<HTMLButtonElement>('[role="combobox"]');
        expect(combobox?.getAttribute('aria-label')).toBe('Copilot model');
        expect(combobox?.textContent).toBe('Premium model');
        expect(host.querySelector('button[aria-label="Model details"]')).not.toBeNull();
        expect(onPrompt).toHaveBeenLastCalledWith('Custom prompt private.md');
        expect(details().Prompt).toBe('Custom prompt private.md');
        expect(host.textContent).not.toContain('._local');
        expect(onChange).toHaveBeenLastCalledWith(available.models[0]);
    });

    it('orders utility first, refetches the list on open and persists a selection', async () => {
        mocks.setSelectedModel.mockResolvedValue({
            ...available, savedModelId: 'utility', effectiveModelId: 'utility', effectiveReason: 'saved',
        });
        await renderPicker();
        expect(mocks.getAvailableModels).toHaveBeenCalledTimes(1);
        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            models: [...available.models, { ...available.models[0], id: 'late', name: 'Late model' }],
        });
        await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')?.click());
        expect(mocks.getAvailableModels).toHaveBeenCalledTimes(2);
        expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(false);
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map((option) => option.textContent)).toEqual(['Utility model', 'Premium model', 'Late model']);
        await act(async () => options[0].click());
        expect(mocks.setSelectedModel).toHaveBeenCalledWith({ modelId: 'utility' });
        expect(details().Selection).toBe('Saved choice');
        expect(details().Cost).toBe('No additional cost for most GitHub Copilot subscribers.');
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
        expect(host.querySelector('button[aria-label="Model details"]')).toBeNull();
        expect(host.textContent).toContain('Refresh models');
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it('groups non-utility models with cost badges and lists the selected model details', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            models: [
                { ...available.models[0], category: 'powerful', pricing: '1x', priceCategory: 'high',
                    inputCost: 0, outputCost: 6, cacheCost: 0.25, longContextInputCost: 4,
                    supportsToolCalling: true, supportsImageToText: false },
                available.models[1],
                { ...available.models[0], id: 'light', name: 'Light model', category: 'lightweight', priceCategory: 'low' },
                { ...available.models[0], id: 'future', name: 'Future model', category: 'new-category' },
            ],
        });
        await renderPicker();
        const options = [...host.querySelectorAll('[role="option"]')];
        expect(options.map((element) => element.getAttribute('data-value'))).toEqual(['utility', 'premium', 'light', 'future']);
        expect(options.map((element) => element.textContent)).toEqual([
            'Utility model', 'Premium modelHigh cost', 'Light modelLow cost', 'Future model',
        ]);
        expect([...host.querySelectorAll('[role="group"]')].map((element) => element.getAttribute('aria-label')))
            .toEqual(['Powerful', 'Lightweight', 'Other']);
        const facts = details();
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Premium model');
        expect(facts.Cost).toBe('High cost');
        expect(facts['Credits per 1M tokens']).toBe('Input 0 · Output 6 · Cache read 0.25Long context: Input 4');
        expect(facts.Capabilities).toBe('Tool calling · No image input');
        expect(facts['Model ID']).toBe('premium');
        expect(facts.Selection).toBe('Default: first available model');
        expect(host.textContent).toContain('Thinking level and context size follow this model\'s settings in the VS Code Chat model picker.');
    });

    it('shows the cost category and never a "Free" label or cost badge for the utility model', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available, models: [{ ...available.models[0], priceCategory: 'very_high' }, available.models[1]],
        });
        await renderPicker();
        expect(details().Cost).toBe('Very high cost');

        mocks.getAvailableModels.mockResolvedValue({
            ...available, effectiveModelId: 'utility',
            models: [available.models[0], { ...available.models[1], pricing: 'Free', priceCategory: 'low' }],
        });
        await act(async () => root.unmount());
        root = createRoot(host);
        await renderPicker();
        expect(host.querySelector('[data-value="utility"]')?.textContent).toBe('Utility model');
        expect(details().Cost).toBe('No additional cost for most GitHub Copilot subscribers.');
        expect(host.textContent).not.toMatch(/free/i);
    });

    it('says explicitly when a model reports no pricing instead of hiding the row', async () => {
        await renderPicker();
        expect(details().Cost).toBe('Not reported for this model');
        expect(details()['Credits per 1M tokens']).toBe('Not reported for this model');
        expect(details()['Context window']).toBe('128,000 tokens');
    });

    it('shares one saved selection across all six live comparison controls', async () => {
        mocks.setSelectedModel.mockResolvedValue({
            ...available, savedModelId: 'utility', effectiveModelId: 'utility', effectiveReason: 'saved',
        });
        const onChange = vi.fn();
        await renderPicker(onChange, vi.fn(), (renderControl) => (
            <>
                {renderControl('label-change')}
                {renderControl('compound')}
                {renderControl('outline-button')}
                {renderControl('outline')}
                {renderControl('filled-darker')}
                {renderControl('underline')}
            </>
        ));
        expect(mocks.getAvailableModels).toHaveBeenCalledTimes(1);
        expect(host.querySelectorAll('button[aria-label="Model details"]')).toHaveLength(6);
        expect(host.querySelector('.fui-CompoundButton')?.textContent).toContain('Premium model');
        const firstUtilityOption = host.querySelector<HTMLButtonElement>('[role="option"][data-value="utility"]');
        await act(async () => firstUtilityOption?.click());
        expect(mocks.setSelectedModel).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith(available.models[1]);
        expect([...host.querySelectorAll('[role="combobox"]')].map((element) => element.textContent))
            .toEqual(['Utility model', 'Utility model', 'Utility model']);
        expect(host.querySelector('.fui-CompoundButton')?.textContent).toContain('Utility model');
        expect(host.querySelector('.query-insights-model-picker-row > .fui-Text')?.textContent).toBe('Utility model');
    });

    it('opens the CompoundButton radio menu, refreshes models and saves a choice', async () => {
        mocks.setSelectedModel.mockResolvedValue({
            ...available, savedModelId: 'utility', effectiveModelId: 'utility', effectiveReason: 'saved',
        });
        await renderPicker(vi.fn(), vi.fn(), (renderControl) => renderControl('compound'));
        await act(async () => host.querySelector<HTMLButtonElement>('.fui-CompoundButton')?.click());
        expect(mocks.getAvailableModels).toHaveBeenCalledTimes(2);
        const utilityOption = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
            .find((element) => element.textContent === 'Utility model');
        expect(utilityOption).toBeDefined();
        await act(async () => utilityOption?.click());
        expect(mocks.setSelectedModel).toHaveBeenCalledWith({ modelId: 'utility' });
        expect(host.querySelector('.fui-CompoundButton')?.textContent).toContain('Utility model');
    });

    it('wires every comparison card to the same analysis action without running it on mount', async () => {
        const onAnalyze = vi.fn();
        await act(async () => {
            root.render(
                <SSRProvider>
                    <PerformanceInsightsCardComparison
                        commandType={'find' as CommandType}
                        bodyText="Analyze this plan"
                        isLoading={false}
                        onGetInsights={onAnalyze}
                        onLearnMore={vi.fn()}
                        onCancel={vi.fn()}
                        onLearnMoreUtilityModel={vi.fn()}
                    />
                </SSRProvider>,
            );
        });
        expect(host.querySelectorAll('.get-performance-insights-card-experiment')).toHaveLength(6);
        expect(onAnalyze).not.toHaveBeenCalled();
        const actions = [...host.querySelectorAll<HTMLButtonElement>('.get-performance-insights-card-actions > button')];
        expect(actions).toHaveLength(6);
        for (const action of actions) {
            await act(async () => action.click());
        }
        expect(onAnalyze).toHaveBeenCalledTimes(6);
        expect(mocks.getAvailableModels).toHaveBeenCalledTimes(1);
    });
});
