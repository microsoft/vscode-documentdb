/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `collectionView.queryInsights` tRPC sub-router.
 *
 * Holds the Query Insights procedures (Stage 1/2/3 and the recommendation
 * action handler) that used to live directly under `collectionsViewRouter`.
 * They were extracted into this sub-router so the parent router does not
 * keep growing as Stage 3 streaming work lands.
 *
 * Per the streaming plan (D8/D12), push-style subscription procedures live
 * in a sibling `queryInsightsEventsRouter.ts` and are merged in here, so a
 * single mount point (`collectionView.queryInsights`) exposes both
 * "things the webview calls" (queries/mutations, here) and "things the
 * host pushes" (subscriptions, in the events file).
 *
 * Procedure bodies are intentionally unchanged from their previous
 * location — this is a pure relocation. The only observable change is the
 * tRPC rpc event path, which now includes the `queryInsights` segment
 * (e.g. `documentDB.rpc.query.collectionView.queryInsights.getQueryInsightsStage3`).
 * Telemetry queries that hard-coded the old path must be updated.
 */

import * as fs from 'fs';
import { type Document } from 'mongodb';
import * as path from 'path';
import { z } from 'zod';

import * as l10n from '@vscode/l10n';
import { ClusterSession } from '../../../../documentdb/ClusterSession';
import {
    ExplainPlanAnalyzer,
    type ExecutionStatsAnalysis,
    type QueryPlannerAnalysis,
} from '../../../../documentdb/queryInsights/ExplainPlanAnalyzer';
import { StagePropertyExtractor } from '../../../../documentdb/queryInsights/StagePropertyExtractor';
import {
    createFailedQueryResponse,
    transformStage1Response,
    transformStage2Response,
} from '../../../../documentdb/queryInsights/transformations';
import { ext } from '../../../../extensionVariables';
import { QueryInsightsAIService } from '../../../../services/ai/QueryInsightsAIService';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../../_integration/trpc';
import { type RouterContext } from '../collectionViewRouter';
import { queryInsightsEventsRoutes } from './queryInsightsEventsRouter';

/**
 * Debug helper: Read debug override file for Query Insights testing
 * Looks for files in resources/debug/ directory
 * Returns the raw MongoDB explain response if file exists and is valid, otherwise null
 *
 * To activate: Remove the "_comment" field from the JSON file
 */
function readQueryInsightsDebugFile(filename: string): Document | null {
    try {
        const debugFilePath = path.join(ext.context.extensionPath, 'resources', 'debug', filename);

        if (!fs.existsSync(debugFilePath)) {
            return null;
        }

        const content = fs.readFileSync(debugFilePath, 'utf8').trim();

        if (!content) {
            return null;
        }

        const parsed = JSON.parse(content) as Document & { _debug_active?: boolean };

        // Check if debug mode is explicitly activated
        if (!parsed._debug_active) {
            return null;
        }

        ext.outputChannel.appendLine(`🐛 Query Insights Debug: Using override data from ${filename}`);

        return parsed;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ext.outputChannel.appendLine(`⚠️ Query Insights Debug: Failed to read ${filename}: ${errorMessage}`);
        return null;
    }
}

