/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentDBContext } from '../context/documentdb.js';
import { type ErrorResponse, type SuccessResponse } from '../models/index.js';

/**
 * Get detailed statistics about a collection's size and storage usage.
 */
export const collectionStatsTool: Tool = {
    name: 'collection_stats',
    description: 'Get detailed statistics about a collection\'s size and storage usage. Contains size, count, avgObjSize, storageSize, nindexes, indexBuilds, totalIndexSize, totalSize, indexSizes, and scaleFactor.',
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

export async function collectionStats(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
        };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        const stats = await db.command({ collStats: collection_name });
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(stats, null, 2),
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
 * Rename a collection.
 */
export const renameCollectionTool: Tool = {
    name: 'rename_collection',
    description: 'Rename a collection',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database',
            },
            collection_name: {
                type: 'string',
                description: 'Name of the collection to rename',
            },
            new_collection_name: {
                type: 'string',
                description: 'New name for the collection',
            },
        },
        required: ['db_name', 'collection_name', 'new_collection_name'],
    },
};

export async function renameCollection(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, new_collection_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            new_collection_name: string;
        };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        const collection = db.collection(collection_name);
        await collection.rename(new_collection_name);
        
        const response = {
            message: 'Collection renamed successfully',
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
 * Drop a collection from a database.
 */
export const dropCollectionTool: Tool = {
    name: 'drop_collection',
    description: 'Drop a collection from a database',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database',
            },
            collection_name: {
                type: 'string',
                description: 'Name of the collection to drop',
            },
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function dropCollection(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
        };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        await db.dropCollection(collection_name);
        
        const response: SuccessResponse = {
            message: 'Collection dropped successfully',
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
 * Retrieve sample documents from specific collection.
 */
export const sampleDocumentsTool: Tool = {
    name: 'sample_documents',
    description: 'Retrieve sample documents from specific collection. Useful for understanding data schema and query generation.',
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
            sample_size: {
                type: 'number',
                description: 'Number of documents to sample',
                default: 10,
            },
        },
        required: ['db_name', 'collection_name'],
    },
};

export async function sampleDocuments(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name, collection_name, sample_size = 10 } = request.params.arguments as { 
            db_name: string; 
            collection_name: string; 
            sample_size?: number;
        };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        const collection = db.collection(collection_name);
        
        // Use MongoDB's $sample aggregation to get random documents
        const pipeline = [{ $sample: { size: sample_size } }];
        const documents = await collection.aggregate(pipeline).toArray();
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(documents, null, 2),
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