/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplainPlan } from '@mongodb-js/explain-plan-helper';
import { type Document } from 'mongodb';
import { type ExtendedStageInfo } from '../../webviews/documentdb/collectionView/types/queryInsights';

// ============================================================================
// Index strategy advisory thresholds
// ============================================================================

/** Collection coverage: query returning ≥20% of collection has low selectivity */
const COVERAGE_LOW_SELECTIVITY = 0.2;
/** Collection coverage: query returning ≥50% of collection returns majority */
const COVERAGE_HIGH_RETURN = 0.5;
/** Index cardinality: ≥20% of collection per key bucket signals low-cardinality index */
const CARDINALITY_PER_KEY_RATIO = 0.2;
/** Multikey expansion: ≥5× keys-to-docs ratio triggers informational advisory */
const MULTIKEY_WARN_THRESHOLD = 5;
/** Multikey expansion: ≥20× keys-to-docs ratio triggers severe warning + score demotion */
const MULTIKEY_SEVERE_THRESHOLD = 20;

/**
 * Diagnostic detail about query performance
 */
export interface PerformanceDiagnostic {
    /** Stable identifier for filtering and matching (e.g., 'high_efficiency_ratio') */
    diagnosticId: string;
    type: 'positive' | 'negative' | 'neutral';
    /** Short message for badge text (e.g., "Low efficiency ratio") */
    message: string;
    /** Detailed explanation shown in tooltip (e.g., "You return 2% of examined documents. This is bad because...") */
    details: string;
}

/**
 * Performance rating with score and detailed diagnostics
 */
export interface PerformanceRating {
    score: 'excellent' | 'good' | 'fair' | 'poor';
    /** Diagnostic messages explaining the rating, highlighting strengths and issues */
    diagnostics: PerformanceDiagnostic[];
}

/**
 * Analyzes explain plan outputs using @mongodb-js/explain-plan-helper
 * Provides extraction and analysis for both queryPlanner and executionStats verbosity levels
 */
export class ExplainPlanAnalyzer {
    /**
     * Extracts all stage names that have failed:true from the execution tree
     * MongoDB propagates failed:true up the tree, so we need to mark all of them
     * @param explainResult - Raw MongoDB explain result
     * @returns Array of stage names that have failed:true
     */
    public static extractFailedStageNames(explainResult: Document): string[] {
        const failedStages: string[] = [];

        // Get execution stages from the explain result
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const executionStages = explainResult?.executionStats?.executionStages as Document | undefined;

        if (!executionStages) {
            return failedStages;
        }

        // Recursively traverse the stage tree
        function traverseStage(stage: Document): void {
            const stageName = stage.stage as string | undefined;
            const failed = stage.failed as boolean | undefined;

            if (stageName && failed === true) {
                failedStages.push(stageName);
            }

            // Traverse child stages
            if (stage.inputStage) {
                traverseStage(stage.inputStage as Document);
            }

            if (stage.inputStages && Array.isArray(stage.inputStages)) {
                for (const inputStage of stage.inputStages) {
                    traverseStage(inputStage as Document);
                }
            }

            if (stage.shards && Array.isArray(stage.shards)) {
                for (const shard of stage.shards) {
                    traverseStage(shard as Document);
                }
            }
        }

        traverseStage(executionStages);
        return failedStages;
    }

    /**
     * Analyzes explain("queryPlanner") output
     * Provides basic query characteristics without execution metrics
     *
     * @param explainResult - Raw explain output from MongoDB/DocumentDB
     * @returns Analysis object with query planner information
     */
    public static analyzeQueryPlanner(explainResult: Document): QueryPlannerAnalysis {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        const explainPlan = new ExplainPlan(explainResult as any);

        // Extract metrics using helper methods
        const usedIndexesInfo = explainPlan.usedIndexes || [];
        const usedIndexes = usedIndexesInfo.map((idx) => (typeof idx === 'string' ? idx : idx.index || 'unknown'));
        const isCollectionScan = explainPlan.isCollectionScan;
        const isCovered = explainPlan.isCovered;
        const hasInMemorySort = explainPlan.inMemorySort;
        const namespace = explainPlan.namespace;

        // Build response structure
        return {
            usedIndexes,
            isCollectionScan,
            isCovered,
            hasInMemorySort,
            namespace,
            rawPlan: explainResult,
        };
    }

