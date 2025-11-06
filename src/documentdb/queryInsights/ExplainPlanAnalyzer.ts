/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplainPlan } from '@mongodb-js/explain-plan-helper';
import { type Document } from 'mongodb';
import { type ExtendedStageInfo } from '../../webviews/documentdb/collectionView/types/queryInsights';

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
            performanceRating: this.calculatePerformanceRating(
                executionTimeMillis,
                efficiencyRatio,
                hasInMemorySort,
                hasSorting,
                isIndexScan,
                isCollectionScan,
            ),
            rawStats: explainResult,
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
     * - Poor: Very low efficiency (<1%) or collection scan
     *
     * Diagnostics always include:
     * - Efficiency ratio assessment
     * - Execution time assessment
     * - Index usage assessment
     * - Sort strategy assessment (only when sorting is performed)
     *
     * @param executionTimeMs - Execution time in milliseconds
     * @param efficiencyRatio - Ratio of documents returned to documents examined
     * @param hasInMemorySort - Whether query performs in-memory sorting
     * @param hasSorting - Whether query performs any sorting (in-memory or index-based)
     * @param isIndexScan - Whether query uses index scan
     * @param isCollectionScan - Whether query performs collection scan
     * @returns Performance rating with score and diagnostics
     */
    private static calculatePerformanceRating(
        executionTimeMs: number,
        efficiencyRatio: number,
        hasInMemorySort: boolean,
        hasSorting: boolean,
        isIndexScan: boolean,
        isCollectionScan: boolean,
    ): PerformanceRating {
        const diagnostics: PerformanceDiagnostic[] = [];

        // 1. Efficiency Ratio Assessment (always included)
        if (efficiencyRatio >= 0.5) {
            diagnostics.push({
                type: 'positive',
                message: 'High efficiency ratio',
                details: `You return ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis indicates excellent query selectivity and optimal index usage.`,
            });
        } else if (efficiencyRatio >= 0.1) {
            diagnostics.push({
                type: 'neutral',
                message: 'Moderate efficiency ratio',
                details: `You return ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis is acceptable but could be improved with better index coverage or more selective filters.`,
            });
        } else if (efficiencyRatio >= 0.01) {
            diagnostics.push({
                type: 'negative',
                message: 'Low efficiency ratio',
                details: `You return only ${(efficiencyRatio * 100).toFixed(1)}% of examined documents.\n\nThis indicates poor query selectivity - the database examines many documents that don't match your query criteria.\n\nConsider adding more selective indexes or refining your query filters.`,
            });
        } else {
            diagnostics.push({
                type: 'negative',
                message: 'Very low efficiency ratio',
                details: `You return only ${(efficiencyRatio * 100).toFixed(2)}% of examined documents.\n\nThis is extremely inefficient - the database examines thousands of documents for each result returned.\n\nThis severely impacts performance and should be addressed with better indexing strategies.`,
            });
        }

        // 2. Execution Time Assessment (always included)
        if (executionTimeMs < 100) {
            diagnostics.push({
                type: 'positive',
                message: 'Fast execution',
                details: `Query completed in ${executionTimeMs.toFixed(1)}ms.\n\nThis is excellent performance and provides a responsive user experience.`,
            });
        } else if (executionTimeMs < 500) {
            diagnostics.push({
                type: 'neutral',
                message: 'Acceptable execution time',
                details: `Query completed in ${executionTimeMs.toFixed(1)}ms.\n\nThis is acceptable for most use cases, though optimization could improve responsiveness.`,
            });
        } else if (executionTimeMs < 2000) {
            diagnostics.push({
                type: 'negative',
                message: 'Slow execution',
                details: `Query took ${executionTimeMs.toFixed(1)}ms to complete.\n\nThis may impact user experience.\n\nConsider adding indexes or optimizing your query structure.`,
            });
        } else {
            diagnostics.push({
                type: 'negative',
                message: 'Very slow execution',
                details: `Query took ${(executionTimeMs / 1000).toFixed(2)}s to complete.\n\nThis significantly impacts performance and user experience.\n\nImmediate optimization is recommended.`,
            });
        }

        // 3. Index Usage Assessment (always included)
        if (isIndexScan) {
            diagnostics.push({
                type: 'positive',
                message: 'Index used',
                details:
                    'Your query uses an index.\n\nThis allows the database to efficiently locate matching documents without scanning the entire collection.',
            });
        } else if (isCollectionScan) {
            diagnostics.push({
                type: 'negative',
                message: 'Full collection scan',
                details:
                    'Your query performs a full collection scan, examining every document in the collection.\n\nThis is inefficient and slow, especially for large collections.\n\nAdd an index on the queried fields to improve performance.',
            });
        } else {
            diagnostics.push({
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
                    type: 'negative',
                    message: 'In-memory sort required',
                    details:
                        'Your query requires sorting data in memory, which is limited by available RAM and can fail for large result sets.\n\nConsider adding a compound index that includes your sort fields to enable index-based sorting.',
                });
            } else {
                diagnostics.push({
                    type: 'positive',
                    message: 'Efficient sorting',
                    details:
                        'Your query uses index-based sorting, which is efficient and avoids memory constraints.\n\nThis improves performance by leveraging the natural order of the index.',
                });
            }
        } else {
            // No sorting required - add neutral diagnostic
            diagnostics.push({
                type: 'neutral',
                message: 'No sorting required',
                details: 'Your query does not require sorting, which avoids additional processing overhead.',
            });
        }

        // Determine overall score based on thresholds
        let score: 'excellent' | 'good' | 'fair' | 'poor';

        if (isCollectionScan && efficiencyRatio < 0.01) {
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
}
