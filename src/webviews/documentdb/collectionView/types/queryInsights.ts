/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Type definitions for Query Insights feature
 * These types are used for the three-stage progressive loading of query performance data
 */

// ============================================================================
// Stage 1: Initial Performance View Types
// ============================================================================

/**
 * Information extracted from a single stage (basic)
 */
export interface StageInfo {
    stage: string;
    name: string;
    nReturned: number;
    executionTimeMs?: number;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
}

/**
 * Information about a shard in a sharded query
 */
export interface ShardInfo {
    shardName: string;
    stages: StageInfo[];
    nReturned?: number;
    keysExamined?: number;
    docsExamined?: number;
    executionTimeMs?: number;
    hasCollscan?: boolean;
    hasBlockedSort?: boolean;
}

/**
 * Response from Stage 1 - Initial performance view with query planner data
 * Stage 1 provides immediate metrics using queryPlanner verbosity (no execution)
 *
 * @remarks
 * Stage 1 uses explain("queryPlanner") which does NOT execute the query.
 */
export interface QueryInsightsStage1Response {
    executionTime: number; // Client-side measurement in milliseconds
    stages: StageInfo[];
    efficiencyAnalysis: {
        executionStrategy: string;
        indexUsed: string | null;
        hasInMemorySort: boolean;
        // Performance rating not available in Stage 1 (requires execution metrics)
    };
    /** Shard information for sharded collections */
    shards?: ShardInfo[];
    isSharded?: boolean;
}

// ============================================================================
// Stage 2: Detailed Execution Analysis Types
// ============================================================================

/**
 * Response from Stage 2 - Detailed execution statistics
 *
 * @remarks
 * This response contains two `concerns` arrays that serve different purposes:
 * 1. Top-level `concerns: string[]` - Query-level warnings about performance issues
 *    (e.g., "Collection scan detected", "In-memory sort required")
 * 2. `efficiencyAnalysis.performanceRating.concerns: string[]` - Rating-specific concerns
 *    (e.g., "Very low selectivity", "Needs index optimization")
 *
 * The `examinedToReturnedRatio` appears in two forms:
 * - Top-level `examinedToReturnedRatio: number` - Raw ratio for calculations (e.g., 50.5)
 * - `efficiencyAnalysis.examinedReturnedRatio: string` - Formatted for display (e.g., "50:1")
 */
export interface QueryInsightsStage2Response {
    executionTimeMs: number;
    totalKeysExamined: number;
    totalDocsExamined: number;
    documentsReturned: number;
    /** Raw ratio for calculations (e.g., 50.5 means 50.5 docs examined per doc returned) */
    examinedToReturnedRatio: number;
    keysToDocsRatio: number | null;
    executionStrategy: string;
    indexUsed: boolean;
    usedIndexNames: string[];
    hadInMemorySort: boolean;
    hadCollectionScan: boolean;
    isCoveringQuery: boolean;
    /** Top-level query warnings (collection scan, in-memory sort, etc.) */
    concerns: string[];
    efficiencyAnalysis: {
        executionStrategy: string;
        indexUsed: string | null;
        /** Formatted ratio for display (e.g., "50:1") */
        examinedReturnedRatio: string;
        hasInMemorySort: boolean;
        /** Performance rating with detailed reasons and rating-specific concerns */
        performanceRating: PerformanceRating;
    };
    stages: DetailedStageInfo[];
    extendedStageInfo?: ExtendedStageInfo[];
    rawExecutionStats: Record<string, unknown>;
    /** Shard information for sharded collections */
    shards?: ShardInfo[];
    isSharded?: boolean;
}

/**
 * Error information when query execution fails
 */
export interface QueryExecutionError {
    failed: true;
    executionSuccess: false;
    errorMessage: string;
    errorCode?: number;
    failedStage?: {
        stage: string;
        details?: Record<string, unknown>;
    };
    partialStats: {
        docsExamined: number;
        executionTimeMs: number;
    };
}

/**
 * Response when query execution fails (alternative to Stage2Response)
 */
export interface QueryInsightsErrorResponse {
    stage: 'execution-error';
    error: {
        message: string;
        code?: number;
        failedStage?: string;
        partialStats: {
            docsExamined: number;
            executionTimeMs: number;
        };
    };
    // Include partial metrics for context
    executionTimeMs: number;
    docsExamined: number;
    performanceRating: PerformanceRating;
    // Include raw stats for debugging
    rawExplainPlan?: Record<string, unknown>;
}

/**
 * Diagnostic detail about query performance
 */
export interface PerformanceDiagnostic {
    type: 'positive' | 'negative' | 'neutral';
    /** Short message for badge text (e.g., "Low efficiency ratio") */
    message: string;
    /** Detailed explanation shown in tooltip (e.g., "You return 2% of examined documents. This is bad because...") */
    details: string;
}

/**
 * Performance rating with score and detailed diagnostics
 *
 * @remarks
 * Diagnostics always include consistent assessments:
 * - Efficiency ratio (positive/neutral/negative based on returned/examined ratio)
 * - Execution time (positive/neutral/negative based on milliseconds)
 * - Index usage (positive if indexed, negative if collection scan, neutral otherwise)
 * - Sort strategy (positive if no in-memory sort, negative if in-memory sort required)
 *
 * UI can render diagnostics with icons:
 * - positive: ✓ (green checkmark)
 * - neutral: ● (gray dot)
 * - negative: ⚠ (yellow/red warning)
 */
export interface PerformanceRating {
    score: 'excellent' | 'good' | 'fair' | 'poor';
    /** Diagnostic messages explaining the rating, categorized by type */
    diagnostics: PerformanceDiagnostic[];
}

/**
 * Detailed stage information with execution metrics
 */
export interface DetailedStageInfo extends StageInfo {
    works?: number;
    advanced?: number;
    needTime?: number;
    needYield?: number;
    saveState?: number;
    restoreState?: number;
    isEOF?: boolean;
}

/**
 * Extended information for a single stage (for UI display)
 */
export interface ExtendedStageInfo {
    stageId?: string;
    stageName: string;
    properties: Record<string, string | number | boolean | undefined>;
}

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
    payload?: unknown; // Context needed to perform the action (optional for some actions like "learnMore")
}

/**
 * Complete Stage 3 response from router
 */
export interface QueryInsightsStage3Response {
    analysisCard: AnalysisCard;
    improvementCards: ImprovementCard[];
    performanceTips?: {
        tips: Array<{
            title: string;
            description: string;
        }>;
        dismissible: boolean;
    };
    verificationSteps: string; // How to verify improvements
    educationalContent?: string; // Optional markdown content for educational cards
    animation?: {
        staggerDelay: number;
        showTipsDuringLoading: boolean;
    };
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
