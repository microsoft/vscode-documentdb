/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Insights APIs for explain command execution
 * Follows the LlmEnhancedFeatureApis.ts pattern for consistent architecture
 */

import { type Document, type MongoClient } from 'mongodb';

/**
 * Options for explain operations on find queries
 */
export interface ExplainFindOptions {
    // Query filter
    filter: Document;
    // Explain verbosity level
    verbosity: 'queryPlanner' | 'executionStats' | 'allPlansExecution';
    // Sort specification
    sort?: Document;
    // Projection specification
    projection?: Document;
    // Number of documents to skip
    skip?: number;
    // Maximum number of documents to return
    limit?: number;
}

/**
 * Explain verbosity levels
 */
export type ExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution';

/**
 * Query Insights APIs for explain operations
 * Provides explain command execution for query performance analysis
 */
export class QueryInsightsApis {
    constructor(private readonly client: MongoClient) {}

    /**
     * Executes explain command on a find query
     * Returns detailed query execution plan and statistics
     *
     * @param databaseName - Target database name
     * @param collectionName - Target collection name
     * @param filter - Query filter
     * @param options - Explain options including verbosity level
     * @returns Explain result from MongoDB/DocumentDB
     */
    public async explainFind(
        databaseName: string,
        collectionName: string,
        filter: Document,
        options: {
            verbosity: ExplainVerbosity;
            sort?: Document;
            projection?: Document;
            skip?: number;
            limit?: number;
        },
    ): Promise<Document> {
        const db = this.client.db(databaseName);
        const collection = db.collection(collectionName);

        const cursor = collection.find(filter);

        if (options.sort) {
            cursor.sort(options.sort);
        }
        if (options.projection) {
            cursor.project(options.projection);
        }
        if (options.skip !== undefined) {
            cursor.skip(options.skip);
        }
        if (options.limit !== undefined) {
            cursor.limit(options.limit);
        }

        return await cursor.explain(options.verbosity);
    }
}
