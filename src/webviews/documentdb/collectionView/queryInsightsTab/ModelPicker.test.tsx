/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { SSRProvider } from '@fluentui/react-components';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailableModelsResult } from '../../../../services/ai/modelSelection';
import { ModelPicker, type ModelPickerProps } from '../../queryInsightsShared/ModelPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    getAvailableModels: vi.fn(),
    setSelectedModel: vi.fn(),
}));
const client = {
    ai: {
        getAvailableModels: { query: mocks.getAvailableModels },
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
            appearance,
            button,
            'aria-labelledby': ariaLabelledBy,
            'aria-label': ariaLabel,
            onOpenChange,
            onOptionSelect,
        }: {
            children: ReactNode;
            disabled?: boolean;
            value: string;
            placeholder: string;
            appearance?: string;
            button?: { children: ReactNode };
            'aria-label'?: string;
            'aria-labelledby'?: string;
            onOpenChange?: (event: React.MouseEvent, data: { open: boolean }) => void;
            onOptionSelect: (event: React.MouseEvent, data: { optionValue: string }) => void;
        }): ReactNode => (
            <div>
                <button
                    role="combobox"
                    aria-label={ariaLabel}
                    aria-labelledby={ariaLabelledBy}
                    data-appearance={appearance}
                    disabled={disabled}
                    onClick={(event) => onOpenChange?.(event, { open: true })}
                >
                    {button?.children ?? (value || placeholder)}
                </button>
                <div
                    role="listbox"
                    onClick={(event) => {
                        const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
                        if (option?.dataset.value && !disabled) {
                            onOptionSelect(event, { optionValue: option.dataset.value });
                        }
                    }}
                >
                    {children}
                </div>
            </div>
        ),
        Option: ({ children, value }: { children: ReactNode; value: string }): ReactNode => (
            <button role="option" data-value={value}>
                {children}
            </button>
        ),
        OptionGroup: ({ children, label }: { children: ReactNode; label: string }): ReactNode => (
            <div role="group" aria-label={label}>
                {children}
            </div>
        ),
        Popover: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
        PopoverTrigger: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
        PopoverSurface: ({
            children,
            'aria-label': ariaLabel,
        }: {
            children: ReactNode;
            'aria-label'?: string;
        }): ReactNode => (
            <div role="dialog" aria-label={ariaLabel}>
                {children}
            </div>
        ),
    };
});
vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
}));