    /**
     * Analyzes explain("executionStats") output
     * Provides comprehensive execution metrics and performance analysis
     *
     * @param explainResult - Raw explain output with executionStats
     * @returns Analysis object with execution statistics and performance rating
     */
    public static analyzeExecutionStats(explainResult: Document): ExecutionStatsAnalysis {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        const explainPlan = new ExplainPlan(explainResult as any);

        // Extract query filter from command (for empty query detection)
        const command = explainResult.command as Document | undefined;
        const queryFilter = command?.filter as Document | undefined;

        // STEP 1: Check for execution errors FIRST
        const executionStats = explainResult.executionStats as Document | undefined;
        const executionError = this.extractExecutionError(executionStats);

        // Extract execution metrics
        const executionTimeMillis = explainPlan.executionTimeMillis ?? 0;
        const totalDocsExamined = explainPlan.totalDocsExamined ?? 0;
        const totalKeysExamined = explainPlan.totalKeysExamined ?? 0;
        const nReturned = explainPlan.nReturned ?? 0;

        // Calculate efficiency ratio
        const efficiencyRatio = this.calculateEfficiencyRatio(nReturned, totalDocsExamined);

        // Extract query characteristics
        const usedIndexesInfo = explainPlan.usedIndexes || [];
        const usedIndexes = usedIndexesInfo.map((idx) => (typeof idx === 'string' ? idx : idx.index || 'unknown'));
        const isCollectionScan = explainPlan.isCollectionScan;
        const isCovered = explainPlan.isCovered;
        const hasInMemorySort = explainPlan.inMemorySort;
        // Note: isIndexScan is derived from whether indexes are used
        const isIndexScan = usedIndexes.length > 0 && !isCollectionScan;

        // Check if sorting is being performed (either in-memory or index-based)
        // We detect this by checking if there's a SORT stage in the execution plan
        const hasSorting = this.detectSortingInPlan(explainResult);

        // Build response structure
        return {
            executionTimeMillis,
            totalDocsExamined,
            totalKeysExamined,
            nReturned,
            efficiencyRatio,
            usedIndexes,
            isCollectionScan,
            isCovered,
            hasInMemorySort,
            isIndexScan,
            performanceRating: executionError
                ? this.createFailedQueryRating(executionError)
                : this.calculatePerformanceRating(
                      executionTimeMillis,
                      efficiencyRatio,
                      hasInMemorySort,
                      hasSorting,
                      isIndexScan,
                      isCollectionScan,
                      queryFilter,
                  ),
            rawStats: explainResult,
            executionError,
        };
    }

