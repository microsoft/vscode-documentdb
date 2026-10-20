/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * POC: user-selectable language model for Query Insights.
 *
 * Mirrors the approach used by vscode-cosmosdb (`src/utils/aiUtils.ts`):
 * list Copilot models via `vscode.lm.selectChatModels`, drop the virtual
 * `auto` model (it does not support `sendRequest` / `countTokens`), and keep
 * the user's choice in `globalState`.
 *
 * Resolution order: explicit model id → saved model id → first model in the list.
 *
 * The organization / account default chat model is not exposed on the
 * stable extension API (VS Code only hands it to chat participants as
 * `request.model`), so "first in the list" is the best available fallback.
 */

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

/** Shared by the Collection View Query Insights tab and the standalone wizard. */
export const QUERY_INSIGHTS_SELECTED_MODEL_KEY = 'documentDB.queryInsights.selectedModelId';

export const UTILITY_MODEL_ID = 'copilot-utility';

export interface AvailableModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    version: string;
    maxInputTokens: number;
    isUtility: boolean;
    pricing?: string;
    priceCategory?: string;
    category?: string;
    inputCost?: number;
    outputCost?: number;
    cacheCost?: number;
    cacheWriteCost?: number;
    longContextInputCost?: number;
    longContextOutputCost?: number;
    longContextCacheCost?: number;
    longContextCacheWriteCost?: number;
    supportsToolCalling?: boolean;
    supportsImageToText?: boolean;
}

export interface AvailableModelsResult {
    models: AvailableModelInfo[];
    /** The saved preference, or `null` when nothing was picked yet. */
    savedModelId: string | null;
    /** The model that would be used right now (saved, else first in the list). */
    effectiveModelId: string | null;
}

function isAutoModel(model: vscode.LanguageModelChat): boolean {
    return model.id === 'auto' || model.name?.toLowerCase() === 'auto';
}

function isUtilityModel(model: vscode.LanguageModelChat): boolean {
    return model.id === UTILITY_MODEL_ID || model.family === UTILITY_MODEL_ID;
}

async function listCopilotModels(): Promise<vscode.LanguageModelChat[]> {
    const all = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const models = all.filter((m) => !isAutoModel(m));

    // The utility alias is not guaranteed to be part of the unfiltered list; keep it selectable.
    if (!models.some(isUtilityModel)) {
        const utility = await vscode.lm.selectChatModels({ vendor: 'copilot', family: UTILITY_MODEL_ID });
        models.push(...utility);
    }

    // Some providers publish the same id more than once (e.g. per location); keep the first.
    const seen = new Set<string>();
    return models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

function toInfo(model: vscode.LanguageModelChat): AvailableModelInfo {
    return {
        ...readRuntimeModelMetadata(model),
        id: model.id,
        name: isUtilityModel(model)
            ? vscode.l10n.t('{0} (utility, free)', model.name || model.id)
            : model.name || model.id,
        family: model.family,
        vendor: model.vendor,
        version: model.version,
        maxInputTokens: model.maxInputTokens,
        isUtility: isUtilityModel(model),
    };
}

/** POC only: these runtime properties are typed by the proposed pricing API (F7). */
function readRuntimeModelMetadata(value: unknown): Partial<AvailableModelInfo> {
    if (typeof value !== 'object' || value === null) return {};
    const model = value as Record<string, unknown>;
    const metadata: Partial<AvailableModelInfo> = {};
    for (const key of ['pricing', 'priceCategory', 'category'] as const) {
        if (typeof model[key] === 'string') metadata[key] = model[key];
    }
    for (const key of [
        'inputCost', 'outputCost', 'cacheCost', 'cacheWriteCost',
        'longContextInputCost', 'longContextOutputCost', 'longContextCacheCost', 'longContextCacheWriteCost',
    ] as const) {
        const cost = model[key];
        if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) metadata[key] = cost;
    }
    const capabilities: unknown = model.capabilities;
    if (typeof capabilities === 'object' && capabilities !== null) {
        const record = capabilities as Record<string, unknown>;
        for (const key of ['supportsToolCalling', 'supportsImageToText'] as const) {
            if (typeof record[key] === 'boolean') metadata[key] = record[key];
        }
    }
    return metadata;
}

export function getSavedModelId(): string | null {
    return ext.context.globalState.get<string>(QUERY_INSIGHTS_SELECTED_MODEL_KEY) ?? null;
}

export async function setSavedModelId(modelId: string | null): Promise<void> {
    await ext.context.globalState.update(QUERY_INSIGHTS_SELECTED_MODEL_KEY, modelId ?? undefined);
}

export async function getAvailableModels(): Promise<AvailableModelsResult> {
    const savedModelId = getSavedModelId();
    try {
        const models = await listCopilotModels();
        const effective = (savedModelId && models.find((m) => m.id === savedModelId)) || models[0];
        return {
            models: models.map(toInfo),
            savedModelId,
            effectiveModelId: effective?.id ?? null,
        };
    } catch (error) {
        ext.outputChannel.warn(
            vscode.l10n.t(
                '[Query Insights] Failed to list language models: {0}',
                error instanceof Error ? error.message : String(error),
            ),
        );
        return { models: [], savedModelId, effectiveModelId: null };
    }
}

/**
 * Resolves the model Query Insights should use.
 * @param explicitModelId takes precedence over the saved preference when available.
 */
export async function resolveQueryInsightsModel(
    explicitModelId?: string,
): Promise<{ model: vscode.LanguageModelChat; source: 'explicit' | 'saved' | 'first-available' } | undefined> {
    const models = await listCopilotModels();
    if (models.length === 0) {
        return undefined;
    }

    if (explicitModelId) {
        const explicit = models.find((m) => m.id === explicitModelId);
        if (explicit) {
            return { model: explicit, source: 'explicit' };
        }
    }

    const savedModelId = getSavedModelId();
    if (savedModelId) {
        const saved = models.find((m) => m.id === savedModelId);
        if (saved) {
            return { model: saved, source: 'saved' };
        }
    }

    return { model: models[0], source: 'first-available' };
}
