/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentDBContext } from '../context/documentdb.js';
import { 
    type DocumentQueryResponse, 
    type InsertOneResponse, 
    type InsertManyResponse,
    type UpdateResponse,
    type DeleteResponse,
    type AggregateResponse,
    type ErrorResponse 
} from '../models/index.js';

/**
 * Find documents in a collection.
 */
export const findDocumentsTool: Tool = {
    name: 'find_documents',
    description: 'Find documents in a collection with optional query, projection, sort, limit, and skip',
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
                description: 'MongoDB query filter (JSON object)',
                default: {},
            },
            projection: {
                type: 'object',
                description: 'Fields to include/exclude (JSON object)',
                default: {},
            },
            sort: {
                type: 'object',
                description: 'Sort specification (JSON object)',
                default: {},
            },
            limit: {
                type: 'number',
                description: 'Maximum number of documents to return',
                default: 100,
            },
            skip: {
                type: 'number',
                description: 'Number of documents to skip',
                default: 0,
            },
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function findDocuments(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { 
            db_name, 
            collection_name, 
            query = {}, 
            projection = {}, 
            sort = {}, 
            limit = 100, 
            skip = 0 
        } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            query?: Record<string, unknown>;
            projection?: Record<string, unknown>;
            sort?: Record<string, unknown>;
            limit?: number;
            skip?: number;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        
        const cursor = collection.find(query, { projection });
        if (Object.keys(sort).length > 0) {
            cursor.sort(sort as any);
        }
        cursor.skip(skip).limit(limit);
        
        const documents = await cursor.toArray();
        const totalCount = await collection.countDocuments(query);
        
        const response: DocumentQueryResponse = {
            documents,
            total_count: totalCount,
            limit,
            skip,
            has_more: skip + documents.length < totalCount,
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
 * Count documents in a collection.
 */
export const countDocumentsTool: Tool = {
    name: 'count_documents',
    description: 'Count documents in a collection with optional query filter',
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
                description: 'MongoDB query filter (JSON object)',
                default: {},
            },
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function countDocuments(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, query = {} } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            query?: Record<string, unknown>;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const count = await collection.countDocuments(query);
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ count }, null, 2),
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
 * Insert a single document into a collection.
 */
export const insertDocumentTool: Tool = {
    name: 'insert_document',
    description: 'Insert a single document into a collection',
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
            document: {
                type: 'object',
                description: 'Document to insert (JSON object)',
            },
        },
        required: ['db_name', 'collection_name', 'document'],
    },
};

export async function insertDocument(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, document } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            document: Record<string, unknown>;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const result = await collection.insertOne(document);
        
        const response: InsertOneResponse = {
            inserted_id: result.insertedId.toString(),
            acknowledged: result.acknowledged,
            inserted_count: 1,
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
 * Insert multiple documents into a collection.
 */
export const insertManyTool: Tool = {
    name: 'insert_many',
    description: 'Insert multiple documents into a collection',
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
            documents: {
                type: 'array',
                description: 'Array of documents to insert',
                items: {
                    type: 'object',
                },
            },
        },
        required: ['db_name', 'collection_name', 'documents'],
    },
};

export async function insertMany(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, documents } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            documents: Record<string, unknown>[];
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const result = await collection.insertMany(documents);
        
        const response: InsertManyResponse = {
            inserted_ids: Object.values(result.insertedIds).map((id) => id.toString()),
            acknowledged: result.acknowledged,
            inserted_count: result.insertedCount,
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
 * Update a single document in a collection.
 */
export const updateDocumentTool: Tool = {
    name: 'update_document',
    description: 'Update a single document in a collection',
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
            filter: {
                type: 'object',
                description: 'Filter to match documents (JSON object)',
            },
            update: {
                type: 'object',
                description: 'Update operations (JSON object)',
            },
            upsert: {
                type: 'boolean',
                description: 'Whether to insert if no match found',
                default: false,
            },
        },
        required: ['db_name', 'collection_name', 'filter', 'update'],
    },
};

export async function updateDocument(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, filter, update, upsert = false } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            filter: Record<string, unknown>;
            update: Record<string, unknown>;
            upsert?: boolean;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const result = await collection.updateOne(filter, update, { upsert });
        
        const response: UpdateResponse = {
            matched_count: result.matchedCount,
            modified_count: result.modifiedCount,
            upserted_id: result.upsertedId?.toString(),
            acknowledged: result.acknowledged,
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
 * Delete a single document from a collection.
 */
export const deleteDocumentTool: Tool = {
    name: 'delete_document',
    description: 'Delete a single document from a collection',
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
            filter: {
                type: 'object',
                description: 'Filter to match documents to delete (JSON object)',
            },
        },
        required: ['db_name', 'collection_name', 'filter'],
    },
};

export async function deleteDocument(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, filter } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            filter: Record<string, unknown>;
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const result = await collection.deleteOne(filter);
        
        const response: DeleteResponse = {
            deleted_count: result.deletedCount,
            acknowledged: result.acknowledged,
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
 * Run an aggregation pipeline on a collection.
 */
export const aggregateTool: Tool = {
    name: 'aggregate',
    description: 'Run an aggregation pipeline on a collection',
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
                description: 'Aggregation pipeline stages (array of objects)',
                items: {
                    type: 'object',
                },
            },
        },
        required: ['db_name', 'collection_name', 'pipeline'],
    },
};

export async function aggregate(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, pipeline } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            pipeline: Record<string, unknown>[];
        };
        
        const { client } = getDocumentDBContext();
        const collection = client.db(db_name).collection(collection_name);
        const results = await collection.aggregate(pipeline).toArray();
        
        const response: AggregateResponse = {
            results,
            total_count: results.length,
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