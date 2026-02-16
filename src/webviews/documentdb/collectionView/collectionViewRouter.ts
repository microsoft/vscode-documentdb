/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs';
import { type Document } from 'mongodb';
import * as path from 'path';
import * as vscode from 'vscode';
import { type JSONSchema } from 'vscode-json-languageservice';
import { z } from 'zod';
import { ClusterSession } from '../../../documentdb/ClusterSession';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { type FieldEntry } from '../../../utils/json/data-api/autocomplete/getKnownFields';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../api/extension-server/trpc';

import * as l10n from '@vscode/l10n';
import {
    generateQuery,
    QueryGenerationType,
    type QueryGenerationContext,
} from '../../../commands/llmEnhancedCommands/queryGenerationCommands';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';

import {
    ExplainPlanAnalyzer,
    type ExecutionStatsAnalysis,
    type QueryPlannerAnalysis,
} from '../../../documentdb/queryInsights/ExplainPlanAnalyzer';
import { StagePropertyExtractor } from '../../../documentdb/queryInsights/StagePropertyExtractor';
import {
    createFailedQueryResponse,
    transformAIResponseForUI,
    transformStage1Response,
    transformStage2Response,
} from '../../../documentdb/queryInsights/transformations';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { QueryInsightsAIService } from '../../../services/ai/QueryInsightsAIService';
import { type CollectionItem } from '../../../tree/documentdb/CollectionItem';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../utils/json/data-api/autocomplete/basicMongoFindFilterSchema.json';
import { generateMongoFindJsonSchema } from '../../../utils/json/data-api/autocomplete/generateMongoFindJsonSchema';
import { promptAfterActionEventually } from '../../../utils/survey';
import { UsageImpact } from '../../../utils/surveyTypes';
import { type BaseRouterContext } from '../../api/configuration/appRouter';
import { type QueryInsightsStage3Response } from './types/queryInsights';

