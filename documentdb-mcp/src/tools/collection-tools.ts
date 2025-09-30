/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { getDocumentDBContext } from '../context/documentdb';
import { withDbGuard } from './utils/dbGuard';
import { parseParams } from './utils/paramParser';

/**
 * Register collection-related tools
 */
export function registerCollectionTools(server: McpServer): void {
    // Collection stats tool
    server.registerTool(
        'collection_stats',
        {
            title: 'Collection Statistics',
            description: "Get detailed statistics about a collection's size and storage usage",
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
            },
        },
        withDbGuard(async ({ db_name, collection_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const stats = await db.command({ collStats: collection_name });
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

    // Rename collection tool
    server.registerTool(
        'rename_collection',
        {
            title: 'Rename Collection',
            description: 'Rename a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to rename'),
                new_collection_name: z.string().describe('New name for the collection'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, new_collection_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                const collection = db.collection(collection_name);
                await collection.rename(new_collection_name, { dropTarget: false });
                return {
                    content: [
                        { type: 'text', text: JSON.stringify({ message: 'Collection renamed successfully' }, null, 2) },
                    ],
                };
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

    // Drop collection tool
    server.registerTool(
        'drop_collection',
        {
            title: 'Drop Collection',
            description: 'Drop a collection from a database',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection to drop'),
            },
        },
        withDbGuard(async ({ db_name, collection_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const db = client!.db(db_name);
                await db.dropCollection(collection_name);
                return {
                    content: [
                        { type: 'text', text: JSON.stringify({ message: 'Collection dropped successfully' }, null, 2) },
                    ],
                };
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

    // Sample documents tool
    server.registerTool(
        'sample_documents',
        {
            title: 'Sample Documents',
            description:
                'Retrieve sample documents from specific collection. Useful for understanding data schema and query generation.',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                sample_size: z
                    .union([z.number(), z.string()])
                    .default(10)
                    .describe('Number of documents to sample (number or numeric string)'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, sample_size = 10 }) => {
            try {
                const { client } = getDocumentDBContext();
                const parsed = parseParams([
                    {
                        raw: sample_size,
                        expected: 'int',
                        outKey: 'sample_size',
                        options: { fieldName: 'sample_size', nonNegative: true, defaultValue: 10 },
                    },
                ]);
                const normalizedSize = parsed.sample_size as number;
                const collection = client!.db(db_name).collection(collection_name);
                const pipeline = [{ $sample: { size: normalizedSize } }];
                const documents = await collection.aggregate(pipeline).toArray();
                return { content: [{ type: 'text', text: JSON.stringify(documents, null, 2) }] };
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
