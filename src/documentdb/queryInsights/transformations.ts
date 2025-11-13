/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type Document } from 'mongodb';
import { type AIIndexRecommendation, type AIOptimizationResponse } from '../../services/ai/types';
import {
    type ImprovementCard,
    type QueryInsightsStage1Response,
    type QueryInsightsStage2Response,
    type QueryInsightsStage3Response,
    type ShardInfo,
    type StageInfo,
} from '../../webviews/documentdb/collectionView/types/queryInsights';
import { ExplainPlanAnalyzer, type ExecutionStatsAnalysis, type QueryPlannerAnalysis } from './ExplainPlanAnalyzer';

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
    const cardTitle = getCardTitle(improvement.action);
    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);
    const indexOptionsStr =
        improvement.indexOptions && Object.keys(improvement.indexOptions).length > 0
            ? JSON.stringify(improvement.indexOptions, null, 2)
            : undefined;
    const primaryButtonLabel = getPrimaryButtonLabel(improvement.action, improvement.mongoShell);

    return {
        type: 'improvement',
        cardId: `improvement-${index}`,
        title: cardTitle,
        priority: improvement.priority,
        description: improvement.justification,
        recommendedIndex: indexSpecStr,
        indexName: improvement.indexName,
        recommendedIndexDetails: generateIndexExplanation(improvement),
        indexOptions: indexOptionsStr,
        details: improvement.risks || l10n.t('Additional write and storage overhead for maintaining a new index.'),
        mongoShellCommand: improvement.mongoShell,
        primaryButton: {
            label: primaryButtonLabel,
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
            label: l10n.t('Learn More'),
            actionId: 'learnMore',
            payload: {
                topic: 'index-optimization',
            },
        },
    };
}

/**
 * Gets the primary button label based on action and mongoShell command
 */
function getPrimaryButtonLabel(action: string, mongoShell: string): string {
    switch (action) {
        case 'create':
            return l10n.t('Create Index');
        case 'drop':
            return l10n.t('Drop Index');
        case 'modify':
            if (mongoShell.includes('.hideIndex(')) {
                return l10n.t('Hide Index');
            } else if (mongoShell.includes('.unhideIndex(')) {
                return l10n.t('Unhide Index');
            }
            return l10n.t('Modify Index');
        default:
            return l10n.t('No Action');
    }
}

/**
 * Gets the card title based on the action type
 */
function getCardTitle(action: string): string {
    switch (action) {
        case 'create':
            return l10n.t('Recommendation: Create Index');
        case 'drop':
            return l10n.t('Recommendation: Drop Index');
        case 'modify':
            return l10n.t('Recommendation: Modify Index');
        default:
            return l10n.t('Query Performance Insight');
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
            return l10n.t(
                'An index on {0} would allow direct lookup of matching documents and eliminate full collection scans.',
                fields,
            );
        case 'drop':
            return l10n.t(
                'This index on {0} is not being used and adds unnecessary overhead to write operations.',
                fields,
            );
        case 'modify':
            return l10n.t(
                'Optimizing the index on {0} can improve query performance by better matching the query pattern.',
                fields,
            );
        default:
            return l10n.t('No index changes needed at this time.');
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
    // Check if this is a sharded query
    const shardedInfo = extractShardedInfoFromDocument(analyzed.rawPlan);

    if (shardedInfo.isSharded && shardedInfo.shards) {
        // Return sharded response
        return {
            executionTime,
            stages: [], // Top-level stages are in individual shards
            efficiencyAnalysis: {
                executionStrategy: 'Sharded Query',
                indexUsed: null, // Per-shard info
                hasInMemorySort: shardedInfo.shards.some((s) => s.hasBlockedSort || false),
            },
            isSharded: true,
            shards: shardedInfo.shards,
        };
    }

    // Non-sharded query - extract stages normally
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
    // Check if this is a sharded query
    const shardedInfo = extractShardedInfoFromDocument(analyzed.rawStats, true);

    if (shardedInfo.isSharded && shardedInfo.shards) {
        // Calculate examined-to-returned ratio from aggregated data
        const examinedToReturnedRatio =
            analyzed.nReturned > 0 ? analyzed.totalDocsExamined / analyzed.nReturned : Infinity;
        const keysToDocsRatio =
            analyzed.totalDocsExamined > 0 ? analyzed.totalKeysExamined / analyzed.totalDocsExamined : null;

        return {
            executionTimeMs: analyzed.executionTimeMillis,
            totalKeysExamined: analyzed.totalKeysExamined,
            totalDocsExamined: analyzed.totalDocsExamined,
            documentsReturned: analyzed.nReturned,
            examinedToReturnedRatio,
            keysToDocsRatio,
            executionStrategy: 'Sharded Query',
            indexUsed: analyzed.usedIndexes.length > 0,
            usedIndexNames: analyzed.usedIndexes,
            hadInMemorySort: shardedInfo.shards.some((s) => s.hasBlockedSort || false),
            hadCollectionScan: shardedInfo.shards.some((s) => s.hasCollscan || false),
            isCoveringQuery: analyzed.isCovered,
            concerns: buildConcernsForShardedQuery(shardedInfo.shards, examinedToReturnedRatio),
            efficiencyAnalysis: {
                executionStrategy: 'Sharded Query',
                indexUsed: analyzed.usedIndexes.length > 0 ? analyzed.usedIndexes[0] : null,
                examinedReturnedRatio: formatRatioForDisplay(examinedToReturnedRatio),
                hasInMemorySort: shardedInfo.shards.some((s) => s.hasBlockedSort || false),
                performanceRating: analyzed.performanceRating,
            },
            stages: [], // Per-shard stages
            rawExecutionStats: analyzed.rawStats,
            isSharded: true,
            shards: shardedInfo.shards,
            extendedStageInfo: analyzed.extendedStageInfo, // Pass through extended stage properties for UI
        };
    }

    // Non-sharded query - extract stages normally
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
        extendedStageInfo: analyzed.extendedStageInfo, // Pass through extended stage properties for UI
    };
}

