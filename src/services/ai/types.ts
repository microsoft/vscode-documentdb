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
    verification: string[];
    educationalContent?: string; // Optional markdown content for educational cards
}

/**
 * Individual index recommendation from AI
 */
export interface AIIndexRecommendation {
    action: 'create' | 'drop' | 'none' | 'modify';
    indexSpec: Record<string, number>; // e.g., { user_id: 1, status: 1 }
    indexOptions?: Record<string, unknown>;
    mongoShell: string; // MongoDB shell command
    justification: string; // Why this recommendation
    priority: 'high' | 'medium' | 'low';
    risks?: string; // Potential risks or side effects
}
