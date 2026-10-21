/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AvailableModelInfo, AvailableModelsResult } from '../../../../services/ai/modelSelection';

/**
 * Mock data for the dev-only design preview (also served to the "Current" card by the L2 scenario).
 * Shapes match what `ai.getAvailableModels` returns; credits are per 1M tokens (F7).
 */
export const previewModels: readonly AvailableModelInfo[] = [
    {
        id: 'copilot-utility', name: 'Copilot utility', family: 'copilot-utility', vendor: 'copilot', version: '1',
        maxInputTokens: 128000, isUtility: true, pricing: 'Free', priceCategory: 'low', category: 'lightweight',
        inputCost: 0, outputCost: 0, cacheCost: 0, supportsToolCalling: true, supportsImageToText: false,
    },
    {
        id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', family: 'gpt-6.1-sol', vendor: 'copilot', version: '2026-09-15',
        maxInputTokens: 400000, isUtility: false, priceCategory: 'medium', category: 'powerful',
        inputCost: 125, outputCost: 1000, cacheCost: 12.5, cacheWriteCost: 156,
        supportsToolCalling: true, supportsImageToText: true,
    },
    {
        id: 'claude-opus-5.5', name: 'Claude Opus 5.5', family: 'claude-opus-5.5', vendor: 'copilot', version: '5.5',
        maxInputTokens: 1000000, isUtility: false, priceCategory: 'very_high', category: 'powerful',
        inputCost: 500, outputCost: 2500, cacheCost: 50, cacheWriteCost: 625,
        longContextInputCost: 1000, longContextOutputCost: 3750,
        supportsToolCalling: true, supportsImageToText: true,
    },
    {
        id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', family: 'claude-sonnet-5.5', vendor: 'copilot', version: '5.5',
        maxInputTokens: 1000000, isUtility: false, priceCategory: 'high', category: 'versatile',
        inputCost: 300, outputCost: 1500, cacheCost: 30, cacheWriteCost: 375,
        supportsToolCalling: true, supportsImageToText: true,
    },
    {
        id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', family: 'gemini-3.8-flash', vendor: 'copilot', version: '3.8',
        maxInputTokens: 1000000, isUtility: false, priceCategory: 'low', category: 'lightweight',
        inputCost: 30, outputCost: 250, cacheCost: 3,
        supportsToolCalling: true, supportsImageToText: true,
    },
    {
        id: 'gpt-5.6-sol-fast', name: 'GPT-5.6 Sol Fast', family: 'gpt-5.6-sol', vendor: 'copilot', version: '5.6',
        maxInputTokens: 128000, isUtility: false,
    },
];

export const PREVIEW_SAVED_MODEL_ID = 'gpt-6.1-sol';

export const previewAvailableModels: AvailableModelsResult = {
    models: [...previewModels],
    savedModelId: PREVIEW_SAVED_MODEL_ID,
    effectiveModelId: PREVIEW_SAVED_MODEL_ID,
    effectiveReason: 'saved',
};

export function previewModel(id: string): AvailableModelInfo {
    return previewModels.find((model) => model.id === id) ?? previewModels[0];
}

export interface PreviewModelGroup {
    readonly key: string;
    readonly label: string;
    readonly models: readonly AvailableModelInfo[];
}

/** Utility first, then the API categories in VS Code's order (as in ModelPicker). */
export function groupPreviewModels(models: readonly AvailableModelInfo[] = previewModels): PreviewModelGroup[] {
    const groups: PreviewModelGroup[] = [
        { key: 'utility', label: 'Utility', models: models.filter((model) => model.isUtility) },
        ...[
            { key: 'powerful', label: 'Powerful' },
            { key: 'versatile', label: 'Versatile' },
            { key: 'lightweight', label: 'Lightweight' },
        ].map((group) => ({ ...group, models: models.filter((model) => !model.isUtility && model.category === group.key) })),
    ];
    return groups.filter((group) => group.models.length > 0);
}
