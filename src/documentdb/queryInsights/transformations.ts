/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { type AIIndexRecommendation, type AIOptimizationResponse } from '../../services/ai/types';
import {
    type ImprovementCard,
    type QueryInsightsStage1Response,
    type QueryInsightsStage2Response,
    type QueryInsightsStage3Response,
    type StageInfo,
} from '../../webviews/documentdb/collectionView/types/queryInsights';
import { type ExecutionStatsAnalysis, type QueryPlannerAnalysis } from './ExplainPlanAnalyzer';

/**
 * Context from the router containing connection and collection info
 */
interface TransformationContext {
    clusterId: string;
    databaseName: string;
    collectionName: string;
}

/**
 * Transforms AI optimization response to UI-friendly format
 * Adds action buttons with complete payloads for execution
 *
 * @param aiResponse - Raw AI service response
 * @param context - Router context with connection info
 * @returns Transformed response ready for UI consumption
 */
export function transformAIResponseForUI(
    aiResponse: AIOptimizationResponse,
    context: TransformationContext,
): QueryInsightsStage3Response {
    const analysisCard = {
        type: 'analysis' as const,
        content: aiResponse.analysis,
    };

    const improvementCards = aiResponse.improvements.map((improvement, index) => {
        return createImprovementCard(improvement, index, context);
    });

    // Join verification steps into a single string
    const verificationSteps = aiResponse.verification.join('\n');

    return {
        analysisCard,
        improvementCards,
        verificationSteps,
        educationalContent: aiResponse.educationalContent,
    };
}

/**
 * Creates an improvement card from an AI recommendation
 */
function createImprovementCard(
    improvement: AIIndexRecommendation,
    index: number,
    context: TransformationContext,
): ImprovementCard {
    const actionVerb = getActionVerb(improvement.action);
    const cardTitle = getCardTitle(improvement.action);
    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);

    return {
        type: 'improvement',
        cardId: `improvement-${index}`,
        title: cardTitle,
        priority: improvement.priority,
        description: improvement.justification,
        recommendedIndex: indexSpecStr,
        recommendedIndexDetails: generateIndexExplanation(improvement),
        details: improvement.risks || 'Additional write and storage overhead for maintaining a new index.',
        mongoShellCommand: improvement.mongoShell,
        primaryButton: {
            label: `${actionVerb} Index`,
            actionId: getPrimaryActionId(improvement.action),
            payload: {
                clusterId: context.clusterId,
                databaseName: context.databaseName,
                collectionName: context.collectionName,
                action: improvement.action,
                indexSpec: improvement.indexSpec,
                indexOptions: improvement.indexOptions,
                mongoShell: improvement.mongoShell,
            },
        },
        secondaryButton: {
            label: 'Learn More',
            actionId: 'learnMore',
            payload: {
                topic: 'index-optimization',
            },
        },
    };
}

/**
 * Gets the action verb for display
 */
function getActionVerb(action: string): string {
    switch (action) {
        case 'create':
            return 'Create';
        case 'drop':
            return 'Drop';
        case 'modify':
            return 'Modify';
        default:
            return 'No Action';
    }
}

/**
 * Gets the card title based on the action type
 */
function getCardTitle(action: string): string {
    switch (action) {
        case 'create':
            return 'Recommendation: Create Index';
        case 'drop':
            return 'Recommendation: Drop Index';
        case 'modify':
            return 'Recommendation: Modify Index';
        default:
            return 'Query Performance Insight';
    }
}

/**
 * Gets the primary action ID for the button
 */
function getPrimaryActionId(action: string): string {
    switch (action) {
        case 'create':
            return 'createIndex';
        case 'drop':
            return 'dropIndex';
        case 'modify':
            return 'modifyIndex';
        default:
            return 'noAction';
    }
}

/**
 * Generates a user-friendly explanation of what the index does
 */
function generateIndexExplanation(improvement: AIIndexRecommendation): string {
    const fields = Object.keys(improvement.indexSpec).join(', ');

    switch (improvement.action) {
        case 'create':
            return `An index on ${fields} would allow direct lookup of matching documents and eliminate full collection scans.`;
        case 'drop':
            return `This index on ${fields} is not being used and adds unnecessary overhead to write operations.`;
        case 'modify':
            return `Optimizing the index on ${fields} can improve query performance by better matching the query pattern.`;
        default:
            return 'No index changes needed at this time.';
    }
}

/**
 * Transforms query planner analysis to Stage 1 response format
 *
 * @param analyzed - Query planner analysis from ExplainPlanAnalyzer
 * @param executionTime - Execution time in milliseconds (from ClusterSession)
 * @returns Stage 1 response ready for UI
 *
 * @remarks
 * Stage 1 uses explain("queryPlanner") which does NOT execute the query.
 * Therefore, documentsReturned is not available and will show as 0.
 * The actual document count is only available in Stage 2 with explain("executionStats").
 */
export function transformStage1Response(
    analyzed: QueryPlannerAnalysis,
    executionTime: number,
): QueryInsightsStage1Response {
    // Extract stages from the raw plan
    const stages = extractStagesFromDocument(analyzed.rawPlan);

    // Determine execution strategy
    let executionStrategy = 'Unknown';
    if (analyzed.isCovered) {
        executionStrategy = 'Covered Query (Index Only)';
    } else if (analyzed.usedIndexes.length > 0) {
        executionStrategy = 'Index Scan + Fetch';
    } else if (analyzed.isCollectionScan) {
        executionStrategy = 'Collection Scan';
    }

    return {
        executionTime,
        documentsReturned: 0, // Not available in queryPlanner mode - only in executionStats (Stage 2)
        stages,
        efficiencyAnalysis: {
            executionStrategy,
            indexUsed: analyzed.usedIndexes.length > 0 ? analyzed.usedIndexes[0] : null,
            hasInMemorySort: analyzed.hasInMemorySort,
        },
    };
}