    /**
     * Calculates performance rating with comprehensive diagnostics
     * Based on design doc Section 3.2 thresholds
     *
     * Rating criteria:
     * - Excellent: High efficiency (>=50%), indexed, no in-memory sort, fast (<100ms)
     * - Good: Moderate efficiency (>=10%), indexed or fast (<500ms)
     * - Fair: Low efficiency (>=1%)
     * - Poor: Very low efficiency (<1%) or collection scan (for non-empty queries)
     *
     * Special handling for empty queries:
     * - Collection scans on empty queries (no filter) are treated as neutral, not negative
     * - Rating is based primarily on execution time and efficiency ratio
     *
     * Diagnostics always include:
     * - Efficiency ratio assessment
     * - Execution time assessment
     * - Index usage assessment (adjusted for empty queries)
     * - Sort strategy assessment (only when sorting is performed)
     *
     * @param executionTimeMs - Execution time in milliseconds
     * @param efficiencyRatio - Ratio of documents returned to documents examined
     * @param hasInMemorySort - Whether query performs in-memory sorting
     * @param hasSorting - Whether query performs any sorting (in-memory or index-based)
     * @param isIndexScan - Whether query uses index scan
     * @param isCollectionScan - Whether query performs collection scan
     * @param queryFilter - Optional query filter to detect empty queries
     * @returns Performance rating with score and diagnostics
     */
    private static calculatePerformanceRating(
        executionTimeMs: number,
        efficiencyRatio: number,
        hasInMemorySort: boolean,
        hasSorting: boolean,
        isIndexScan: boolean,
        isCollectionScan: boolean,
        queryFilter?: Document,
    ): PerformanceRating {
        const diagnostics: PerformanceDiagnostic[] = [];

        // Check if this is an empty query (no filter criteria)
        const isEmptyQuery = !queryFilter || Object.keys(queryFilter).length === 0;

        // 1. Efficiency Ratio Assessment (always included)
        if (efficiencyRatio === 0) {
            // nReturned=0 but documents were examined — ratio concept doesn't apply
            diagnostics.push({
                diagnosticId: 'no_matching_documents',
                type: 'neutral',
                message: 'No matching documents',
                details:
                    "Your query examined documents but found no matches.\n\nIf this is unexpected, verify your filter criteria. The query's resource usage is better assessed by the index usage and execution time badges.",
            });
        } else if (efficiencyRatio >= 0.5) {
            diagnostics.push({
                diagnosticId: 'high_efficiency_ratio',
                type: 'positive',
                message: 'High efficiency ratio',
                details: `You return ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis indicates excellent query selectivity and optimal index usage.`,
            });
        } else if (efficiencyRatio >= 0.1) {
            diagnostics.push({
                diagnosticId: 'moderate_efficiency_ratio',
                type: 'neutral',
                message: 'Moderate efficiency ratio',
                details: `You return ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis is acceptable but could be improved with better index coverage or more selective filters.`,
            });
        } else if (efficiencyRatio >= 0.01) {
            diagnostics.push({
                diagnosticId: 'low_efficiency_ratio',
                type: 'negative',
                message: 'Low efficiency ratio',
                details: `You return only ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis indicates poor query selectivity - the database examines many documents that don't match your query criteria.\n\nConsider adding more selective indexes or refining your query filters.`,
            });
        } else {
            diagnostics.push({
                diagnosticId: 'very_low_efficiency_ratio',
                type: 'negative',
                message: 'Very low efficiency ratio',
                details: `You return only ${(efficiencyRatio * 100).toFixed(2)}% of examined documents.\n\nThis is extremely inefficient - the database examines thousands of documents for each result returned.\n\nThis severely impacts performance and should be addressed with better indexing strategies.`,
            });
        }

        // 2. Execution Time Assessment (always included)
        if (executionTimeMs < 100) {
            diagnostics.push({
                diagnosticId: 'fast_execution',
                type: 'positive',
                message: 'Fast execution',
                details: `Query completed in ${executionTimeMs.toFixed(1)}ms.\n\nThis is excellent performance and provides a responsive user experience.`,
            });
        } else if (executionTimeMs < 500) {
            diagnostics.push({
                diagnosticId: 'acceptable_execution',
                type: 'neutral',
                message: 'Acceptable execution time',
                details: `Query completed in ${executionTimeMs.toFixed(1)}ms.\n\nThis is acceptable for most use cases, though optimization could improve responsiveness.`,
            });
        } else if (executionTimeMs < 2000) {
            diagnostics.push({
                diagnosticId: 'slow_execution',
                type: 'negative',
                message: 'Slow execution',
                details: `Query took ${executionTimeMs.toFixed(1)}ms to complete.\n\nThis may impact user experience.\n\nConsider adding indexes or optimizing your query structure.`,
            });
        } else {
            diagnostics.push({
                diagnosticId: 'very_slow_execution',
                type: 'negative',
                message: 'Very slow execution',
                details: `Query took ${(executionTimeMs / 1000).toFixed(2)}s to complete.\n\nThis significantly impacts performance and user experience.\n\nImmediate optimization is recommended.`,
            });
        }

        // 3. Index Usage Assessment (always included)
        if (isIndexScan) {
            diagnostics.push({
                diagnosticId: 'index_used',
                type: 'positive',
                message: 'Index used',
                details:
                    'Your query uses an index.\n\nThis allows the database to efficiently locate matching documents without scanning the entire collection.',
            });
        } else if (isCollectionScan) {
            // For empty queries (no filter), collection scan is expected and neutral
            if (isEmptyQuery) {
                diagnostics.push({
                    diagnosticId: 'full_collection_scan',
                    type: 'neutral',
                    message: 'Full collection scan',
                    details:
                        'Your query performs a full collection scan since no filter criteria are specified.\n\nThis is expected behavior for queries that retrieve all documents. Consider adding filters if you only need a subset of documents.',
                });
            } else {
                diagnostics.push({
                    diagnosticId: 'full_collection_scan',
                    type: 'negative',
                    message: 'Full collection scan',
                    details:
                        'Your query performs a full collection scan, examining every document in the collection.\n\nThis is inefficient and slow, especially for large collections.\n\nAdd an index on the queried fields to improve performance.',
                });
            }
        } else {
            diagnostics.push({
                diagnosticId: 'no_index_used',
                type: 'neutral',
                message: 'No index used',
                details:
                    'Your query does not use an index.\n\nWhile not necessarily a problem for small collections, adding appropriate indexes can significantly improve query performance.',
            });
        }

        // 4. Sort Strategy Assessment (only if sorting is performed)
        if (hasSorting) {
            if (hasInMemorySort) {
                diagnostics.push({
                    diagnosticId: 'in_memory_sort',
                    type: 'negative',
                    message: 'In-memory sort required',
                    details:
                        'Your query requires sorting data in memory, which is limited by available RAM and can fail for large result sets.\n\nConsider adding a compound index that includes your sort fields to enable index-based sorting.',
                });
            } else {
                diagnostics.push({
                    diagnosticId: 'efficient_sorting',
                    type: 'positive',
                    message: 'Efficient sorting',
                    details:
                        'Your query uses index-based sorting, which is efficient and avoids memory constraints.\n\nThis improves performance by leveraging the natural order of the index.',
                });
            }
        } else {
            // No sorting required - add neutral diagnostic
            diagnostics.push({
                diagnosticId: 'no_sorting_required',
                type: 'neutral',
                message: 'No sorting required',
                details: 'Your query does not require sorting, which avoids additional processing overhead.',
            });
        }

        // Determine overall score based on thresholds
        let score: 'excellent' | 'good' | 'fair' | 'poor';

        // For empty queries with collection scan, don't penalize - treat as neutral
        if (isEmptyQuery && isCollectionScan) {
            // Score based on execution time and efficiency only
            if (efficiencyRatio >= 0.5 && executionTimeMs < 100) {
                score = 'excellent';
            } else if (efficiencyRatio >= 0.1 && executionTimeMs < 500) {
                score = 'good';
            } else if (executionTimeMs < 2000) {
                score = 'fair';
            } else {
                score = 'poor';
            }
        } else if (isCollectionScan && efficiencyRatio < 0.01) {
            // Non-empty query with poor efficiency and collection scan
            score = 'poor';
        } else if (efficiencyRatio >= 0.5 && isIndexScan && !hasInMemorySort && executionTimeMs < 100) {
            score = 'excellent';
        } else if (efficiencyRatio >= 0.1 && (isIndexScan || executionTimeMs < 500)) {
            score = 'good';
        } else if (efficiencyRatio >= 0.01) {
            score = 'fair';
        } else {
            score = 'poor';
        }

        return {
            score,
            diagnostics,
        };
    }

