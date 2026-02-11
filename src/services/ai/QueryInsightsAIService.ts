/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document } from 'mongodb';
import {
    CommandType,
    optimizeQuery,
    type QueryObject,
    type QueryOptimizationContext,
} from '../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { type FindQueryParams } from '../../documentdb/ClustersClient';
import { ClusterSession } from '../../documentdb/ClusterSession';
import { type IndexSpecification } from '../../documentdb/LlmEnhancedFeatureApis';
import { ext } from '../../extensionVariables';
import { getConfirmationAsInSettings, getConfirmationWithClick } from '../../utils/dialogs/getConfirmation';
import { type AIOptimizationResponse } from './types';

/**
 * Payload for create index action
 */
interface CreateIndexPayload {
    sessionId: string;
    databaseName: string;
    collectionName: string;
    indexSpec: IndexSpecification;
    indexOptions?: Partial<IndexSpecification>;
}

/**
 * Payload for drop index action
 */
interface DropIndexPayload {
    sessionId: string;
    databaseName: string;
    collectionName: string;
    indexName: string;
}

/**
 * Payload for modify index action
 */
interface ModifyIndexPayload {
    sessionId: string;
    databaseName: string;
    collectionName: string;
    mongoShell: string;
}

/**
 * AI service for query insights and optimization recommendations
 * Uses the index advisor to provide index recommendations
 */
export class QueryInsightsAIService {
    /**
     * Gets optimization recommendations for a query
     *
     * @param sessionId - Session Id for accessing cached data
     * @param query - The query string
     * @param databaseName - Target database name
     * @param collectionName - Target collection name
     * @param executionPlan - Optional pre-loaded execution plan
     * @returns AI optimization recommendations
     */
    public async getOptimizationRecommendations(
        sessionId: string,
        query: string | FindQueryParams,
        databaseName: string,
        collectionName: string,
        executionPlan?: unknown,
        signal?: AbortSignal,
    ): Promise<AIOptimizationResponse> {
        const result = await callWithTelemetryAndErrorHandling(
            'vscode-documentdb.queryInsights.getOptimizationRecommendations',
            async (context: IActionContext) => {
                // Prepare query optimization context
                let queryContext: QueryOptimizationContext;
                if (typeof query !== 'string') {
                    // Convert FindQueryParams to QueryObject
                    const queryObject = this.convertFindParamsToQueryObject(query);
                    queryContext = {
                        sessionId,
                        databaseName,
                        collectionName,
                        queryObject,
                        commandType: CommandType.Find,
                        executionPlan,
                        signal,
                    };
                } else {
                    // handle string query for temporary compatibility
                    queryContext = {
                        sessionId,
                        databaseName,
                        collectionName,
                        query,
                        commandType: CommandType.Find,
                        executionPlan,
                        signal,
                    };
                }

                // Call the optimization service
                const optimizationResult = await optimizeQuery(context, queryContext);

                // Parse the AI response to extract structured recommendations
                const parsedResponse = this.parseAIResponse(optimizationResult.recommendations);

                // count all actionable recommendations like create, drop, modify..
                const actionableRecommendationCount = parsedResponse.improvements.filter(
                    (improvement) => improvement.action !== 'none',
                ).length;
                context.telemetry.measurements.actionableRecommendationCount = actionableRecommendationCount;

                return parsedResponse;
            },
        );

        if (!result) {
            throw new Error(l10n.t('Failed to get optimization recommendations from index advisor.'));
        }

        return result;
    }

