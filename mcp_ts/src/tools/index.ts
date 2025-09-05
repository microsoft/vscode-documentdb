/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentDBContext } from '../context/documentdb.js';
import { type CreateIndexResponse, type ListIndexesResponse, type SuccessResponse, type ErrorResponse } from '../models/index.js';

/**
 * Create an index on a collection.
 */
export const createIndexTool: Tool = {
    name: 'create_index',
    description: 'Create an index on a collection',
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
            keys: {
                type: 'object',
                description: 'Index key specification (JSON object)',
            },
            options: {
                type: 'object',
                description: 'Index options (e.g., {unique: true, name: "custom_name"})',
                default: {},
            },
        },
        required: ['db_name', 'collection_name', 'keys'],
    },
};

export async function createIndex(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, keys, options = {} } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            keys: Record<string, unknown>;
            options?: Record<string, unknown>;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const indexName = await collection.createIndex(keys as any, options);
        
        const response: CreateIndexResponse = {
            index_name: indexName,
            keys,
            unique: Boolean(options.unique),
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

/**
 * List all indexes on a collection.
 */
export const listIndexesTool: Tool = {
    name: 'list_indexes',
    description: 'List all indexes on a collection',
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
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function listIndexes(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const indexes = await collection.listIndexes().toArray();
        
        const response: ListIndexesResponse = {
            indexes,
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

/**
 * Drop an index from a collection.
 */
export const dropIndexTool: Tool = {
    name: 'drop_index',
    description: 'Drop an index from a collection',
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
            index_name: {
                type: 'string',
                description: 'Name of the index to drop',
            },
        },
        required: ['db_name', 'collection_name', 'index_name'],
    },
};

export async function dropIndex(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, index_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            index_name: string;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        await collection.dropIndex(index_name);
        
        const response: SuccessResponse = {
            message: 'Index dropped successfully',
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

/**
 * Get index statistics for a collection.
 */
export const indexStatsTool: Tool = {
    name: 'index_stats',
    description: 'Get index statistics for a collection',
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
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function indexStats(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        
        // Use the $indexStats aggregation stage to get index usage statistics
        const pipeline = [{ $indexStats: {} }];
        const indexStatistics = await collection.aggregate(pipeline).toArray();
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(indexStatistics, null, 2),
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
 * Get current operations running on the database.
 */
export const currentOpsTool: Tool = {
    name: 'current_ops',
    description: 'Get current operations running on the database',
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

export async function currentOps(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name } = request.params.arguments as { 
            db_name: string; 
        };
        
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        
        // Get current operations using the currentOp command
        const operations = await db.admin().command({ currentOp: 1 });
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(operations, null, 2),
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