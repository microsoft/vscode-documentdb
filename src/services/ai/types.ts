/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AI Service Types
 * Internal types used by QueryInsightsAIService
 */

/**
 * AI backend request payload
 */
export interface AIOptimizationRequest {
    query: string; // The DocumentDB query
    databaseName: string; // Database name
    collectionName: string; // Collection name
}

/**
 * AI backend response schema
 */
export interface AIOptimizationResponse {
    analysis: string;
    improvements: AIIndexRecommendation[];
    educationalContent?: string; // Optional markdown content for educational cards
    /**
     * Stable opaque id of the language model that produced the response
     * (`LanguageModelChat.id`, e.g., `copilot-gpt-4o`). Use for telemetry and
     * exact comparisons. Populated by `QueryInsightsAIService`.
     */
    modelId?: string;
    /**
     * Well-known family of the model (`LanguageModelChat.family`, e.g.,
     * `gpt-4o`). Use for warning checks against the preferred-model constant.
     */
    modelFamily?: string;
    /**
     * Human-readable display name (`LanguageModelChat.name`, e.g., `GPT-4o`).
     * Surfaced in the panel as a small "Powered by…" byline so users can see
     * which model actually answered. Optional for forward compatibility.
     */
    modelDisplayName?: string;
    /**
     * Best-effort token usage measurements for the underlying Copilot
     * request. All fields are optional and may be missing when `countTokens`
     * fails or the request was cancelled.
     */
    usage?: {
        promptTokens?: number;
        responseTokens?: number;
        totalTokens?: number;
        maxInputTokens?: number;
        promptUtilizationPct?: number;
    };
}

/**
 * Individual index recommendation from AI
 */
export interface AIIndexRecommendation {
    action: 'create' | 'drop' | 'none' | 'modify';
    indexSpec: Record<string, number>; // e.g., { user_id: 1, status: 1 }
    indexOptions?: Record<string, unknown>;
    indexName: string; // Name of the index
    shellCommand: string; // DocumentDB API shell command
    justification: string; // Why this recommendation
    priority: 'high' | 'medium' | 'low';
    risks?: string; // Potential risks or side effects
}