    /**
     * Calculates the efficiency ratio (documents returned / documents examined)
     * A ratio close to 1.0 indicates high efficiency
     *
     * @param returned - Number of documents returned
     * @param examined - Number of documents examined
     * @returns Efficiency ratio (0.0 to 1.0+)
     */
    private static calculateEfficiencyRatio(returned: number, examined: number): number {
        if (examined === 0) {
            return returned === 0 ? 1.0 : 0.0;
        }
        return returned / examined;
    }

    /**
     * Detects if sorting is being performed in the execution plan
     * Checks for SORT or SORT_KEY_GENERATOR stages in the execution tree
     *
     * @param explainResult - Raw explain output document
     * @returns True if sorting is detected, false otherwise
     */
    private static detectSortingInPlan(explainResult: Document): boolean {
        // First, check if the command includes a sort specification
        const command = explainResult.command as Document | undefined;
        if (command?.sort) {
            const sortSpec = command.sort as Document;
            // Check if sort is non-empty (not just {})
            if (Object.keys(sortSpec).length > 0) {
                return true;
            }
        }

        // Also check for explicit SORT stages (in-memory sort)
        const executionStats = explainResult.executionStats as Document | undefined;
        if (!executionStats) {
            return false;
        }

        const executionStages = executionStats.executionStages as Document | undefined;
        if (!executionStages) {
            return false;
        }

        // Recursively check for SORT stages
        const checkStageForSort = (stage: Document): boolean => {
            const stageName = stage.stage as string | undefined;

            if (stageName === 'SORT' || stageName === 'SORT_KEY_GENERATOR') {
                return true;
            }

            // Check child stages
            if (stage.inputStage) {
                if (checkStageForSort(stage.inputStage as Document)) {
                    return true;
                }
            }

            if (stage.inputStages && Array.isArray(stage.inputStages)) {
                for (const childStage of stage.inputStages) {
                    if (checkStageForSort(childStage as Document)) {
                        return true;
                    }
                }
            }

            if (stage.shards && Array.isArray(stage.shards)) {
                for (const shard of stage.shards) {
                    if (checkStageForSort(shard as Document)) {
                        return true;
                    }
                }
            }

            return false;
        };

        return checkStageForSort(executionStages);
    }