export const queryInsightsRouter = router({
    /**
     * Query Insights Stage 1 - Initial View
     * Returns cheap query plan data using explain("queryPlanner")
     *
     * This endpoint:
     * 1. Retrieves the current query from ClusterSession (no parameters needed)
     * 2. Retrieves cached query plan data from ClusterSession
     * 3. Uses ExplainPlanAnalyzer to parse the explain output
     * 4. Transforms the analysis into UI-friendly format
     *
     * Note: This uses queryPlanner verbosity (no query re-execution)
     * Documents returned is NOT available in Stage 1 - only in Stage 2 with executionStats
     */
    getQueryInsightsStage1: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const { sessionId, databaseName, collectionName } = myCtx;

        ext.outputChannel.trace(
            l10n.t('[Query Insights Stage 1] Started for {db}.{collection}', {
                db: databaseName,
                collection: collectionName,
            }),
        );

        let analyzed: QueryPlannerAnalysis;
        let executionTime: number;

        // Platform compatibility check:
        // Query Insights requires the MongoDB API explain() command with specific verbosity modes
        // (queryPlanner and executionStats). Currently, only DocumentDB supports these features.
        //
        // Supported platforms:
        //   - Azure Cosmos DB for MongoDB vCore (domainInfo_api !== 'RU')
        //   - Native MongoDB clusters
        const session: ClusterSession = ClusterSession.getSession(sessionId);
        const clusterMetadata = await session.getClient().getClusterMetadata();

        ctx.telemetry.properties.platform = clusterMetadata?.domainInfo_api ?? 'unknown';
        if (clusterMetadata?.domainInfo_api === 'RU') {
            // TODO: Platform identification improvements needed
            // 1. Create a centralized platform detection service (ClusterSession.getPlatformType())
            // 2. Define platform capabilities enum (SupportsExplain, SupportsAggregation, etc.)
            // 3. Check capabilities instead of platform names for better maintainability
            // 4. Consider adding feature detection (try explain() and handle gracefully)
            // 5. Update UI to show platform-specific feature availability
            ext.outputChannel.trace(
                l10n.t(
                    '[Query Insights Stage 1] Query Insights is not supported on Azure Cosmos DB for MongoDB (RU) clusters.',
                ),
            );

            // Create error with code for UI-specific handling
            const error = new Error(
                l10n.t('Query Insights is not supported on Azure Cosmos DB for MongoDB (RU) clusters.'),
            );
            // Add error code as a custom property for UI pattern matching
            (error as Error & { code?: string }).code = 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU';
            throw error;
        }

        // Check for debug override file first
        const debugData = readQueryInsightsDebugFile('query-insights-stage1.json');
        if (debugData) {
            ext.outputChannel.trace(l10n.t('[Query Insights Stage 1] Using debug data file'));
            // Use debug data - analyze it the same way as real data
            analyzed = ExplainPlanAnalyzer.analyzeQueryPlanner(debugData);
            // Use a default execution time for debug mode
            executionTime = 2.5;
        } else {
            // Get ClusterSession
            const session: ClusterSession = ClusterSession.getSession(sessionId);

            // Get execution time from session (tracked during last query execution)
            executionTime = session.getLastExecutionTimeMs();

            // Get query parameters from session with parsed BSON objects
            const queryParams = session.getCurrentFindQueryParamsWithObjects();

            // Get query planner info (cached or fetch) without skip/limit for full query insights
            const queryPlannerStart = Date.now();
            const queryPlannerResult = await session.getQueryPlannerInfo(
                databaseName,
                collectionName,
                queryParams.filterObj,
                {
                    sort: queryParams.sortObj,
                    projection: queryParams.projectionObj,
                    // Intentionally omit skip/limit for full query insights
                },
            );
            const queryPlannerDuration = Date.now() - queryPlannerStart;
            ext.outputChannel.trace(
                l10n.t('[Query Insights Stage 1] explain(queryPlanner) completed in {ms}ms', {
                    ms: queryPlannerDuration.toString(),
                }),
            );

            // Analyze with ExplainPlanAnalyzer
            analyzed = ExplainPlanAnalyzer.analyzeQueryPlanner(queryPlannerResult);
        }

        // Transform to UI format
        const transformed = transformStage1Response(analyzed, executionTime);
        ext.outputChannel.trace(
            l10n.t('[Query Insights Stage 1] Completed: indexes={idx}, collScan={scan}', {
                idx: analyzed.usedIndexes.join(', ') || 'none',
                scan: analyzed.isCollectionScan.toString(),
            }),
        );

        return transformed;
    }),

    /**
     * Query Insights Stage 2 - Detailed Execution Analysis
     * Returns authoritative metrics using explain("executionStats")
     *
     * This endpoint:
     * 1. Retrieves the current query from ClusterSession (no parameters needed)
     * 2. Retrieves cached execution stats from ClusterSession
     * 3. Uses ExplainPlanAnalyzer to parse and rate performance
     * 4. Transforms the analysis into UI-friendly format with performance rating
     *
     * Note: This executes the query with executionStats verbosity
     */
    getQueryInsightsStage2: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const { sessionId, databaseName, collectionName } = myCtx;

        ext.outputChannel.trace(
            l10n.t('[Query Insights Stage 2] Started for {db}.{collection}', {
                db: databaseName,
                collection: collectionName,
            }),
        );

        let analyzed: ExecutionStatsAnalysis;
        let explainResult: Document | undefined;
        let totalCollectionDocs: number | undefined;

        // Check for debug override file first
        const debugData = readQueryInsightsDebugFile('query-insights-stage2.json');
        let queryFilter: Document | undefined;
        if (debugData) {
            ext.outputChannel.trace(l10n.t('[Query Insights Stage 2] Using debug data file'));
            // Use debug data - analyze it the same way as real data
            analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(debugData);
            explainResult = debugData;
            // totalCollectionDocs not available in debug mode — advisories will simply not fire
        } else {
            // Get ClusterSession
            const session: ClusterSession = ClusterSession.getSession(sessionId);

            const clusterMetadata = await session.getClient().getClusterMetadata();
            ctx.telemetry.properties.platform = clusterMetadata?.domainInfo_api ?? 'unknown';

            // Get query parameters from session with parsed BSON objects
            const queryParams = session.getCurrentFindQueryParamsWithObjects();

            // Get execution stats (cached or fetch) without skip/limit for full query insights
            const executionStatsStart = Date.now();
            const executionStatsResult = await session.getExecutionStats(
                databaseName,
                collectionName,
                queryParams.filterObj,
                {
                    sort: queryParams.sortObj,
                    projection: queryParams.projectionObj,
                    // Intentionally omit skip/limit for full query insights
                },
            );
            const executionStatsDuration = Date.now() - executionStatsStart;
            ext.outputChannel.trace(
                l10n.t('[Query Insights Stage 2] explain completed in {ms}ms', {
                    ms: executionStatsDuration.toString(),
                }),
            );

            // Analyze with ExplainPlanAnalyzer (pass the user's actual filter for empty-query detection)
            analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(executionStatsResult, queryParams.filterObj);
            explainResult = executionStatsResult;
            queryFilter = queryParams.filterObj as Document | undefined;

            // Fetch total collection docs for index-strategy advisories and selectivity cell
            try {
                totalCollectionDocs = await session.getClient().estimateDocumentCount(databaseName, collectionName);
            } catch {
                // Non-critical — advisories and selectivity will simply not fire/display
                totalCollectionDocs = undefined;
            }
        }

        // Extract extended stage info (as per design document)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const executionStages = explainResult?.executionStats?.executionStages as Document | undefined;
        if (executionStages) {
            analyzed.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(executionStages);

            // Enrich with properties from queryPlanner (e.g., isBitmap is only in queryPlanner stages)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const winningPlan = explainResult?.queryPlanner?.winningPlan as Document | undefined;
            if (winningPlan) {
                StagePropertyExtractor.enrichWithQueryPlannerInfo(analyzed.extendedStageInfo, winningPlan);
            }
        }

        // Check for execution error and return error response if found
        if (analyzed.executionError) {
            ext.outputChannel.warn(
                l10n.t('[Query Insights Stage 2] Query execution failed: {error}', {
                    error: analyzed.executionError.errorMessage,
                }),
            );
            const errorResponse = createFailedQueryResponse(analyzed, explainResult);

            ext.outputChannel.trace(l10n.t('Query Insights Stage 2 completed with execution error'));
            return errorResponse;
        }

        // Add index-strategy advisories (coverage, cardinality, multikey)
        if (explainResult) {
            ExplainPlanAnalyzer.addIndexStrategyAdvisories(analyzed, totalCollectionDocs, explainResult, queryFilter);
        }

        // Transform to UI format (normal successful execution path)
        ext.outputChannel.trace(l10n.t('Transforming Stage 2 response to UI format'));
        const transformed = transformStage2Response(analyzed, totalCollectionDocs);

        // Cache the Stage 2 response for Stage 3's static analysis context
        if (!debugData) {
            const session: ClusterSession = ClusterSession.getSession(sessionId);
            session.setStage2Response(transformed, totalCollectionDocs);
        }

        // --- Stage 2 telemetry ---
        // Performance metrics (safe to aggregate, no PII/OII)
        ctx.telemetry.properties.performanceScore = transformed.efficiencyAnalysis.performanceRating.score;
        ctx.telemetry.properties.executionStrategy = transformed.executionStrategy;
        ctx.telemetry.properties.indexUsed = transformed.indexUsed ? 'true' : 'false';
        ctx.telemetry.properties.hadCollectionScan = transformed.hadCollectionScan ? 'true' : 'false';
        ctx.telemetry.properties.hadInMemorySort = transformed.hadInMemorySort ? 'true' : 'false';
        ctx.telemetry.properties.isCoveringQuery = transformed.isCoveringQuery ? 'true' : 'false';
        ctx.telemetry.properties.fetchOverheadKind = transformed.efficiencyAnalysis.fetchOverheadKind;
        ctx.telemetry.properties.isSharded = transformed.isSharded ? 'true' : 'false';

        ctx.telemetry.measurements.executionTimeMs = transformed.executionTimeMs;
        ctx.telemetry.measurements.documentsReturned = transformed.documentsReturned;
        ctx.telemetry.measurements.totalDocsExamined = transformed.totalDocsExamined;
        ctx.telemetry.measurements.totalKeysExamined = transformed.totalKeysExamined;
        ctx.telemetry.measurements.examinedToReturnedRatio = transformed.examinedToReturnedRatio;
        ctx.telemetry.measurements.diagnosticBadgeCount =
            transformed.efficiencyAnalysis.performanceRating.diagnostics.length;

        if (totalCollectionDocs !== undefined) {
            ctx.telemetry.measurements.totalCollectionDocs = totalCollectionDocs;
        }

        // Selectivity as a number (strip the '%' if present)
        if (transformed.efficiencyAnalysis.selectivity) {
            const selectivityNum = parseFloat(transformed.efficiencyAnalysis.selectivity);
            if (!isNaN(selectivityNum)) {
                ctx.telemetry.measurements.selectivityPercent = selectivityNum;
            }
        }

        // Badge IDs (safe categorical data, no PII)
        const diagnosticIds = transformed.efficiencyAnalysis.performanceRating.diagnostics
            .map((d) => d.diagnosticId)
            .join(',');
        ctx.telemetry.properties.diagnosticBadgeIds = diagnosticIds;

        // Count badges by type
        const badgesByType = transformed.efficiencyAnalysis.performanceRating.diagnostics.reduce(
            (acc, d) => {
                acc[d.type] = (acc[d.type] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>,
        );
        ctx.telemetry.measurements.positiveBadgeCount = badgesByType['positive'] ?? 0;
        ctx.telemetry.measurements.neutralBadgeCount = badgesByType['neutral'] ?? 0;
        ctx.telemetry.measurements.negativeBadgeCount = badgesByType['negative'] ?? 0;

        ext.outputChannel.trace(
            l10n.t(
                '[Query Insights Stage 2] Completed: execTime={time}ms, returned={ret}, examined={ex}, ratio={ratio}',
                {
                    time: analyzed.executionTimeMillis.toString(),
                    ret: analyzed.nReturned.toString(),
                    ex: analyzed.totalDocsExamined.toString(),
                    ratio: analyzed.efficiencyRatio.toFixed(2),
                },
            ),
        );
        return transformed;
    }),

    /**
     * Execute a recommendation action (create index, drop index, learn more, etc.)
     *
     * Takes actionId and payload from the button click and routes to appropriate handler
     * in QueryInsightsAIService
     */
    executeQueryInsightsAction: publicProcedureWithTelemetry
        .input(
            z.object({
                actionId: z.string(),
                payload: z.unknown(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const { sessionId, clusterId } = myCtx;
            const { actionId, payload } = input;

            // Create AI service instance
            const aiService = new QueryInsightsAIService();

            // Execute the recommendation action
            const result = await aiService.executeQueryInsightsAction(clusterId, sessionId, actionId, payload);

            return result;
        }),

    // Push-style (subscription) procedures live in a sibling file per D12 /
    // the package README convention. Spread here so the webview-visible
    // paths stay flat (e.g. `collectionView.queryInsights.streamStage3`).
    ...queryInsightsEventsRoutes,
});
