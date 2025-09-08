/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallToolRequest, CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentDBContext } from '../context/documentdb.js';
import { type DBInfoResponse, type ErrorResponse, type SuccessResponse } from '../models/index.js';

/**
 * List all databases in the DocumentDB instance.
 */
export const listDatabasesTool: Tool = {
    name: 'list_databases',
    description: 'List all databases in the DocumentDB instance',
    inputSchema: {
        type: 'object',
        properties: {},
        required: [],
    },
};

export async function listDatabases(_request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { client } = getDocumentDBContext();
        const adminDb = client.db().admin();
        const databaseInfos = await adminDb.listDatabases();
        const databaseNames = databaseInfos.databases.map((db) => db.name);
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(databaseNames, null, 2),
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
 * Get detailed statistics about a database's size and storage usage.
 */
export const dbStatsTool: Tool = {
    name: 'db_stats',
    description: 'Get detailed statistics about a database\'s size and storage usage. Contains size, avgObjSize, storageSize, indexSize, totalSize, and scaleFactor.',
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

export async function dbStats(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name } = request.params.arguments as { db_name: string };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        const stats = await db.stats();
        
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
 * Get database information including name and collection names.
 */
export const getDbInfoTool: Tool = {
    name: 'get_db_info',
    description: 'Get database information including name and collection names',
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

export async function getDbInfo(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name } = request.params.arguments as { db_name: string };
        const { client } = getDocumentDBContext();
        const db = client.db(db_name);
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map((col) => col.name);
        
        // Calculate estimated total document count
        let estimatedTotalCount = 0;
        for (const collectionName of collectionNames) {
            try {
                const collection = db.collection(collectionName);
                const count = await collection.estimatedDocumentCount();
                estimatedTotalCount += count;
            } catch {
                // If estimated count fails for a collection, skip it
            }
        }
        
        const stats = {
            collections: collectionNames.length,
            estimated_total_count: estimatedTotalCount,
        };
        
        const response: DBInfoResponse = {
            database_name: db_name,
            collection_names: collectionNames,
            stats,
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
 * Drop a database and all its collections.
 */
export const dropDatabaseTool: Tool = {
    name: 'drop_database',
    description: 'Drop a database and all its collections',
    inputSchema: {
        type: 'object',
        properties: {
            db_name: {
                type: 'string',
                description: 'Name of the database to drop',
            },
        },
        required: ['db_name'],
    },
};

export async function dropDatabase(request: CallToolRequest): Promise<CallToolResult> {
    try {
        const { db_name } = request.params.arguments as { db_name: string };
        const { client } = getDocumentDBContext();
        await client.db(db_name).dropDatabase();
        
        const response: SuccessResponse = {
            message: 'Database dropped successfully',
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