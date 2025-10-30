/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Index Advisor related APIs for MongoDB query optimization
 */

import { type Document, type Filter, type MongoClient, type Sort } from 'mongodb';

/**
 * Options for explain operations
 */
export interface ExplainOptions {
    // The query filter
    filter?: Filter<Document>;
    // Sort specification
    sort?: Sort;
    // Projection specification
    projection?: Document;
    // Number of documents to skip
    skip?: number;
    // Maximum number of documents to return
    limit?: number;
}

/**
 * Index specification for creating indexes
 * Supports both simple and composite indexes
 */
export interface IndexSpecification {
    // Index key specification
    key: Record<string, number | string>;
    // Index name
    name?: string;
    // Create a unique index
    unique?: boolean;
    // Create index in the background
    background?: boolean;
    // Create a sparse index
    sparse?: boolean;
    // TTL for documents in seconds
    expireAfterSeconds?: number;
    // Partial index filter expression
    partialFilterExpression?: Document;
    // Additional index options
    [key: string]: unknown;
}

/**
 * Result of index creation operation
 */
export interface CreateIndexResult {
    // Operation status
    ok: number;
    // Name of the created index
    indexName?: string;
    // Number of indexes after creation
    numIndexesAfter?: number;
    // Number of indexes before creation
    numIndexesBefore?: number;
    // Notes or warnings
    note?: string;
}

/**
 * Result of index drop operation
 */
export interface DropIndexResult {
    // Operation status
    ok: number;
    // Number of indexes after dropping
    nIndexesWas?: number;
}

/**
 * Collection statistics result
 */
export interface CollectionStats {
    // Namespace (database.collection)
    ns: string;
    // Number of documents in the collection
    count: number;
    // Total size of all documents in bytes
    size: number;
    // Average object size in bytes
    avgObjSize: number;
    // Storage size in bytes
    storageSize: number;
    // Number of indexes
    nindexes: number;
    // Total index size in bytes
    totalIndexSize: number;
    // Individual index sizes
    indexSizes: Record<string, number>;
}

/**
 * Index statistics for a single index
 */
export interface IndexStats {
    // Index name
    name: string;
    // Index key specification
    key: Record<string, number | string>;
    // Host information
    host: string;
    // Access statistics
    accesses: {
        // Number of times the index has been used
        ops: number;
        // Timestamp of last access
        since: Date;
    };
}

/**
 * Explain plan result with execution statistics
 */
export interface ExplainResult {
    // Query planner information
    queryPlanner: {
        // MongoDB version
        mongodbVersion?: string;
        // Namespace
        namespace: string;
        // Whether index was used
        indexFilterSet: boolean;
        // Parsed query
        parsedQuery?: Document;
        // Winning plan
        winningPlan: Document;
        // Rejected plans
        rejectedPlans?: Document[];
    };
    // Execution statistics
    executionStats?: {
        // Execution success status
        executionSuccess: boolean;
        // Number of documents returned
        nReturned: number;
        // Execution time in milliseconds
        executionTimeMillis: number;
        // Total number of keys examined
        totalKeysExamined: number;
        // Total number of documents examined
        totalDocsExamined: number;
        // Detailed execution stages
        executionStages: Document;
    };
    // Server information
    serverInfo?: {
        host: string;
        port: number;
        version: string;
    };
    // Operation status
    ok: number;
}

/**
 * LLM Enhanced Feature APIs
 */
export class llmEnhancedFeatureApis {
    constructor(private readonly mongoClient: MongoClient) {}

    /**
     * Get statistics for all indexes in a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Array of index statistics
     */
    async getIndexStats(databaseName: string, collectionName: string): Promise<IndexStats[]> {
        const collection = this.mongoClient.db(databaseName).collection(collectionName);

        const indexStatsResult = await collection
            .aggregate([
                {
                    $indexStats: {},
                },
            ])
            .toArray();

        return indexStatsResult.map((stat) => {
            const accesses = stat.accesses as { ops?: number; since?: Date } | undefined;

            return {
                name: stat.name as string,
                key: stat.key as Record<string, number | string>,
                host: stat.host as string,
                accesses: {
                    ops: accesses?.ops ?? 0,
                    since: accesses?.since ?? new Date(),
                },
            };
        });
    }

    /**
     * Get statistics for a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Collection statistics
     */
    async getCollectionStats(databaseName: string, collectionName: string): Promise<CollectionStats> {
        const db = this.mongoClient.db(databaseName);

        // Use the collStats command to get detailed collection statistics
        const stats = await db.command({
            collStats: collectionName,
        });

        return {
            ns: stats.ns as string,
            count: (stats.count as number) ?? 0,
            size: (stats.size as number) ?? 0,
            avgObjSize: (stats.avgObjSize as number) ?? 0,
            storageSize: (stats.storageSize as number) ?? 0,
            nindexes: (stats.nindexes as number) ?? 0,
            totalIndexSize: (stats.totalIndexSize as number) ?? 0,
            indexSizes: (stats.indexSizes as Record<string, number>) ?? {},
        };
    }