/**
 * Transforms execution stats analysis to Stage 2 response format
 *
 * @param analyzed - Execution stats analysis from ExplainPlanAnalyzer
 * @returns Stage 2 response ready for UI
 */
export function transformStage2Response(analyzed: ExecutionStatsAnalysis): QueryInsightsStage2Response {
    // Extract stages from the raw stats
    const stages = extractStagesFromDocument(analyzed.rawStats);

    // Calculate examined-to-returned ratio (inverse of efficiency ratio)
    const examinedToReturnedRatio = analyzed.nReturned > 0 ? analyzed.totalDocsExamined / analyzed.nReturned : Infinity;

    // Calculate keys-to-docs ratio
    const keysToDocsRatio =
        analyzed.totalDocsExamined > 0 ? analyzed.totalKeysExamined / analyzed.totalDocsExamined : null;

    // Determine execution strategy
    let executionStrategy = 'Unknown';
    if (analyzed.isCovered) {
        executionStrategy = 'Covered Query (Index Only)';
    } else if (analyzed.usedIndexes.length > 0 && analyzed.isCollectionScan) {
        executionStrategy = 'Index Scan + Collection Scan';
    } else if (analyzed.usedIndexes.length > 0) {
        executionStrategy = 'Index Scan + Fetch';
    } else if (analyzed.isCollectionScan) {
        executionStrategy = 'Collection Scan';
    }

    // Build top-level concerns array
    const concerns: string[] = [];
    if (analyzed.isCollectionScan) {
        concerns.push('Collection scan detected - query examines all documents');
    }
    if (analyzed.hasInMemorySort) {
        concerns.push('In-memory sort required - memory intensive operation');
    }
    if (examinedToReturnedRatio > 100) {
        concerns.push(
            `High selectivity issue: examining ${examinedToReturnedRatio.toFixed(0)}x more documents than returned`,
        );
    }

    // Format examined-to-returned ratio for display
    const examinedReturnedRatioFormatted = formatRatioForDisplay(examinedToReturnedRatio);

    return {
        executionTimeMs: analyzed.executionTimeMillis,
        totalKeysExamined: analyzed.totalKeysExamined,
        totalDocsExamined: analyzed.totalDocsExamined,
        documentsReturned: analyzed.nReturned,
        examinedToReturnedRatio,
        keysToDocsRatio,
        executionStrategy,
        indexUsed: analyzed.usedIndexes.length > 0,
        usedIndexNames: analyzed.usedIndexes,
        hadInMemorySort: analyzed.hasInMemorySort,
        hadCollectionScan: analyzed.isCollectionScan,
        isCoveringQuery: analyzed.isCovered,
        concerns,
        efficiencyAnalysis: {
            executionStrategy,
            indexUsed: analyzed.usedIndexes.length > 0 ? analyzed.usedIndexes[0] : null,
            examinedReturnedRatio: examinedReturnedRatioFormatted,
            hasInMemorySort: analyzed.hasInMemorySort,
            performanceRating: analyzed.performanceRating,
        },
        stages: stages.map((stage) => ({
            ...stage,
            // Stage 2 has access to execution metrics
        })),
        rawExecutionStats: analyzed.rawStats,
    };
}

/**
 * Extracts stages from explain result document for UI display
 * Recursively traverses the stage tree and flattens it
 *
 * @param explainResult - Raw explain output document
 * @returns Array of stage info for UI
 */
function extractStagesFromDocument(explainResult: Document): StageInfo[] {
    const stages: StageInfo[] = [];

    // Try to get execution stages first (from executionStats), fall back to query planner
    const executionStages =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (explainResult.executionStats?.executionStages as Document | undefined) ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (explainResult.queryPlanner?.winningPlan as Document | undefined);

    if (!executionStages) {
        return stages;
    }

    // Recursively traverse stages
    function traverseStage(stage: Document): void {
        const stageName: string = (stage.stage as string | undefined) || 'UNKNOWN';

        stages.push({
            stage: stageName,
            name: (stage.name as string | undefined) || stageName,
            nReturned: (stage.nReturned as number | undefined) ?? 0,
            executionTimeMs:
                (stage.executionTimeMillis as number | undefined) ??
                (stage.executionTimeMillisEstimate as number | undefined),
            indexName: stage.indexName as string | undefined,
            keysExamined: stage.keysExamined as number | undefined,
            docsExamined: stage.docsExamined as number | undefined,
        });

        // Traverse child stages
        if (stage.inputStage) {
            traverseStage(stage.inputStage as Document);
        }

        if (stage.inputStages && Array.isArray(stage.inputStages)) {
            stage.inputStages.forEach((s: Document) => traverseStage(s));
        }

        if (stage.shards && Array.isArray(stage.shards)) {
            stage.shards.forEach((s: Document) => traverseStage(s));
        }
    }

    traverseStage(executionStages);
    return stages;
}

/**
 * Formats the examined-to-returned ratio for display
 *
 * @param ratio - Raw ratio value
 * @returns Formatted string (e.g., "50:1", "1:1", "∞")
 */
function formatRatioForDisplay(ratio: number): string {
    if (!isFinite(ratio)) {
        return '∞';
    }
    if (ratio < 1) {
        return '1:1';
    }
    return `${Math.round(ratio)}:1`;
}
