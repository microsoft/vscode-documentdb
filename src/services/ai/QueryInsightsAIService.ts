/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AIOptimizationResponse } from './types';

/**
 * AI service for query insights and optimization recommendations
 * Currently a mock implementation with 8-second delay
 *
 * TODO: Replace with actual AI service integration later
 */
export class QueryInsightsAIService {
    /**
     * Gets optimization recommendations for a query
     * Currently returns mock data with 8s delay to simulate real AI processing
     *
     * @param _clusterId - Cluster/connection identifier for accessing client
     * @param _sessionId - Optional session identifier for accessing cached data
     * @param _query - The MongoDB query (stringified) - not used in mock
     * @param databaseName - Target database name
     * @param collectionName - Target collection name
     * @returns AI optimization recommendations
     */
    public async getOptimizationRecommendations(
        _clusterId: string,
        _sessionId: string | undefined,
        _query: string,
        databaseName: string,
        collectionName: string,
    ): Promise<AIOptimizationResponse> {
        // Simulate 8-second AI processing time
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Return mock data matching the AI response schema
        return {
            analysis:
                'Your query performs a full collection scan after the index lookup, examining 10,000 documents to return only 2. This indicates the index is not selective enough or additional filtering is happening after the index stage.',
            improvements: [
                {
                    action: 'create',
                    indexSpec: { user_id: 1, status: 1 },
                    mongoShell: `db.getSiblingDB('${databaseName}').${collectionName}.createIndex({ user_id: 1, status: 1 })`,
                    justification:
                        'COLLSCAN examined 10000 docs vs 2 returned (totalKeysExamined: 2). A compound index on { user_id: 1, status: 1 } will eliminate the full scan by supporting both the equality filter and the additional filtering condition.',
                    priority: 'high',
                    risks: 'Additional write and storage overhead for maintaining a new index. Index size estimated at ~50MB for current collection size.',
                },
            ],
            verification: [
                'After creating the index, run the same query and verify that:',
                '1) docsExamined equals documentsReturned',
                "2) the execution plan shows IXSCAN using 'user_id_1_status_1'",
                '3) no COLLSCAN stage appears in the plan',
            ],
        };
    }
}