    /**
     * Explain a find query with full execution statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param options - Query options including filter, sort, projection, skip, and limit
     * @returns Detailed explain result with execution statistics
     */
    async explainFind(
        databaseName: string,
        collectionName: string,
        options: ExplainOptions = {},
    ): Promise<ExplainResult> {
        const db = this.mongoClient.db(databaseName);

        const { filter = {}, sort, projection, skip, limit } = options;

        const findCmd: Document = {
            find: collectionName,
            filter,
        };

        // Add optional fields if they are defined
        if (sort !== undefined) {
            findCmd.sort = sort;
        }

        if (projection !== undefined) {
            findCmd.projection = projection;
        }

        if (skip !== undefined && skip >= 0) {
            findCmd.skip = skip;
        }

        if (limit !== undefined && limit >= 0) {
            findCmd.limit = limit;
        }

        const command: Document = {
            explain: findCmd,
            verbosity: 'executionStats',
        };

        const explainResult = await db.command(command);

        return explainResult as ExplainResult;
    }

    /**
     * Explain an aggregation pipeline with full execution statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param pipeline - Aggregation pipeline stages
     * @returns Detailed explain result with execution statistics
     */
    async explainAggregate(databaseName: string, collectionName: string, pipeline: Document[]): Promise<ExplainResult> {
        const db = this.mongoClient.db(databaseName);

        const command: Document = {
            explain: {
                aggregate: collectionName,
                pipeline,
                cursor: {},
            },
            verbosity: 'executionStats',
        };

        const explainResult = await db.command(command);

        return explainResult as ExplainResult;
    }

    /**
     * Explain a count operation with full execution statistics
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param filter - Query filter for the count operation
     * @returns Detailed explain result with execution statistics
     */
    async explainCount(databaseName: string, collectionName: string, filter: Filter<Document> = {}): Promise<Document> {
        const db = this.mongoClient.db(databaseName);

        const command: Document = {
            explain: {
                count: collectionName,
                query: filter,
            },
            verbosity: 'executionStats',
        };

        const explainResult = await db.command(command);

        return explainResult;
    }

    /**
     * Create an index on a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexSpec - Index specification including key and options
     * @returns Result of the index creation operation
     */
    async createIndex(
        databaseName: string,
        collectionName: string,
        indexSpec: IndexSpecification,
    ): Promise<CreateIndexResult> {
        const db = this.mongoClient.db(databaseName);

        const { key, name, unique, background, sparse, expireAfterSeconds, partialFilterExpression, ...otherOptions } =
            indexSpec;

        const indexDefinition: Document = {
            key,
        };

        // Add optional fields only if they are defined
        if (name !== undefined) {
            indexDefinition.name = name;
        }

        if (unique !== undefined) {
            indexDefinition.unique = unique;
        }

        if (background !== undefined) {
            indexDefinition.background = background;
        }

        if (sparse !== undefined) {
            indexDefinition.sparse = sparse;
        }

        if (expireAfterSeconds !== undefined) {
            indexDefinition.expireAfterSeconds = expireAfterSeconds;
        }

        if (partialFilterExpression !== undefined) {
            indexDefinition.partialFilterExpression = partialFilterExpression;
        }

        // Add any other options
        Object.assign(indexDefinition, otherOptions);

        const command: Document = {
            createIndexes: collectionName,
            indexes: [indexDefinition],
        };

        const result = await db.command(command);

        return {
            ok: (result.ok as number) ?? 0,
            indexName: result.createdCollectionAutomatically !== undefined ? (name ?? 'auto-generated') : undefined,
            numIndexesAfter: result.numIndexesAfter as number | undefined,
            numIndexesBefore: result.numIndexesBefore as number | undefined,
            note: result.note as string | undefined,
        };
    }

    /**
     * Drop an index from a collection
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param indexName - Name of the index to drop (use "*" to drop all non-_id indexes)
     * @returns Result of the index drop operation
     */
    async dropIndex(databaseName: string, collectionName: string, indexName: string): Promise<DropIndexResult> {
        const db = this.mongoClient.db(databaseName);

        const command: Document = {
            dropIndexes: collectionName,
            index: indexName,
        };

        const result = await db.command(command);

        return {
            ok: (result.ok as number) ?? 0,
            nIndexesWas: result.nIndexesWas as number | undefined,
        };
    }

    /**
     * Get sample documents from a collection using random sampling
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param limit - Maximum number of documents to sample (default: 10)
     * @returns Array of sample documents
     */
    async getSampleDocuments(databaseName: string, collectionName: string, limit: number = 10): Promise<Document[]> {
        const collection = this.mongoClient.db(databaseName).collection(collectionName);

        const sampleDocuments = await collection
            .aggregate([
                {
                    $sample: { size: limit },
                },
            ])
            .toArray();

        return sampleDocuments;
    }
}