/**
 * Extracts stages from explain result document for UI display
 * Recursively traverses the stage tree and flattens it
 *
 * @param explainResult - Raw explain output document
 * @returns Array of stage info for UI
 */
export function extractStagesFromDocument(explainResult: Document): StageInfo[] {
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
 * Formats a ratio for display in the UI
 *
 * @param ratio - The numeric ratio (e.g., 50.5)
 * @returns Formatted string (e.g., "50 : 1", "1 : 1", "∞")
 */
function formatRatioForDisplay(ratio: number): string {
    if (!isFinite(ratio)) {
        return '∞';
    }
    if (ratio < 1) {
        return '1 : 1';
    }
    return `${Math.round(ratio)} : 1`;
}

/**
 * Extracts sharded query information from explain result
 *
 * @param explainResult - Raw explain output document
 * @param hasExecutionStats - Whether this is from executionStats (true) or queryPlanner (false)
 * @returns Sharded query information or indication it's not sharded
 */
function extractShardedInfoFromDocument(
    explainResult: Document,
    hasExecutionStats = false,
): { isSharded: boolean; shards?: ShardInfo[] } {
    // Check for sharded query structure
    const queryPlanner = explainResult.queryPlanner as Document | undefined;
    const executionStats = explainResult.executionStats as Document | undefined;

    // Look for SHARD_MERGE or shards array in winning plan
    const winningPlan = queryPlanner?.winningPlan as Document | undefined;
    const isShardMerge = winningPlan?.stage === 'SHARD_MERGE';
    const shardsArray = winningPlan?.shards as Document[] | undefined;

    if (!isShardMerge || !shardsArray || shardsArray.length === 0) {
        return { isSharded: false };
    }

    // Extract per-shard information
    const shards = shardsArray.map((shardDoc) => {
        const shardName = (shardDoc.shardName as string) || 'unknown';

        // Extract stages from this shard's plan
        let shardStages: StageInfo[] = [];
        if (hasExecutionStats) {
            // Get from executionStats
            const execStatsShards = (executionStats?.executionStages as Document | undefined)?.shards as
                | Document[]
                | undefined;
            const shardExecStats = execStatsShards?.find((s) => (s.shardName as string) === shardName);
            if (shardExecStats) {
                shardStages = extractStagesFromShard(shardExecStats.executionStages as Document);
            }
        } else {
            // Get from queryPlanner
            const shardPlan = shardDoc.winningPlan as Document | undefined;
            if (shardPlan) {
                shardStages = extractStagesFromShard(shardPlan);
            }
        }

        // Extract shard-level metrics from executionStats if available
        let nReturned: number | undefined;
        let keysExamined: number | undefined;
        let docsExamined: number | undefined;
        let executionTimeMs: number | undefined;
        let hasCollscan = false;
        let hasBlockedSort = false;

        if (hasExecutionStats) {
            const execStatsShards = (executionStats?.executionStages as Document | undefined)?.shards as
                | Document[]
                | undefined;
            const shardExecStats = execStatsShards?.find((s) => (s.shardName as string) === shardName);
            if (shardExecStats) {
                nReturned = shardExecStats.nReturned as number | undefined;
                keysExamined = shardExecStats.totalKeysExamined as number | undefined;
                docsExamined = shardExecStats.totalDocsExamined as number | undefined;
                executionTimeMs = shardExecStats.executionTimeMillis as number | undefined;

                // Check for COLLSCAN and SORT in this shard's stages
                const checkStages = (stage: Document): void => {
                    const stageName = stage.stage as string | undefined;
                    if (stageName === 'COLLSCAN') {
                        hasCollscan = true;
                    }
                    if (stageName === 'SORT') {
                        hasBlockedSort = true;
                    }
                    if (stage.inputStage) {
                        checkStages(stage.inputStage as Document);
                    }
                };
                const shardExecStagesDoc = shardExecStats.executionStages as Document | undefined;
                if (shardExecStagesDoc) {
                    checkStages(shardExecStagesDoc);
                }
            }
        } else {
            // For queryPlanner, check for COLLSCAN and SORT in plan
            const checkPlanStages = (stage: Document): void => {
                const stageName = stage.stage as string | undefined;
                if (stageName === 'COLLSCAN') {
                    hasCollscan = true;
                }
                if (stageName === 'SORT') {
                    hasBlockedSort = true;
                }
                if (stage.inputStage) {
                    checkPlanStages(stage.inputStage as Document);
                }
            };
            const shardPlan = shardDoc.winningPlan as Document | undefined;
            if (shardPlan) {
                checkPlanStages(shardPlan);
            }
        }

        return {
            shardName,
            stages: shardStages,
            nReturned,
            keysExamined,
            docsExamined,
            executionTimeMs,
            hasCollscan,
            hasBlockedSort,
        };
    });

    return { isSharded: true, shards };
}

/**
 * Extracts stages from a shard's execution plan
 * Note: Stage-specific properties are provided separately via extendedStageInfo at the response level
 */
function extractStagesFromShard(shardPlan: Document): StageInfo[] {
    const stages: StageInfo[] = [];

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
    }

    traverseStage(shardPlan);
    return stages;
}