    /**
     * Parses the generated recommendations text into structured format
     *
     * @param recommendationsText - The raw text from the AI model
     * @returns Structured AI optimization response
     */
    private parseAIResponse(recommendationsText: string): AIOptimizationResponse {
        try {
            const parsedJson = JSON.parse(recommendationsText) as {
                analysis?: string;
                improvements?: Array<{
                    action: 'create' | 'drop' | 'none' | 'modify';
                    indexSpec: Record<string, number>;
                    indexOptions?: Record<string, unknown>;
                    indexName: string;
                    mongoShell: string;
                    justification: string;
                    priority: 'high' | 'medium' | 'low';
                    risks?: string;
                }>;
                verification?: string[];
                educationalContent?: string;
            };

            return {
                analysis: parsedJson.analysis || 'No analysis provided.',
                improvements: parsedJson.improvements || [],
                verification: parsedJson.verification || [],
                educationalContent: parsedJson.educationalContent,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to parse AI optimization response. {error}', { error: errorMessage }));
        }
    }

    /**
     * Converts FindQueryParams to QueryObject
     * TODO: Later should support other command types as well
     * @param params - FindQueryParams with string filter, sort, project
     * @returns QueryObject with parsed Document objects
     */
    private convertFindParamsToQueryObject(params: FindQueryParams): QueryObject {
        const result: QueryObject = {};

        try {
            if (params.filter) {
                result.filter = JSON.parse(params.filter) as Document;
            }

            if (params.project) {
                const projection = JSON.parse(params.project) as Document;
                if (Object.keys(projection).length > 0) {
                    result.projection = projection;
                }
            }

            if (params.sort) {
                const sort = JSON.parse(params.sort) as Document;
                if (Object.keys(sort).length > 0) {
                    result.sort = sort;
                }
            }

            if (params.limit !== undefined) {
                result.limit = params.limit;
            }

            if (params.skip !== undefined) {
                result.skip = params.skip;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to convert query parameters: {error}', { error: errorMessage }));
        }

        return result;
    }

    /**
     * Executes a recommendation action (create index, drop index, learn more, etc.)
     *
     * @param _clusterId - Cluster/connection identifier
     * @param sessionId - Session identifier for accessing cached data
     * @param actionId - The action to perform (e.g., 'createIndex', 'dropIndex', 'learnMore')
     * @param payload - The action-specific payload
     * @returns Success status and optional message
     */
    public async executeQueryInsightsAction(
        _clusterId: string,
        sessionId: string | undefined,
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        return await callWithTelemetryAndErrorHandling(
            'vscode-documentdb.queryInsights.action',
            async (context: IActionContext) => {
                // Track which action was executed
                context.telemetry.properties.actionId = actionId;

                // Route to appropriate handler based on actionId
                switch (actionId) {
                    case 'createIndex':
                        return this.handleCreateIndex(context, sessionId, payload);
                    case 'dropIndex':
                        return this.handleDropIndex(context, sessionId, payload);
                    case 'modifyIndex':
                        return this.handleModifyIndex(context, sessionId, payload);
                    case 'learnMore':
                        return this.handleLearnMore(payload);
                    default:
                        context.telemetry.properties.actionError = 'unknownAction';
                        return {
                            success: false,
                            message: `Unknown action: ${actionId}`,
                        };
                }
            },
        ).then((result) => result ?? { success: false, message: 'Unknown error' });
    }

    /**
     * Type guard for CreateIndexPayload
     */
    private isCreateIndexPayload(payload: unknown): payload is CreateIndexPayload {
        return (
            typeof payload === 'object' &&
            payload !== null &&
            'databaseName' in payload &&
            'collectionName' in payload &&
            'indexSpec' in payload &&
            typeof (payload as CreateIndexPayload).databaseName === 'string' &&
            typeof (payload as CreateIndexPayload).collectionName === 'string' &&
            typeof (payload as CreateIndexPayload).indexSpec === 'object' &&
            (!('indexOptions' in payload) ||
                (payload as CreateIndexPayload).indexOptions === undefined ||
                typeof (payload as CreateIndexPayload).indexOptions === 'object')
        );
    }

    /**
     * Type guard for DropIndexPayload
     */
    private isDropIndexPayload(payload: unknown): payload is DropIndexPayload {
        return (
            typeof payload === 'object' &&
            payload !== null &&
            'databaseName' in payload &&
            'collectionName' in payload &&
            'indexName' in payload &&
            typeof (payload as DropIndexPayload).databaseName === 'string' &&
            typeof (payload as DropIndexPayload).collectionName === 'string' &&
            typeof (payload as DropIndexPayload).indexName === 'string'
        );
    }

    /**
     * Type guard for ModifyIndexPayload
     */
    private isModifyIndexPayload(payload: unknown): payload is ModifyIndexPayload {
        return (
            typeof payload === 'object' &&
            payload !== null &&
            'databaseName' in payload &&
            'collectionName' in payload &&
            'mongoShell' in payload &&
            typeof (payload as ModifyIndexPayload).databaseName === 'string' &&
            typeof (payload as ModifyIndexPayload).collectionName === 'string' &&
            typeof (payload as ModifyIndexPayload).mongoShell === 'string'
        );
    }

    /**
     * Handles create index action
     */
    private async handleCreateIndex(
        context: IActionContext,
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isCreateIndexPayload(payload)) {
                context.telemetry.properties.actionError = 'invalidPayload';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Invalid payload for create index action', {}));
                return {
                    success: false,
                    message: l10n.t('Invalid payload for create index action'),
                };
            }

            // Get session and client
            const actualSessionId = sessionId ?? payload.sessionId;
            if (!actualSessionId) {
                context.telemetry.properties.actionError = 'noSessionId';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Session ID is required', {}));
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
                };
            }

            ext.outputChannel.trace(
                l10n.t('[Query Insights Action] Executing createIndex action for collection: {collection}', {
                    collection: `${payload.databaseName}.${payload.collectionName}`,
                }),
            );

            // Ask for confirmation before creating the index
            const confirmed = await getConfirmationWithClick(
                l10n.t('Create index?'),
                payload.indexOptions?.name
                    ? l10n.t('Create index "{indexName}" on collection "{collectionName}"?', {
                          indexName: payload.indexOptions.name,
                          collectionName: payload.collectionName,
                      })
                    : l10n.t('Create index on collection "{collectionName}"?', {
                          collectionName: payload.collectionName,
                      }),
            );

            if (!confirmed) {
                return {
                    success: false,
                    message: l10n.t('Index creation cancelled'),
                };
            }

            const session = ClusterSession.getSession(actualSessionId);
            const client = session.getClient();

            const result = await client.createIndex(payload.databaseName, payload.collectionName, payload.indexSpec);

            if (result.ok === 1) {
                // Provide positive feedback with additional context from result.note if available
                const baseMessage = l10n.t('Index "{indexName}" created successfully', {
                    indexName: result.indexName ?? 'unnamed',
                });
                const message =
                    typeof result.note === 'string' && result.note ? `${baseMessage}. ${result.note}` : baseMessage;

                ext.outputChannel.trace(l10n.t('[Query Insights Action] Create index action completed successfully'));

                return {
                    success: true,
                    message,
                };
            } else {
                const errorMsg = typeof result.note === 'string' ? result.note : 'Unknown error';
                context.telemetry.properties.actionError = 'createIndexFailed';
                ext.outputChannel.error(
                    l10n.t('[Query Insights Action] Create index action failed: {error}', { error: errorMsg }),
                );

                return {
                    success: false,
                    message: l10n.t('Failed to create index: {error}', { error: errorMsg }),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.telemetry.properties.actionError = 'createIndexException';
            ext.outputChannel.error(
                l10n.t('[Query Insights Action] Create index action error: {error}', { error: errorMessage }),
            );

            return {
                success: false,
                message: l10n.t('Error creating index: {error}', { error: errorMessage }),
            };
        }
    }

    /**
     * Handles drop index action
     */
    private async handleDropIndex(
        context: IActionContext,
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isDropIndexPayload(payload)) {
                context.telemetry.properties.actionError = 'invalidPayload';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Invalid payload for drop index action', {}));
                return {
                    success: false,
                    message: l10n.t('Invalid payload for drop index action'),
                };
            }

            // Get session and client
            const actualSessionId = sessionId ?? payload.sessionId;
            if (!actualSessionId) {
                context.telemetry.properties.actionError = 'noSessionId';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Session ID is required', {}));
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
                };
            }