    /**
     * Extracts execution error information from explain plan
     * Returns undefined if query executed successfully
     *
     * @param executionStats - The executionStats section from explain result
     * @returns Error information or undefined if successful
     */
    private static extractExecutionError(executionStats: Document | undefined): QueryExecutionError | undefined {
        if (!executionStats) {
            return undefined;
        }

        // Check primary indicator
        const executionSuccess = executionStats.executionSuccess as boolean | undefined;
        const failed = executionStats.failed as boolean | undefined;

        // Query succeeded
        if (executionSuccess !== false && failed !== true) {
            return undefined;
        }

        // Query failed - extract error details
        const errorMessage = executionStats.errorMessage as string | undefined;
        const errorCode = executionStats.errorCode as number | undefined;

        // Find which stage failed
        const failedStage = this.findFailedStage(executionStats.executionStages as Document | undefined);

        return {
            failed: true,
            executionSuccess: false,
            errorMessage: errorMessage || 'Query execution failed (no error message provided)',
            errorCode,
            failedStage,
            partialStats: {
                docsExamined: (executionStats.totalDocsExamined as number) ?? 0,
                executionTimeMs: (executionStats.executionTimeMillis as number) ?? 0,
            },
        };
    }

    /**
     * Finds the stage where execution failed by traversing the stage tree
     * Returns the deepest stage with failed: true
     *
     * @param executionStages - The executionStages section from executionStats
     * @returns Information about the failed stage or undefined
     */
    private static findFailedStage(
        executionStages: Document | undefined,
    ): { stage: string; details?: Record<string, unknown> } | undefined {
        if (!executionStages) {
            return undefined;
        }

        const findFailedInStage = (
            stage: Document,
        ): { stage: string; details?: Record<string, unknown> } | undefined => {
            const stageName = stage.stage as string | undefined;
            const stageFailed = stage.failed as boolean | undefined;

            if (!stageName) {
                return undefined;
            }

            // Check input stages first (depth-first to find root cause)
            if (stage.inputStage) {
                const childResult = findFailedInStage(stage.inputStage as Document);
                if (childResult) {
                    return childResult; // Return deepest failed stage
                }
            }

            if (stage.inputStages && Array.isArray(stage.inputStages)) {
                for (const inputStage of stage.inputStages) {
                    const childResult = findFailedInStage(inputStage as Document);
                    if (childResult) {
                        return childResult;
                    }
                }
            }

            // If this stage failed and no child failed, this is the root cause
            if (stageFailed) {
                return {
                    stage: stageName,
                    details: this.extractStageErrorDetails(stageName, stage),
                };
            }

            return undefined;
        };

        return findFailedInStage(executionStages);
    }