/**
 * Builds concerns array for sharded query
 */
function buildConcernsForShardedQuery(shards: ShardInfo[], examinedToReturnedRatio: number): string[] {
    const concerns: string[] = [];

    const hasCollscan = shards.some((s) => s.hasCollscan);
    const hasBlockedSort = shards.some((s) => s.hasBlockedSort);

    if (hasCollscan) {
        concerns.push('Collection scan detected on one or more shards - query examines all documents');
    }
    if (hasBlockedSort) {
        concerns.push('In-memory sort required on one or more shards - memory intensive operation');
    }
    if (examinedToReturnedRatio > 100) {
        concerns.push(
            `High selectivity issue: examining ${examinedToReturnedRatio.toFixed(0)}x more documents than returned`,
        );
    }

    return concerns;
}

/**
 * Enhances stage info with failure indicators for all failed stages
 * MongoDB propagates failed:true up the execution tree, so we mark all of them
 */
export function enhanceStagesWithFailureIndicators(
    analyzed: ExecutionStatsAnalysis,
    explainResult: Document,
): QueryInsightsStage2Response['extendedStageInfo'] {
    const enhancedStageInfo = analyzed.extendedStageInfo ? [...analyzed.extendedStageInfo] : [];
    const failedStageNames = ExplainPlanAnalyzer.extractFailedStageNames(explainResult);

    for (const failedStageName of failedStageNames) {
        const stageIndex = enhancedStageInfo.findIndex((s) => s.stageName === failedStageName);

        if (stageIndex >= 0) {
            // Update existing stage entry
            enhancedStageInfo[stageIndex] = updateStageWithFailureInfo(
                enhancedStageInfo[stageIndex],
                failedStageName,
                analyzed.executionError,
            );
        } else {
            // Create new stage entry
            enhancedStageInfo.push(createFailedStageEntry(failedStageName, analyzed.executionError));
        }
    }

    return enhancedStageInfo;
}

