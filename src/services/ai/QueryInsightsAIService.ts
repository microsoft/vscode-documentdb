/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import {
    CommandType,
    optimizeQuery,
    type QueryOptimizationContext,
} from '../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { type AIOptimizationResponse } from './types';

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
        query: string,
        databaseName: string,
        collectionName: string,
    ): Promise<AIOptimizationResponse> {
        const result = await callWithTelemetryAndErrorHandling(
            'vscode-documentdb.queryInsights.getOptimizationRecommendations',
            async (context: IActionContext) => {
                // Prepare query optimization context
                const queryContext: QueryOptimizationContext = {
                    sessionId,
                    databaseName,
                    collectionName,
                    query,
                    commandType: CommandType.Find, // For now, only support find queries
                };

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
     * Executes a recommendation action (create index, drop index, learn more, etc.)
     *
     * @param _clusterId - Cluster/connection identifier
     * @param _sessionId - Session identifier for accessing cached data
     * @param actionId - The action to perform (e.g., 'createIndex', 'dropIndex', 'learnMore')
     * @param payload - The action-specific payload
     * @returns Success status and optional message
     */
    public async executeRecommendation(
        _clusterId: string,
        _sessionId: string | undefined,
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> {
        // Route to appropriate handler based on actionId
        switch (actionId) {
            case 'createIndex':
                return this.handleCreateIndex(payload);
            case 'dropIndex':
                return this.handleDropIndex(payload);
            case 'modifyIndex':
                return this.handleModifyIndex(payload);
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
     * Handles create index action
     */
    private async handleCreateIndex(payload: unknown): Promise<{ success: boolean; message?: string }> {
        // TODO: Implement actual index creation via MongoClient
        // For now, mock the operation
        console.log('Creating index with payload:', payload);

        // Simulate delay
        await new Promise((resolve) => setTimeout(resolve, 1000));

        return {
            success: true,
            message: 'Index created successfully (mock)',
        };
    }

    /**
     * Handles drop index action
     */
    private async handleDropIndex(payload: unknown): Promise<{ success: boolean; message?: string }> {
        // TODO: Implement actual index deletion via MongoClient
        console.log('Dropping index with payload:', payload);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        return {
            success: true,
            message: 'Index dropped successfully (mock)',
        };
    }

    /**
     * Handles modify index action
     */
    private async handleModifyIndex(payload: unknown): Promise<{ success: boolean; message?: string }> {
        // TODO: Implement actual index modification via MongoClient
        console.log('Modifying index with payload:', payload);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        return {
            success: true,
            message: 'Index modified successfully (mock)',
        };
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