    /**
     * Extracts relevant error details from a failed stage
     *
     * @param stageName - Name of the failed stage
     * @param stage - The stage document
     * @returns Relevant details for the failed stage
     */
    private static extractStageErrorDetails(stageName: string, stage: Document): Record<string, unknown> | undefined {
        switch (stageName) {
            case 'SORT':
                return {
                    memLimit: stage.memLimit,
                    sortPattern: stage.sortPattern,
                    usedDisk: stage.usedDisk,
                };
            case 'GROUP':
                return {
                    maxMemoryUsageBytes: stage.maxMemoryUsageBytes,
                };
            default:
                return undefined;
        }
    }

    /**
     * Creates a performance rating for a failed query
     * This provides clear diagnostics explaining the failure
     *
     * @param error - The execution error information
     * @returns Performance rating with failure diagnostics
     */
    private static createFailedQueryRating(error: QueryExecutionError): PerformanceRating {
        const diagnostics: PerformanceDiagnostic[] = [];

        // Primary diagnostic: Query failed
        diagnostics.push({
            diagnosticId: 'query_execution_failed',
            type: 'negative',
            message: 'Query execution failed',
            details: `${error.errorMessage}\n\nThe query did not complete successfully. Performance metrics shown are partial and measured up to the failure point.`,
        });

        // Stage-specific diagnostics
        if (error.failedStage) {
            const stageDiagnostic = this.createStageFailureDiagnostic(error.failedStage, error.errorCode);
            if (stageDiagnostic) {
                diagnostics.push(stageDiagnostic);
            }
        }

        return {
            score: 'poor',
            diagnostics,
        };
    }

    /**
     * Creates stage-specific diagnostic with actionable guidance
     *
     * @param failedStage - Information about the failed stage
     * @param errorCode - MongoDB error code
     * @returns Diagnostic with solutions or undefined
     */
    private static createStageFailureDiagnostic(
        failedStage: { stage: string; details?: Record<string, unknown> },
        errorCode?: number,
    ): PerformanceDiagnostic | undefined {
        const { stage, details } = failedStage;

        // Sort memory limit exceeded (Error 292)
        if (stage === 'SORT' && errorCode === 292) {
            const memLimit = details?.memLimit as number | undefined;
            const sortPattern = details?.sortPattern as Document | undefined;
            const memLimitMB = memLimit ? (memLimit / (1024 * 1024)).toFixed(1) : 'unknown';

            return {
                diagnosticId: 'sort_exceeded_memory_limit',
                type: 'negative',
                message: 'Sort exceeded memory limit',
                details:
                    `The SORT stage exceeded the ${memLimitMB}MB memory limit.\n\n` +
                    `**Solutions:**\n` +
                    `1. Add .allowDiskUse(true) to allow disk-based sorting for large result sets\n` +
                    `2. Create an index matching the sort pattern: ${JSON.stringify(sortPattern)}\n` +
                    `3. Add filters to reduce the number of documents being sorted\n` +
                    `4. Increase server memory limit (requires server configuration)`,
            };
        }

        // Generic stage failure
        return {
            diagnosticId: 'stage_failed',
            type: 'negative',
            message: `${stage} stage failed`,
            details: `The ${stage} stage could not complete execution.\n\nReview the error message and query structure for potential issues.`,
        };
    }

    // ========================================================================
    // Index strategy advisory helpers (Tasks 3–5)
    // ========================================================================

    /**
     * Recursively searches a plan tree for the first stage matching `stageName`.
     * Works on both `queryPlanner.winningPlan` and `executionStats.executionStages` trees.
     *
     * @param plan  - Root node of the plan tree (or undefined)
     * @param stageName - Stage name to match (e.g., 'IXSCAN', 'COLLSCAN')
     * @returns The matching stage document, or undefined
     */
    public static findStageInPlan(plan: Document | undefined, stageName: string): Document | undefined {
        if (!plan) {
            return undefined;
        }

        if ((plan.stage as string) === stageName) {
            return plan;
        }

        // Traverse single child
        if (plan.inputStage) {
            const found = this.findStageInPlan(plan.inputStage as Document, stageName);
            if (found) {
                return found;
            }
        }

        // Traverse multiple children
        if (Array.isArray(plan.inputStages)) {
            for (const child of plan.inputStages) {
                const found = this.findStageInPlan(child as Document, stageName);
                if (found) {
                    return found;
                }
            }
        }

        return undefined;
    }