export type RouterContext = BaseRouterContext & {
    sessionId: string;
    /**
     * Stable cluster identifier for cache/client lookups.
     * Use this for ClustersClient.getClient() and CredentialCache operations.
     *
     * For Connections View: This is the storageId (UUID like 'storageId-xxx')
     * For Azure/Discovery Views: This is the Azure Resource ID (already a valid tree path)
     */
    clusterId: string;
    /**
     * Identifies which tree view this cluster belongs to.
     *
     * Required for finding the correct tree node when the webview needs to interact
     * with the tree (e.g., import/export). The same Azure Resource ID can appear in
     * multiple views (Discovery, Azure Resources, Workspace), so we need to know
     * which branch data provider to query.
     *
     * @see Views enum for possible values (e.g., 'connectionsView', 'discoveryView')
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
};

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
        ext.outputChannel.appendLine(
            `⚠️ Query Insights Debug: Failed to read ${filename}: ${(error as Error).message}`,
        );
        return null;
    }
}

// Helper function to find the collection node based on context
// Delegates to the appropriate branch data provider's findCollectionByClusterId method
async function findCollectionNodeInTree(
    clusterId: string,
    viewId: string,
    databaseName: string,
    collectionName: string,
): Promise<CollectionItem | undefined> {
    // Select the branch data provider based on viewId
    // The viewId tells us which tree view the cluster was opened from
    //
    // Each provider now implements findCollectionByClusterId for the dual-ID architecture.

    // Cast viewId to string enum values for comparison
    // (viewId comes from serialized context as a string)
    if (viewId === (Views.ConnectionsView as string)) {
        return (await ext.connectionsBranchDataProvider.findCollectionByClusterId(
            clusterId,
            databaseName,
            collectionName,
        )) as CollectionItem | undefined;
    } else if (viewId === (Views.DiscoveryView as string)) {
        return (await ext.discoveryBranchDataProvider.findCollectionByClusterId(
            clusterId,
            databaseName,
            collectionName,
        )) as CollectionItem | undefined;
    } else if (viewId === (Views.AzureResourcesView as string)) {
        // Azure Resources View has two providers: vCore and RU
        // Try both since we don't know which API type this cluster uses
        const vcoreResult = await ext.azureResourcesVCoreBranchDataProvider.findCollectionByClusterId(
            clusterId,
            databaseName,
            collectionName,
        );
        if (vcoreResult) {
            return vcoreResult as CollectionItem | undefined;
        }
        return (await ext.azureResourcesRUBranchDataProvider.findCollectionByClusterId(
            clusterId,
            databaseName,
            collectionName,
        )) as CollectionItem | undefined;
    } else if (viewId === (Views.AzureWorkspaceView as string)) {
        // Azure Workspace View doesn't surface cluster items directly
        console.warn(`findCollectionNodeInTree: Azure Workspace View does not support collection lookup`);
        return undefined;
    } else {
        // Fallback: try to infer from clusterId format
        // - Azure resources: clusterId is sanitized, contains '_providers_' or '_subscriptions_'
        // - Connections View: clusterId is a storageId (UUID like 'storageId-xxx')
        const isAzureResource = clusterId.includes('_providers_') || clusterId.includes('_subscriptions_');
        if (isAzureResource) {
            return (await ext.discoveryBranchDataProvider.findCollectionByClusterId(
                clusterId,
                databaseName,
                collectionName,
            )) as CollectionItem | undefined;
        }
        return (await ext.connectionsBranchDataProvider.findCollectionByClusterId(
            clusterId,
            databaseName,
            collectionName,
        )) as CollectionItem | undefined;
    }
}

export const collectionsViewRouter = router({
    getInfo: publicProcedureWithTelemetry.query(({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        return l10n.t('Info from the webview: ') + JSON.stringify(myCtx);
    }),
    runFindQuery: publicProcedureWithTelemetry
        // parameters
        .input(
            z.object({
                filter: z.string(),
                project: z.string().optional(),
                sort: z.string().optional(),
                skip: z.number().optional(),
                limit: z.number().optional(),
                pageNumber: z.number(),
                pageSize: z.number(),
                executionIntent: z.enum(['initial', 'refresh', 'pagination']).optional(),
            }),
        )
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            // Track execution intent for telemetry
            const executionIntent = input.executionIntent ?? 'pagination';

            // run query
            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const size = await session.runFindQueryWithCache(
                myCtx.databaseName,
                myCtx.collectionName,
                {
                    filter: input.filter,
                    project: input.project,
                    sort: input.sort,
                    skip: input.skip,
                    limit: input.limit,
                },
                input.pageNumber,
                input.pageSize,
                executionIntent,
            );

            // Report execution intent for analytics
            void callWithTelemetryAndErrorHandling('documentDB.query.executionIntent', (telemetryCtx) => {
                telemetryCtx.errorHandling.suppressDisplay = true;
                telemetryCtx.telemetry.properties.intent = executionIntent;
                telemetryCtx.telemetry.properties.pageNumber = input.pageNumber.toString();
                telemetryCtx.telemetry.measurements.documentCount = size;
            });

            void promptAfterActionEventually(UsageImpact.High);

            return { documentCount: size };
        }),
    getAutocompletionSchema: publicProcedureWithTelemetry
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);

            const autoCompletionData: FieldEntry[] = session.getKnownFields();

            let querySchema: JSONSchema;

            if (autoCompletionData.length > 0) {
                querySchema = generateMongoFindJsonSchema(autoCompletionData);
            } else {
                querySchema = basicFindQuerySchema;
            }

            return querySchema;
        }),
    getCurrentPageAsTable: publicProcedureWithTelemetry
        // parameters
        .input(z.array(z.string()))
        // procedure type
        .query(({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const tableData = session.getCurrentPageAsTable(input);

            return tableData;
        }),
    getCurrentPageAsTree: publicProcedureWithTelemetry
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const treeData = session.getCurrentPageAsTree();

            return treeData;
        }),
    getCurrentPageAsJson: publicProcedureWithTelemetry
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const jsonData = session.getCurrentPageAsJson();

            return jsonData;
        }),
    addDocument: publicProcedureWithTelemetry
        // procedure type
        .mutation(({ ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                viewId: myCtx.viewId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                mode: 'add',
            });
        }),
    viewDocumentById: publicProcedureWithTelemetry
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                viewId: myCtx.viewId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'view',
            });
        }),
    editDocumentById: publicProcedureWithTelemetry
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
                clusterId: myCtx.clusterId,
                viewId: myCtx.viewId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'edit',
            });
        }),
    deleteDocumentsById: publicProcedureWithTelemetry
        // parameters
        .input(z.array(z.string())) // stands for string[]
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const confirmed = await getConfirmationAsInSettings(
                l10n.t('Are you sure?'),
                l10n.t('Delete {count} documents?', { count: input.length }) + '\n' + l10n.t('This cannot be undone.'),
                'delete',
            );

            if (!confirmed) {
                return false;
            }

            const session: ClusterSession = ClusterSession.getSession(myCtx.sessionId);
            const acknowledged = await session.deleteDocuments(myCtx.databaseName, myCtx.collectionName, input);

            if (acknowledged) {
                showConfirmationAsInSettings(
                    input.length > 1
                        ? l10n.t('{countMany} documents have been deleted.', { countMany: input.length })
                        : l10n.t('{countOne} document has been deleted.', { countOne: input.length }),
                );
            } else {
                void vscode.window.showErrorMessage(l10n.t('Failed to delete documents. Unknown error.'), {
                    modal: true,
                });
            }

            return acknowledged;
        }),
    exportDocuments: publicProcedureWithTelemetry
        // parameters
        .input(
            z.object({
                filter: z.string(),
                project: z.string().optional(),
                sort: z.string().optional(),
                skip: z.number().optional(),
                limit: z.number().optional(),
            }),
        )
        //procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            // TODO: remove the dependency on the tree node, in the end it was here only to show progress on the 'tree item'
            const collectionTreeNode = await findCollectionNodeInTree(
                myCtx.clusterId,
                myCtx.viewId,
                myCtx.databaseName,
                myCtx.collectionName,
            );

            if (collectionTreeNode) {
                vscode.commands.executeCommand(
                    'vscode-documentdb.command.internal.exportDocuments',
                    collectionTreeNode,
                    {
                        queryParams: {
                            filter: input.filter,
                            project: input.project,
                            sort: input.sort,
                            skip: input.skip,
                            limit: input.limit,
                        },
                        source: 'webview;collectionView',
                    },
                );
            } else {
                throw new Error('Could not find the specified collection in the tree.');
            }
        }),

    importDocuments: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        // TODO: remove the dependency on the tree node, in the end it was here only to show progress on the 'tree item'
        const collectionTreeNode = await findCollectionNodeInTree(
            myCtx.clusterId,
            myCtx.viewId,
            myCtx.databaseName,
            myCtx.collectionName,
        );

        if (collectionTreeNode) {
            vscode.commands.executeCommand('vscode-documentdb.command.importDocuments', collectionTreeNode, null, {
                source: 'webview;collectionView',
            });
        } else {
            throw new Error('Could not find the specified collection in the tree.');
        }
    }),

    generateQuery: publicProcedureWithTelemetry
        // parameters
        .input(
            z.object({
                currentQuery: z.object({
                    filter: z.string(),
                    project: z.string().optional(),
                    sort: z.string().optional(),
                    skip: z.number().optional(),
                    limit: z.number().optional(),
                }),
                prompt: z.string(),
            }),
        )
        // handle generation request
        .query(async ({ input, ctx }) => {
            const generationCtx = ctx as WithTelemetry<RouterContext>;

            const result = await callWithTelemetryAndErrorHandling(
                'vscode-documentdb.collectionView.generateQuery',
                async (context: IActionContext) => {
                    // Prepare query generation context
                    const queryContext: QueryGenerationContext = {
                        clusterId: generationCtx.clusterId,
                        databaseName: generationCtx.databaseName,
                        collectionName: generationCtx.collectionName,
                        // For now, only handle Find queries
                        targetQueryType: 'Find',
                        naturalLanguageQuery: input.prompt,
                        generationType: QueryGenerationType.SingleCollection,
                    };

                    // Generate query with LLM
                    const generationResult = await generateQuery(context, queryContext);
                    if (generationResult.generatedQuery === undefined) {
                        const errorExplanation = generationResult.explanation
                            ? generationResult.explanation.startsWith('Error:')
                                ? generationResult.explanation.slice(6).trim()
                                : generationResult.explanation
                            : 'No detailed error message provided.';
                        context.telemetry.properties.generationError = errorExplanation;
                        throw new Error(l10n.t('Query generation failed with the error: {0}', errorExplanation));
                    }

                    // Parse the generated command
                    // For now we only support find query
                    let parsedCommand: {
                        filter?: string;
                        project?: string;
                        sort?: string;
                        skip?: number;
                        limit?: number;
                    };

                    try {
                        parsedCommand = JSON.parse(generationResult.generatedQuery) as {
                            filter?: string;
                            project?: string;
                            sort?: string;
                            skip?: number;
                            limit?: number;
                        };
                    } catch (error) {
                        // Add error details to telemetry
                        context.telemetry.properties.parseError = error instanceof Error ? error.name : 'UnknownError';
                        context.telemetry.properties.parseErrorMessage =
                            error instanceof Error ? error.message : String(error);

                        throw new Error(
                            l10n.t('Failed to parse generated query. Query generation provided an invalid response.'),
                        );
                    }

                    return {
                        filter: parsedCommand.filter ?? input.currentQuery.filter,
                        project: parsedCommand.project ?? input.currentQuery.project ?? '{  }',
                        sort: parsedCommand.sort ?? input.currentQuery.sort ?? '{  }',
                        skip: parsedCommand.skip ?? input.currentQuery.skip ?? 0,
                        limit: parsedCommand.limit ?? input.currentQuery.limit ?? 0,
                    };
                },
            );

            if (!result) {
                throw new Error(l10n.t('Query generation failed'));
            }

            return result;
        }),

    /**
     * Query Insights Stage 1 - Initial Performance View
     * Returns fast metrics using explain("queryPlanner")
     *
     * This endpoint:
     * 1. Retrieves execution time from ClusterSession (tracked during query execution)
     * 2. Retrieves cached query planner info from ClusterSession
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

        // Check for debug override file first
        const debugData = readQueryInsightsDebugFile('query-insights-stage2.json');
        if (debugData) {
            ext.outputChannel.trace(l10n.t('[Query Insights Stage 2] Using debug data file'));
            // Use debug data - analyze it the same way as real data
            analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(debugData);
            explainResult = debugData;
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

            // Analyze with ExplainPlanAnalyzer
            analyzed = ExplainPlanAnalyzer.analyzeExecutionStats(executionStatsResult);
            explainResult = executionStatsResult;
        }

        // Extract extended stage info (as per design document)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const executionStages = explainResult?.executionStats?.executionStages as Document | undefined;
        if (executionStages) {
            analyzed.extendedStageInfo = StagePropertyExtractor.extractAllExtendedStageInfo(executionStages);
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

        // Transform to UI format (normal successful execution path)
        ext.outputChannel.trace(l10n.t('Transforming Stage 2 response to UI format'));
        const transformed = transformStage2Response(analyzed);

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
     * Get Query Insights - Stage 3 (AI-powered recommendations)
     * Opt-in AI analysis of query performance with actionable suggestions
     *
     * This endpoint:
     * 1. Retrieves the current query from ClusterSession (no parameters needed)
     * 2. Retrieves cached execution plan from Stage 2
     * 3. Calls AI service with query, database, collection info, and execution plan
     * 4. Transforms AI response into UI-friendly format with action buttons
     */
    getQueryInsightsStage3: publicProcedureWithTelemetry
        .input(z.object({ requestKey: z.string() }))
        .query(async ({ input, ctx }): Promise<QueryInsightsStage3Response> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const { sessionId, clusterId, databaseName, collectionName } = myCtx;
            const { requestKey } = input;

            ext.outputChannel.trace(
                l10n.t('[Query Insights Stage 3] Started for {db}.{collection} (requestKey: {key})', {
                    db: databaseName,
                    collection: collectionName,
                    key: requestKey,
                }),
            );

            // Get ClusterSession
            const session: ClusterSession = ClusterSession.getSession(sessionId);
            const clusterMetadata = await session.getClient().getClusterMetadata();
            ctx.telemetry.properties.platform = clusterMetadata?.domainInfo_api ?? 'unknown';

            // Get query parameters from session (current query)
            const queryParams = session.getCurrentFindQueryParams();

            // Get cached execution plan from Stage 2
            const cachedExecutionPlan = session.getRawExplainOutput(databaseName, collectionName);
            if (cachedExecutionPlan) {
                ext.outputChannel.trace(
                    l10n.t('[Query Insights Stage 3] Using cached execution plan from Stage 2 (requestKey: {key})', {
                        key: requestKey,
                    }),
                );
            }

            // Create AI service instance
            const aiService = new QueryInsightsAIService();

            // Call AI service with execution plan
            const aiServiceStart = Date.now();
            const aiRecommendations = await aiService.getOptimizationRecommendations(
                sessionId,
                queryParams,
                databaseName,
                collectionName,
                cachedExecutionPlan ?? undefined,
                myCtx.signal,
            );
            const aiServiceDuration = Date.now() - aiServiceStart;
            ext.outputChannel.trace(
                l10n.t('[Query Insights Stage 3] AI service completed in {ms}ms (requestKey: {key})', {
                    ms: aiServiceDuration.toString(),
                    key: requestKey,
                }),
            );

            ctx.telemetry.measurements.recommendationCount = aiRecommendations.improvements.length;
            ctx.telemetry.measurements.actionableRecommendationCount = aiRecommendations.improvements.filter(
                (rec) => rec.action !== 'none',
            ).length;

            // Transform AI response to UI format with button payloads
            const transformed = transformAIResponseForUI(aiRecommendations, {
                clusterId,
                databaseName,
                collectionName,
            });
            ext.outputChannel.trace(
                l10n.t('[Query Insights Stage 3] Completed: {count} improvement cards generated (requestKey: {key})', {
                    count: transformed.improvementCards.length.toString(),
                    key: requestKey,
                }),
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

    /**
     * View Raw Explain Output
     * Opens the raw explain plan output in a new VS Code document
     */
    viewRawExplainOutput: publicProcedureWithTelemetry.mutation(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const { sessionId, databaseName, collectionName } = myCtx;

        // Get ClusterSession
        const session: ClusterSession = ClusterSession.getSession(sessionId);

        // Get the cached execution stats (raw explain output)
        const rawExplainOutput = session.getRawExplainOutput(databaseName, collectionName);

        if (!rawExplainOutput) {
            throw new Error('No explain output available. Please run a query first.');
        }

        // Pretty-print the JSON
        const prettyJson = JSON.stringify(rawExplainOutput, null, 4);

        // Open in a new untitled document with .json extension
        const vscode = await import('vscode');
        const doc = await vscode.workspace.openTextDocument({
            content: prettyJson,
            language: 'json',
        });

        await vscode.window.showTextDocument(doc);

        return { success: true };
    }),
});
