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
import { FindQueryParams } from '../../documentdb/ClustersClient';
import { ClusterSession } from '../../documentdb/ClusterSession';
import { type IndexSpecification } from '../../documentdb/LlmEnhancedFeatureApis';
import { type AIOptimizationResponse } from './types';

/**
 * Payload for create index action
 */
interface CreateIndexPayload {
    sessionId: string;
    databaseName: string;
    collectionName: string;
    indexSpec: IndexSpecification;
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
     * @returns AI optimization recommendations
     */
    public async getOptimizationRecommendations(
        sessionId: string,
        query: string | FindQueryParams,
        databaseName: string,
        collectionName: string,
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
                    };
                }
                else {
                    // handle string query for temporary compatibility
                    queryContext = {
                        sessionId,
                        databaseName,
                        collectionName,
                        query,
                        commandType: CommandType.Find, // For now, only support find queries
                    };
                }

                // Call the optimization service
                const optimizationResult = await optimizeQuery(context, queryContext);

                // Parse the AI response to extract structured recommendations
                const parsedResponse = this.parseAIResponse(optimizationResult.recommendations);

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
            const errorMessage = error instanceof Error ? error.message : 'Not an error instance';
            throw new Error(l10n.t('Failed to parse AI optimization response. {0}', errorMessage));
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
                result.projection = JSON.parse(params.project) as Document;
            }

            if (params.sort) {
                result.sort = JSON.parse(params.sort) as Document;
            }

            if (params.limit !== undefined) {
                result.limit = params.limit;
            }

            if (params.skip !== undefined) {
                result.skip = params.skip;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to convert query parameters: {0}', errorMessage));
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
    public async executeRecommendation(
        _clusterId: string,
        sessionId: string | undefined,
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        // Route to appropriate handler based on actionId
        switch (actionId) {
            case 'createIndex':
                return this.handleCreateIndex(sessionId, payload);
            case 'dropIndex':
                return this.handleDropIndex(sessionId, payload);
            case 'modifyIndex':
                return this.handleModifyIndex(sessionId, payload);
            case 'learnMore':
                return this.handleLearnMore(payload);
            default:
                return {
                    success: false,
                    message: `Unknown action: ${actionId}`,
                };
        }
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
            typeof (payload as CreateIndexPayload).indexSpec === 'object'
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
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isCreateIndexPayload(payload)) {
                return {
                    success: false,
                    message: l10n.t('Invalid payload for create index action'),
                };
            }

            // Get session and client
            const actualSessionId = sessionId ?? payload.sessionId;
            if (!actualSessionId) {
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
                };
            }

            const session = ClusterSession.getSession(actualSessionId);
            const client = session.getClient();

            const result = await client.createIndex(
                payload.databaseName,
                payload.collectionName,
                payload.indexSpec,
            );

            if (result.ok === 1) {
                return {
                    success: true,
                    message: l10n.t('Index "{0}" created successfully', result.indexName ?? 'unnamed'),
                };
            } else {
                return {
                    success: false,
                    message: l10n.t('Failed to create index: {0}', result.note ?? 'Unknown error'),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                message: l10n.t('Error creating index: {0}', errorMessage),
            };
        }
    }

    /**
     * Handles drop index action
     */
    private async handleDropIndex(
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isDropIndexPayload(payload)) {
                return {
                    success: false,
                    message: l10n.t('Invalid payload for drop index action'),
                };
            }

            // Get session and client
            const actualSessionId = sessionId ?? payload.sessionId;
            if (!actualSessionId) {
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
                };
            }

            const session = ClusterSession.getSession(actualSessionId);
            const client = session.getClient();

            const result = await client.dropIndex(payload.databaseName, payload.collectionName, payload.indexName);

            if (result.ok === 1) {
                return {
                    success: true,
                    message: l10n.t('Index "{0}" dropped successfully', payload.indexName),
                };
            } else {
                return {
                    success: false,
                    message: l10n.t('Failed to drop index'),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                message: l10n.t('Error dropping index: {0}', errorMessage),
            };
        }
    }

    /**
     * Handles modify index action
     */
    private async handleModifyIndex(
        sessionId: string | undefined,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        try {
            // Validate payload
            if (!this.isModifyIndexPayload(payload)) {
                return {
                    success: false,
                    message: l10n.t('Invalid payload for modify index action'),
                };
            }

            const parseOperationPattern = /db\.getCollection\(['"]([^'"]+)['"]\)\.(\w+)\((.*)\)/;
            const match = payload.mongoShell.match(parseOperationPattern);
            if (!match || match.length < 3 || (match[2] !== 'hideIndex' && match[2] !== 'unhideIndex')) {
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
                return {
                    success: false,
                    message: l10n.t('Session ID is required'),
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
                const actionName = operation;
                return {
                    success: true,
                    message: l10n.t('Index "{0}" {1} successfully', indexName, actionName),
                };
            } else {
                return {
                    success: false,
                    message: l10n.t('Failed to modify index: {0}', result.errmsg ?? 'Unknown error'),
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                message: l10n.t('Error modifying index: {0}', errorMessage),
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