    /**
     * Detects whether the query uses a low-cardinality index, meaning
     * the index doesn't differentiate well between documents.
     *
     * Three independent signals:
     *  1. `isBitmap === true` on the IXSCAN stage (DocumentDB bitmap index)
     *  2. Boolean literal in the query filter (`true`/`false` values)
     *  3. High `estimatedEntryCount` in `scanKeys` relative to collection size
     *
     * @param explainResult       - Raw explain result document
     * @param totalCollectionDocs - Estimated total documents in collection (optional)
     * @param queryFilter         - The query filter document (optional)
     * @returns Detection result with reasons
     */
    public static detectLowCardinalityIndex(
        explainResult: Document,
        totalCollectionDocs: number | undefined,
        queryFilter?: Document,
    ): { isLowCardinality: boolean; reasons: string[] } {
        const reasons: string[] = [];

        // Signal 1: isBitmap flag on the IXSCAN stage (from queryPlanner.winningPlan)
        const winningPlan = (explainResult.queryPlanner as Document | undefined)?.winningPlan as Document | undefined;
        const ixscanStage = this.findStageInPlan(winningPlan, 'IXSCAN');
        if (ixscanStage?.isBitmap === true) {
            reasons.push('Bitmap index detected — typically used for low-cardinality fields');
        }

        // Signal 2: Boolean literal in query filter
        if (queryFilter) {
            for (const value of Object.values(queryFilter)) {
                if (typeof value === 'boolean') {
                    reasons.push('Query filters on a boolean field, which has only two distinct values');
                    break;
                }
            }
        }

        // Signal 3: estimatedEntryCount from scanKeys strings (DocumentDB-specific)
        if (totalCollectionDocs && totalCollectionDocs > 0) {
            const executionStages = (explainResult.executionStats as Document | undefined)?.executionStages as
                | Document
                | undefined;
            const ixscanExec = this.findStageInPlan(executionStages, 'IXSCAN');
            const indexUsage = ixscanExec?.indexUsage as Array<{ scanKeys?: string[] }> | undefined;

            if (indexUsage) {
                for (const usage of indexUsage) {
                    if (usage.scanKeys) {
                        for (const scanKey of usage.scanKeys) {
                            // Parse: "key N: [(isInequality: false, estimatedEntryCount: 22074)]"
                            const match = /estimatedEntryCount:\s*(\d+)/.exec(scanKey);
                            if (match) {
                                const entryCount = parseInt(match[1], 10);
                                if (entryCount >= CARDINALITY_PER_KEY_RATIO * totalCollectionDocs) {
                                    reasons.push(
                                        `Index key covers ${((entryCount / totalCollectionDocs) * 100).toFixed(0)}% of the collection per bucket`,
                                    );
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return { isLowCardinality: reasons.length > 0, reasons };
    }

    /**
     * Appends index-strategy advisory diagnostics to an existing analysis.
     * Called **after** `calculatePerformanceRating` has run so that scoring
     * diagnostics are already present; this method adds informational badges.
     *
     * All advisories are gated on `analysis.isIndexScan === true` (except
     * multikey, which is relevant regardless of index type).
     *
     * Mutates `analysis.performanceRating.diagnostics` in place.
     *
     * @param analysis            - The execution stats analysis (will be mutated)
     * @param totalCollectionDocs - Estimated total documents in the collection (or undefined)
     * @param explainResult       - Raw explain result document
     */
    public static addIndexStrategyAdvisories(
        analysis: ExecutionStatsAnalysis,
        totalCollectionDocs: number | undefined,
        explainResult: Document,
    ): void {
        const diagnostics = analysis.performanceRating.diagnostics;

        // --- Coverage badges (gated on index scan) ---
        if (analysis.isIndexScan && totalCollectionDocs && totalCollectionDocs > 0) {
            const coverage = analysis.nReturned / totalCollectionDocs;

            if (coverage >= COVERAGE_HIGH_RETURN) {
                diagnostics.push({
                    diagnosticId: 'returns_majority_of_collection',
                    type: 'neutral',
                    message: 'Returns majority of collection',
                    details: `Your query returns ${(coverage * 100).toFixed(1)}% of the collection.\n\nWhen returning more than half the documents, a collection scan may actually be faster than an index lookup because sequential reads are more efficient than random index-pointer chasing.`,
                });
            } else if (coverage >= COVERAGE_LOW_SELECTIVITY) {
                diagnostics.push({
                    diagnosticId: 'low_filter_selectivity',
                    type: 'neutral',
                    message: 'Low filter selectivity',
                    details: `Your query returns ${(coverage * 100).toFixed(1)}% of the collection.\n\nA more selective filter would narrow results further and let the index skip more documents.`,
                });
            }
        }

        // --- Low-cardinality index badge (gated on index scan) ---
        if (analysis.isIndexScan) {
            const queryFilter = (explainResult.command as Document | undefined)?.filter as Document | undefined;
            const cardinalityResult = this.detectLowCardinalityIndex(explainResult, totalCollectionDocs, queryFilter);

            if (cardinalityResult.isLowCardinality) {
                diagnostics.push({
                    diagnosticId: 'low_cardinality_index',
                    type: 'neutral',
                    message: 'Low-cardinality index',
                    details: `The index used has low cardinality — it doesn't differentiate well between documents.\n\n${cardinalityResult.reasons.join('\n')}\n\nConsider using a more selective index field or a compound index that includes high-cardinality fields.`,
                });
            }
        }

        // --- Multikey expansion badges (not gated on index scan) ---
        if (analysis.totalKeysExamined > 0 && analysis.totalDocsExamined > 0) {
            const multikeyMultiplier = analysis.totalKeysExamined / analysis.totalDocsExamined;

            if (multikeyMultiplier >= MULTIKEY_SEVERE_THRESHOLD) {
                diagnostics.push({
                    diagnosticId: 'severe_multikey_expansion',
                    type: 'negative',
                    message: 'Severe multikey expansion',
                    details: `The index examined ${multikeyMultiplier.toFixed(1)}× more keys than documents.\n\nThis typically happens with indexes on array fields where each array element generates a separate index entry. The database must examine many index keys for each document.\n\nConsider restructuring the data to avoid indexing large arrays, or use a different query pattern.`,
                });

                // Demote score by one level for severe multikey
                const scoreOrder: Array<ExecutionStatsAnalysis['performanceRating']['score']> = [
                    'excellent',
                    'good',
                    'fair',
                    'poor',
                ];
                const currentIndex = scoreOrder.indexOf(analysis.performanceRating.score);
                if (currentIndex >= 0 && currentIndex < scoreOrder.length - 1) {
                    analysis.performanceRating.score = scoreOrder[currentIndex + 1];
                }
            } else if (multikeyMultiplier >= MULTIKEY_WARN_THRESHOLD) {
                diagnostics.push({
                    diagnosticId: 'high_multikey_expansion',
                    type: 'neutral',
                    message: 'High multikey expansion',
                    details: `The index examined ${multikeyMultiplier.toFixed(1)}× more keys than documents.\n\nThis is common with indexes on array fields. Each array element generates a separate index entry, increasing the number of keys the database must examine.\n\nThis is usually acceptable but can become a concern as array sizes grow.`,
                });
            }
        }
    }
}

/**
 * Result from analyzing queryPlanner output
 */
export interface QueryPlannerAnalysis {
    usedIndexes: string[];
    isCollectionScan: boolean;
    isCovered: boolean;
    hasInMemorySort: boolean;
    namespace: string;
    rawPlan: Document;
}

/**
 * Error information from a failed query execution
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
 * Result from analyzing executionStats output
 */
export interface ExecutionStatsAnalysis {
    executionTimeMillis: number;
    totalDocsExamined: number;
    totalKeysExamined: number;
    nReturned: number;
    efficiencyRatio: number;
    usedIndexes: string[];
    isCollectionScan: boolean;
    isCovered: boolean;
    hasInMemorySort: boolean;
    isIndexScan: boolean;
    performanceRating: PerformanceRating;
    rawStats: Document;
    extendedStageInfo?: ExtendedStageInfo[];
    executionError?: QueryExecutionError;
}
