/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplainPlan } from '@mongodb-js/explain-plan-helper';
import { type Document } from 'mongodb';

/**
 * Diagnostic detail about query performance
 */
export interface PerformanceDiagnostic {
    type: 'positive' | 'negative' | 'neutral';
    message: string;
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
     * - Sort strategy assessment
     *
     * @param executionTimeMs - Execution time in milliseconds
     * @param efficiencyRatio - Ratio of documents returned to documents examined
     * @param hasInMemorySort - Whether query performs in-memory sorting
     * @param isIndexScan - Whether query uses index scan
     * @param isCollectionScan - Whether query performs collection scan
     * @returns Performance rating with score and diagnostics
     */
    private static calculatePerformanceRating(
        executionTimeMs: number,
        efficiencyRatio: number,
        hasInMemorySort: boolean,
        isIndexScan: boolean,
        isCollectionScan: boolean,
    ): PerformanceRating {
        const diagnostics: PerformanceDiagnostic[] = [];

        // 1. Efficiency Ratio Assessment (always included)
        if (efficiencyRatio >= 0.5) {
            diagnostics.push({
                type: 'positive',
                message: `High efficiency ratio: ${(efficiencyRatio * 100).toFixed(1)}% of examined documents returned`,
            });
        } else if (efficiencyRatio >= 0.1) {
            diagnostics.push({
                type: 'neutral',
                message: `Moderate efficiency ratio: ${(efficiencyRatio * 100).toFixed(1)}% of examined documents returned`,
            });
        } else if (efficiencyRatio >= 0.01) {
            diagnostics.push({
                type: 'negative',
                message: `Low efficiency ratio: ${(efficiencyRatio * 100).toFixed(1)}% of examined documents returned`,
            });
        } else {
            diagnostics.push({
                type: 'negative',
                message: `Very low efficiency ratio: ${(efficiencyRatio * 100).toFixed(2)}% of examined documents returned`,
            });
        }

        // 2. Execution Time Assessment (always included)
        if (executionTimeMs < 100) {
            diagnostics.push({
                type: 'positive',
                message: `Fast execution time: ${executionTimeMs.toFixed(1)}ms`,
            });
        } else if (executionTimeMs < 500) {
            diagnostics.push({
                type: 'neutral',
                message: `Acceptable execution time: ${executionTimeMs.toFixed(1)}ms`,
            });
        } else if (executionTimeMs < 2000) {
            diagnostics.push({
                type: 'negative',
                message: `Slow execution time: ${executionTimeMs.toFixed(1)}ms`,
            });
        } else {
            diagnostics.push({
                type: 'negative',
                message: `Very slow execution time: ${(executionTimeMs / 1000).toFixed(2)}s`,
            });
        }

        // 3. Index Usage Assessment (always included)
        if (isIndexScan) {
            diagnostics.push({
                type: 'positive',
                message: 'Query uses index',
            });
        } else if (isCollectionScan) {
            diagnostics.push({
                type: 'negative',
                message: 'Full collection scan - consider adding an index',
            });
        } else {
            diagnostics.push({
                type: 'neutral',
                message: 'No index used',
            });
        }

        // 4. Sort Strategy Assessment (always included)
        if (hasInMemorySort) {
            diagnostics.push({
                type: 'negative',
                message: 'In-memory sort required - consider adding index for sort fields',
            });
        } else {
            diagnostics.push({
                type: 'positive',
                message: 'No in-memory sort required',
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
}
