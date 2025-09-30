/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { getDocumentDBContext } from '../context/documentdb';
import { withDbGuard } from './utils/dbGuard';

/**
 * Register database-related tools
 */
export function registerDatabaseTools(server: McpServer): void {
    // List databases tool
    server.registerTool(
        'list_databases',
        {
            title: 'List Databases',
            description: 'List all databases in the DocumentDB instance',
        },
        withDbGuard(async () => {
            try {
                const { client } = getDocumentDBContext();
                const adminDb = client!.db().admin();
                const databaseInfos = await adminDb.listDatabases();
                const databaseNames = databaseInfos.databases.map((db) => db.name);
                return { content: [{ type: 'text', text: JSON.stringify(databaseNames, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Database stats tool
    server.registerTool(
        'db_stats',
        {
            title: 'Database Statistics',
            description: "Get detailed statistics about a database's size and storage usage",
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
            },
        },
        withDbGuard(async ({ db_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const stats = await db.stats();
                return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Get database info tool
    server.registerTool(
        'get_db_info',
        {
            title: 'Get Database Info',
            description: 'Get database information including all collections and their document counts',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
            },
        },
        withDbGuard(async ({ db_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const collections = await db.listCollections().toArray();
                const collectionInfos = await Promise.all(
                    collections.map(async (collection) => {
                        try {
                            const count = await db.collection(collection.name).estimatedDocumentCount();
                            return { name: collection.name, count };
                        } catch (error) {
                            return {
                                name: collection.name,
                                count: 0,
                                error: error instanceof Error ? error.message : String(error),
                            };
                        }
                    }),
                );
                const dbInfo = { database_name: db_name, collections: collectionInfos };
                return { content: [{ type: 'text', text: JSON.stringify(dbInfo, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );

    // Drop database tool
    server.registerTool(
        'drop_database',
        {
            title: 'Drop Database',
            description: 'Drop a database and all its collections',
            inputSchema: {
                db_name: z.string().describe('Name of the database to drop'),
            },
        },
        withDbGuard(async ({ db_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const result = await db.dropDatabase();
                const successResponse = {
                    success: true,
                    message: `Database '${db_name}' dropped successfully`,
                    data: result,
                };
                return { content: [{ type: 'text', text: JSON.stringify(successResponse, null, 2) }] };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                { error: error instanceof Error ? error.message : String(error) },
                                null,
                                2,
                            ),
                        },
                    ],
                    isError: true,
                };
            }
        }),
    );
}