            ext.outputChannel.trace(
                l10n.t(
                    '[Query Insights Action] Executing dropIndex action for "{indexName}" on collection: {collection}',
                    {
                        indexName: payload.indexName,
                        collection: `${payload.databaseName}.${payload.collectionName}`,
                    },
                ),
            );

            // Ask for confirmation before dropping the index (destructive action)
            const confirmed = await getConfirmationAsInSettings(
                l10n.t('Delete index?'),
                (payload.indexName
                    ? l10n.t('Delete index "{indexName}" from collection "{collectionName}"?', {
                          indexName: payload.indexName,
                          collectionName: payload.collectionName,
                      })
                    : l10n.t('Delete index from collection "{collectionName}"?', {
                          collectionName: payload.collectionName,
                      })) +
                    '\n' +
                    l10n.t('This cannot be undone.'),
                payload.indexName || 'delete',
            );

            if (!confirmed) {
                return {
                    success: false,
                    message: l10n.t('Index deletion cancelled'),
                };
            }

            const session = ClusterSession.getSession(actualSessionId);
            const client = session.getClient();

            const result = await client.dropIndex(payload.databaseName, payload.collectionName, payload.indexName);

            if (result.ok === 1) {
                // Provide positive feedback with additional context from result.note if available
                const baseMessage = l10n.t('Index "{indexName}" dropped successfully', {
                    indexName: payload.indexName,
                });
                const message =
                    typeof result.note === 'string' && result.note ? `${baseMessage}. ${result.note}` : baseMessage;

                ext.outputChannel.trace(l10n.t('[Query Insights Action] Drop index action completed successfully'));

                return {
                    success: true,
                    message,
                };
            } else {
                const errorMsg = typeof result.note === 'string' ? result.note : 'Unknown error';
                context.telemetry.properties.actionError = 'dropIndexFailed';
                ext.outputChannel.error(
                    l10n.t('[Query Insights Action] Drop index action failed: {error}', { error: errorMsg }),
                );

                return {
                    success: false,
                    message: l10n.t('Failed to drop index: {error}', { error: errorMsg }),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.telemetry.properties.actionError = 'dropIndexException';
            ext.outputChannel.error(
                l10n.t('[Query Insights Action] Drop index action error: {error}', { error: errorMessage }),
            );

            return {
                success: false,
                message: l10n.t('Error dropping index: {error}', { error: errorMessage }),
            };
        }
    }

