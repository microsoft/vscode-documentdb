/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Type definitions for Query Insights feature
 * These types are used for the three-stage progressive loading of query performance data
 */

// ============================================================================
// Stage 3: AI-Powered Recommendations Types
// ============================================================================

/**
 * Analysis card containing overall AI analysis of query performance
 */
export interface AnalysisCard {
    type: 'analysis';
    content: string; // The overall analysis from AI
}

/**
 * Improvement card with actionable recommendation and action buttons
 */
export interface ImprovementCard {
    type: 'improvement';
    cardId: string; // Unique identifier

    // Card header
    title: string; // e.g., "Recommendation: Create Index"
    priority: 'high' | 'medium' | 'low';

    // Main content
    description: string; // Justification field from AI
    recommendedIndex: string; // Stringified indexSpec, e.g., "{ user_id: 1 }"
    recommendedIndexDetails: string; // Additional explanation about the index

    // Additional info
    details: string; // Risks or additional considerations
    mongoShellCommand: string; // The mongoShell command to execute

    // Action buttons with complete context for execution
    primaryButton: ActionButton;
    secondaryButton?: ActionButton;
}

/**
 * Action button with payload for execution
 */
export interface ActionButton {
    label: string; // e.g., "Create Index"
    actionId: string; // e.g., "createIndex", "dropIndex", "learnMore"
    payload: unknown; // Context needed to perform the action
}

/**
 * Complete Stage 3 response from router
 */
export interface QueryInsightsStage3Response {
    analysisCard: AnalysisCard;
    improvementCards: ImprovementCard[];
    verificationSteps: string; // How to verify improvements
    educationalContent?: string; // Optional markdown content for educational cards
    metadata?: OptimizationMetadata;
}

/**
 * Metadata about the optimization context
 */
export interface OptimizationMetadata {
    collectionName: string;
    collectionStats?: {
        count: number;
        size: number;
    };
    indexStats?: Array<{
        name: string;
        key: Record<string, number>;
    }>;
    executionStats?: unknown;
    derived?: {
        totalKeysExamined: number;
        totalDocsExamined: number;
        keysToDocsRatio: number;
        usedIndex: string;
    };
}

// ============================================================================
// Action Payload Types (for button actions)
// ============================================================================

/**
 * Payload for createIndex action
 */
export interface CreateIndexPayload {
    clusterId: string;
    databaseName: string;
    collectionName: string;
    action: 'create';
    indexSpec: Record<string, number>;
    indexOptions?: Record<string, unknown>;
    mongoShell: string;
}

/**
 * Payload for dropIndex action
 */
export interface DropIndexPayload {
    clusterId: string;
    databaseName: string;
    collectionName: string;
    action: 'drop';
    indexSpec: Record<string, number>;
    mongoShell: string;
}

/**
 * Payload for learnMore action
 */
export interface LearnMorePayload {
    topic: string; // e.g., "compound-indexes", "index-optimization"
}