const available: AvailableModelsResult = {
    models: [
        {
            id: 'premium',
            name: 'Premium model',
            family: 'premium',
            vendor: 'copilot',
            version: '1',
            maxInputTokens: 128000,
            isUtility: false,
        },
        {
            id: 'utility',
            name: 'Utility model',
            family: 'copilot-utility',
            vendor: 'copilot',
            version: '1',
            maxInputTokens: 64000,
            isUtility: true,
        },
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
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    async function renderPicker(onModelChange = vi.fn(), props?: Partial<ModelPickerProps>): Promise<void> {
        await act(async () => {
            root.render(
                <SSRProvider>
                    <ModelPicker onModelChange={onModelChange} {...props} />
                </SSRProvider>,
            );
        });
    }

    function details(): Record<string, string> {
        return Object.fromEntries(
            [...host.querySelectorAll('[role="dialog"] dl > div')].map((row) => [
                row.querySelector('dt')?.textContent ?? '',
                row.querySelector('dd')?.textContent ?? '',
            ]),
        );
    }

    it('labels the dropdown and details button and does not show prompt information', async () => {
        const onChange = vi.fn();
        await renderPicker(onChange);
        const combobox = host.querySelector<HTMLButtonElement>('[role="combobox"]');
        expect(combobox?.getAttribute('aria-label')).toBe('Copilot model');
        expect(combobox?.textContent).toBe('Premium model');
        expect(host.querySelector('button[aria-label="Model details"]')).not.toBeNull();
        expect(details()).not.toHaveProperty('Prompt');
        expect(host.textContent).not.toMatch(/prompt/i);
        expect(onChange).toHaveBeenLastCalledWith(available.models[0]);
    });

    it('orders utility first, refetches the list on open and persists a selection', async () => {
        mocks.setSelectedModel.mockResolvedValue({
            ...available,
            savedModelId: 'utility',
            effectiveModelId: 'utility',
            effectiveReason: 'saved',
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
            models: [],
            savedModelId: null,
            effectiveModelId: null,
            effectiveReason: null,
        });
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
                {
                    ...available.models[0],
                    category: 'powerful',
                    pricing: '1x',
                    priceCategory: 'high',
                    inputCost: 0,
                    outputCost: 6,
                    cacheCost: 0.25,
                    longContextInputCost: 4,
                    supportsToolCalling: true,
                    supportsImageToText: false,
                },
                available.models[1],
                {
                    ...available.models[0],
                    id: 'light',
                    name: 'Light model',
                    category: 'lightweight',
                    priceCategory: 'low',
                },
                { ...available.models[0], id: 'future', name: 'Future model', category: 'new-category' },
            ],
        });
        await renderPicker();
        const options = [...host.querySelectorAll('[role="option"]')];
        expect(options.map((element) => element.getAttribute('data-value'))).toEqual([
            'utility',
            'premium',
            'light',
            'future',
        ]);
        expect(options.map((element) => element.textContent)).toEqual([
            'Utility model',
            'Premium modelHigh cost',
            'Light modelLow cost',
            'Future model',
        ]);
        expect(
            [...host.querySelectorAll('[role="group"]')].map((element) => element.getAttribute('aria-label')),
        ).toEqual(['Powerful', 'Lightweight', 'Other']);
        const facts = details();
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Premium model');
        expect(facts.Cost).toBe('High cost');
        expect(facts['Credits per 1M tokens']).toBe('Input 0 · Output 6 · Cache read 0.25Long context: Input 4');
        expect(facts.Capabilities).toBe('Tool calling · No image input');
        expect(facts['Model ID']).toBe('premium');
        expect(facts.Selection).toBe('Default: first available model');
        expect(host.textContent).toContain(
            "Thinking level and context size follow this model's settings in the VS Code Chat model picker.",
        );
    });

    it('shows the cost category and never a "Free" label or cost badge for the utility model', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            models: [{ ...available.models[0], priceCategory: 'very_high' }, available.models[1]],
        });
        await renderPicker();
        expect(details().Cost).toBe('Very high cost');

        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            effectiveModelId: 'utility',
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

    it('uses underline with a decorative model icon only on the closed card trigger', async () => {
        await renderPicker(vi.fn(), { appearance: 'underline', showModelIcon: true });
        const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
        expect(trigger?.dataset.appearance).toBe('underline');
        expect(trigger?.textContent).toBe('Premium model');
        expect(trigger?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
        await act(async () => trigger?.click());
        expect(trigger?.querySelector('svg')).toBeNull();
        expect(host.querySelectorAll('[role="option"]')).toHaveLength(2);
    });

    it('preserves the wizard outline appearance and visible label without a model icon', async () => {
        await renderPicker(vi.fn(), { showLabel: true });
        const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
        expect(trigger?.dataset.appearance).toBe('outline');
        expect(trigger?.querySelector('svg')).toBeNull();
        expect(document.getElementById(trigger?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
            'Copilot model',
        );
    });

    it.each(['outline', 'underline'] as const)(
        'keeps Fast model ids and provider labels in the %s list',
        async (appearance) => {
            const models = [
                { ...available.models[0], id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', category: 'powerful' },
                { ...available.models[0], id: 'gpt-5.6-sol-fast', name: 'GPT-5.6 Sol Fast', category: undefined },
                available.models[1],
            ];
            mocks.getAvailableModels.mockResolvedValue({ ...available, models, effectiveModelId: models[0].id });
            await renderPicker(vi.fn(), { appearance });
            expect(
                [...host.querySelectorAll('[role="option"]')].map((element) => [
                    element.getAttribute('data-value'),
                    element.textContent,
                ]),
            ).toEqual([
                ['utility', 'Utility model'],
                ['gpt-5.6-sol', 'GPT-5.6 Sol'],
                ['gpt-5.6-sol-fast', 'GPT-5.6 Sol Fast'],
            ]);
        },
    );

    it('disambiguates identical provider labels with model ids instead of merging entries', async () => {
        mocks.getAvailableModels.mockResolvedValue({
            ...available,
            models: [
                { ...available.models[0], id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
                { ...available.models[0], id: 'gpt-5.6-sol-fast', name: 'GPT-5.6 Sol' },
            ],
            effectiveModelId: 'gpt-5.6-sol-fast',
        });
        await renderPicker();
        expect(host.querySelector('[data-value="gpt-5.6-sol"]')?.textContent).toBe('GPT-5.6 Solgpt-5.6-sol');
        expect(host.querySelector('[data-value="gpt-5.6-sol-fast"]')?.textContent).toBe('GPT-5.6 Solgpt-5.6-sol-fast');
        expect(details()['Model ID']).toBe('gpt-5.6-sol-fast');
    });
});