    /**
     * Handles modify index action
     */
    private async handleModifyIndex(
        context: IActionContext,
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isModifyIndexPayload(payload)) {
                context.telemetry.properties.actionError = 'invalidPayload';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Invalid payload for modify index action', {}));
                return {
                    success: false,
                    message: l10n.t('Invalid payload for modify index action'),
                };
            }

            const parseOperationPattern = /db\.getCollection\(['"]([^'"]+)['"]\)\.(\w+)\((.*)\)/;
            const match = payload.mongoShell.match(parseOperationPattern);
            if (!match || match.length < 3 || (match[2] !== 'hideIndex' && match[2] !== 'unhideIndex')) {
                context.telemetry.properties.actionError = 'invalidMongoShellFormat';
                ext.outputChannel.warn(
                    l10n.t('[Query Insights Action] Invalid mongoShell command format: {command}', {
                        command: payload.mongoShell,
                    }),
                );
                return {
                    success: false,
                    message: l10n.t('Invalid mongoShell command format'),
                };
            }

            const operation = match[2];
            const indexName = match[3].replace(/['"]/g, '').trim();

            // Get session and client
            const actualSessionId = sessionId ?? payload.sessionId;
            if (!actualSessionId) {
                context.telemetry.properties.actionError = 'noSessionId';
                ext.outputChannel.warn(l10n.t('[Query Insights Action] Session ID is required', {}));
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
                };
            }

            ext.outputChannel.trace(
                l10n.t(
                    '[Query Insights Action] Executing {operation} action for "{indexName}" on collection: {collection}',
                    {
                        operation,
                        indexName,
                        collection: `${payload.databaseName}.${payload.collectionName}`,
                    },
                ),
            );

            // Ask for confirmation before modifying the index
            const operationText = operation === 'hideIndex' ? l10n.t('hide') : l10n.t('unhide');
            const confirmed = await getConfirmationWithClick(
                l10n.t('Modify index?'),
                indexName
                    ? l10n.t('This will {operation} the index "{indexName}" on collection "{collectionName}".', {
                          operation: operationText,
                          indexName,
                          collectionName: payload.collectionName,
                      })
                    : l10n.t('This will {operation} an index on collection "{collectionName}".', {
                          operation: operationText,
                          collectionName: payload.collectionName,
                      }),
            );

            if (!confirmed) {
                return {
                    success: false,
                    message: l10n.t('Index modification cancelled'),
                };
            }

            const session = ClusterSession.getSession(actualSessionId);
            const client = session.getClient();

            // Execute the operation
            let result: Document;
            if (operation === 'hideIndex') {
                result = await client.hideIndex(payload.databaseName, payload.collectionName, indexName);
            } else {
                // unhideIndex
                result = await client.unhideIndex(payload.databaseName, payload.collectionName, indexName);
            }

            if (result.ok === 1) {
                // Provide positive feedback with additional context from result.note if available
                const baseMessage = l10n.t('Index "{indexName}" {operation} successfully', {
                    indexName,
                    operation,
                });
                const message =
                    typeof result.note === 'string' && result.note ? `${baseMessage}. ${result.note}` : baseMessage;

                ext.outputChannel.trace(l10n.t('[Query Insights Action] Modify index action completed successfully'));

                return {
                    success: true,
                    message,
                };
            } else {
                const errmsg =
                    typeof result.errmsg === 'string'
                        ? result.errmsg
                        : typeof result.note === 'string'
                          ? result.note
                          : 'Unknown error';
                context.telemetry.properties.actionError = 'modifyIndexFailed';
                ext.outputChannel.error(
                    l10n.t('[Query Insights Action] Modify index action failed: {error}', { error: errmsg }),
                );

                return {
                    success: false,
                    message: l10n.t('Failed to modify index: {error}', { error: errmsg }),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.telemetry.properties.actionError = 'modifyIndexException';
            ext.outputChannel.error(
                l10n.t('[Query Insights Action] Modify index action error: {error}', { error: errorMessage }),
            );

            return {
                success: false,
                message: l10n.t('Error modifying index: {error}', { error: errorMessage }),
            };
        }
    }

    /**
     * Handles learn more action
     */
    private handleLearnMore(payload: unknown): { success: boolean; message?: string } {
        // TODO: Open documentation link in browser
        console.log('Opening documentation for:', payload);

        return {
            success: true,
            message: 'Documentation opened (mock)',
        };
    }
}