/**
 * Updates an existing stage with failure indicators
 */
function updateStageWithFailureInfo(
    stageInfo: { stageName: string; properties: Record<string, string | number | boolean | undefined> },
    failedStageName: string,
    executionError: ExecutionStatsAnalysis['executionError'],
): { stageName: string; properties: Record<string, string | number | boolean | undefined> } {
    // Convert properties to Map to avoid duplicates
    const propsMap = new Map<string, string | number | boolean | undefined>(Object.entries(stageInfo.properties));

    // Add failure indicator
    propsMap.set('Failed', true);

    // Add error details only for root cause stage
    if (executionError?.failedStage?.stage === failedStageName) {
        propsMap.set('Error Code', executionError.errorCode || 'N/A');
        propsMap.set('Error Message', executionError.errorMessage);
    }

    return {
        ...stageInfo,
        properties: Object.fromEntries(propsMap),
    };
}

/**
 * Creates a new stage entry for a failed stage
 */
function createFailedStageEntry(
    failedStageName: string,
    executionError: ExecutionStatsAnalysis['executionError'],
): { stageName: string; properties: Record<string, string | number | boolean | undefined> } {
    const props: Record<string, string | number | boolean | undefined> = {
        Failed: true,
    };

    // Add error details only for root cause
    if (executionError?.failedStage?.stage === failedStageName) {
        props['Error Code'] = executionError.errorCode || 'N/A';
        props['Error Message'] = executionError.errorMessage;

        // Add stage-specific details if available
        const details = executionError.failedStage?.details;
        if (details) {
            for (const [key, value] of Object.entries(details)) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    props[key] = value;
                }
            }
        }
    }

    return {
        stageName: failedStageName,
        properties: props,
    };
}

/**
 * Creates a Stage 2 response for a failed query execution
 */
export function createFailedQueryResponse(
    analyzed: ExecutionStatsAnalysis,
    explainResult: Document,
): QueryInsightsStage2Response {
    const examinedToReturnedRatio = analyzed.nReturned > 0 ? analyzed.totalDocsExamined / analyzed.nReturned : Infinity;
    const keysToDocsRatio =
        analyzed.totalDocsExamined > 0 ? analyzed.totalKeysExamined / analyzed.totalDocsExamined : null;

    // Extract stages even when query failed - they contain partial execution info
    const stages = extractStagesFromDocument(analyzed.rawStats);

    // Enhance stage info with failure indicators
    const enhancedStageInfo = enhanceStagesWithFailureIndicators(analyzed, explainResult);

    return {
        executionTimeMs: analyzed.executionTimeMillis,
        totalKeysExamined: analyzed.totalKeysExamined,
        totalDocsExamined: analyzed.totalDocsExamined,
        documentsReturned: analyzed.nReturned,
        examinedToReturnedRatio,
        keysToDocsRatio,
        executionStrategy: `Failed: ${analyzed.executionError?.failedStage?.stage || 'Unknown'}`,
        indexUsed: analyzed.usedIndexes.length > 0,
        usedIndexNames: analyzed.usedIndexes,
        hadInMemorySort: analyzed.hasInMemorySort,
        hadCollectionScan: analyzed.isCollectionScan,
        isCoveringQuery: analyzed.isCovered,
        concerns: [
            `Query Execution Failed: ${analyzed.executionError?.errorMessage}`,
            `Failed Stage: ${analyzed.executionError?.failedStage?.stage || 'Unknown'}`,
            `Error Code: ${analyzed.executionError?.errorCode || 'N/A'}`,
        ],
        efficiencyAnalysis: {
            executionStrategy: `Failed at ${analyzed.executionError?.failedStage?.stage || 'Unknown'} stage`,
            indexUsed: analyzed.usedIndexes.length > 0 ? analyzed.usedIndexes[0] : null,
            examinedReturnedRatio:
                examinedToReturnedRatio === Infinity
                    ? 'N/A (query failed)'
                    : `${Math.round(examinedToReturnedRatio)}:1`,
            hasInMemorySort: analyzed.hasInMemorySort,
            performanceRating: analyzed.performanceRating,
        },
        stages,
        rawExecutionStats: analyzed.rawStats,
        extendedStageInfo: enhancedStageInfo,
    };
}
