/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentDBContext } from '../context/documentdb.js';
import { type DBInfoResponse, type ErrorResponse } from '../models/index.js';

/**
 * Optimize a find query by analyzing index usage and suggesting improvements.
 */
export const optimizeFindQueryTool: Tool = {
    name: 'optimize_find_query',
    description: 'Optimize a find query by analyzing index usage and suggesting improvements',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database',
            },
            collection_name: {
                type: 'string',
                description: 'Name of the collection',
            },
            query: {
                type: 'object',
                description: 'MongoDB find query to optimize',
            },
        },
        required: ['db_name', 'collection_name', 'query'],
    },
};

export async function optimizeFindQuery(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, query } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            query: Record<string, unknown>;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        
        // Get query execution plan
        const explainResult = await collection.find(query).explain('executionStats');
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(explainResult, null, 2),
                },
            ],
        };
    } catch (error) {
        const errorResponse: ErrorResponse = {
            error: error instanceof Error ? error.message : String(error),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(errorResponse, null, 2),
                },
            ],
            isError: true,
        };
    }
}

/**
 * Optimize an aggregation query by analyzing performance.
 */
export const optimizeAggregateQueryTool: Tool = {
    name: 'optimize_aggregate_query',
    description: 'Optimize an aggregation query by analyzing performance',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database',
            },
            collection_name: {
                type: 'string',
                description: 'Name of the collection',
            },
            pipeline: {
                type: 'array',
                description: 'Aggregation pipeline to optimize',
                items: {
                    type: 'object',
                },
            },
        },
        required: ['db_name', 'collection_name', 'pipeline'],
    },
};

export async function optimizeAggregateQuery(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, pipeline } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            pipeline: Record<string, unknown>[];
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        
        // Get aggregation execution plan
        const explainResult = await collection.aggregate(pipeline, { explain: true }).toArray();
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(explainResult, null, 2),
                },
            ],
        };
    } catch (error) {
        const errorResponse: ErrorResponse = {
            error: error instanceof Error ? error.message : String(error),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(errorResponse, null, 2),
                },
            ],
            isError: true,
        };
    }
}

/**
 * List databases for query generation purposes with basic metadata.
 */
export const listDatabasesForGenerationTool: Tool = {
    name: 'list_databases_for_generation',
    description: 'List databases for query generation purposes with basic metadata',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
};

export async function listDatabasesForGeneration(_request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { client } = getDocumentDBContext();
        const adminDb = client.db().admin();
        const databaseInfos = await adminDb.listDatabases();
        
        // Get enhanced database information
        const databases = await Promise.all(
            databaseInfos.databases.map(async (dbInfo) => {
                try {
                    const db = client.db(dbInfo.name);
                    const collections = await db.listCollections().toArray();
                    return {
                        name: dbInfo.name,
                        sizeOnDisk: dbInfo.sizeOnDisk || 0,
                        collections: collections.map((col) => col.name),
                        collectionCount: collections.length,
                    };
                } catch {
                    return {
                        name: dbInfo.name,
                        sizeOnDisk: dbInfo.sizeOnDisk || 0,
                        collections: [],
                        collectionCount: 0,
                    };
                }
            })
        );
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(databases, null, 2),
                },
            ],
        };
    } catch (error) {
        const errorResponse: ErrorResponse = {
            error: error instanceof Error ? error.message : String(error),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(errorResponse, null, 2),
                },
            ],
            isError: true,
        };
    }
}

/**
 * Get database information for query generation with enhanced collection details.
 */
export const getDbInfoForGenerationTool: Tool = {
    name: 'get_db_info_for_generation',
    description: 'Get database information for query generation with enhanced collection details',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database',
            },
        },
        required: ['db_name'],
    },
};

export async function getDbInfoForGeneration(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name } = request.params.arguments as { db_name: string };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        
        const collections = await db.listCollections().toArray();
        const collectionDetails = await Promise.all(
            collections.map(async (col) => {
                try {
                    const collection = db.collection(col.name);
                    const [stats, indexes, sampleDoc] = await Promise.all([
                        db.command({ collStats: col.name }),
                        collection.listIndexes().toArray(),
                        collection.findOne({})
                    ]);
                    
                    return {
                        name: col.name,
                        type: col.type || 'collection',
                        stats: {
                            count: stats.count || 0,
                            size: stats.size || 0,
                            avgObjSize: stats.avgObjSize || 0,
                        },
                        indexes: indexes.map((idx) => ({
                            name: idx.name,
                            key: idx.key,
                            unique: idx.unique || false,
                        })),
                        sampleSchema: sampleDoc ? Object.keys(sampleDoc) : [],
                    };
                } catch {
                    return {
                        name: col.name,
                        type: col.type || 'collection',
                        stats: { count: 0, size: 0, avgObjSize: 0 },
                        indexes: [],
                        sampleSchema: [],
                    };
                }
            })
        );
        
        const response = {
            database_name: db_name,
            collections: collectionDetails,
            total_collections: collectionDetails.length,
        };
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(response, null, 2),
                },
            ],
        };
    } catch (error) {
        const errorResponse: ErrorResponse = {
            error: error instanceof Error ? error.message : String(error),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(errorResponse, null, 2),
                },
            ],
            isError: true,
        };
    }
}