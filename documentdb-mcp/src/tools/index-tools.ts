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
 * Register index-related tools
 */
export function registerIndexTools(server: McpServer): void {
    // Create index tool
    server.registerTool(
        'create_index',
        {
            title: 'Create Index',
            description: 'Create an index on a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                keys: z
                    .union([z.record(z.unknown()), z.string()])
                    .describe("Dictionary defining the index (e.g., {'field': 1} for ascending)"),
                options: z
                    .union([z.record(z.unknown()), z.string()])
                    .default({})
                    .describe("Index options (e.g., {unique: true, name: 'idx'})"),
            },
        },
        withDbGuard(async ({ db_name, collection_name, keys, options = {} }) => {
            try {
                const parsed = parseParams([
                    { raw: keys, expected: 'object', outKey: 'keys', options: { fieldName: 'keys' } },
                    { raw: options, expected: 'object', outKey: 'options', options: { fieldName: 'options' } },
                ]);
                const parsedKeys = parsed.keys as Record<string, any>;
                const parsedOptions = parsed.options as Record<string, any>;
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.createIndex(parsedKeys as any, parsedOptions as any);
                const response = { index_name: result, keys: parsedKeys, options: parsedOptions };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
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

    // List indexes tool
    server.registerTool(
        'list_indexes',
        {
            title: 'List Indexes',
            description: 'List all indexes on a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
            },
        },
        withDbGuard(async ({ db_name, collection_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const indexes = await collection.listIndexes().toArray();
                const response = { indexes, count: indexes.length };
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
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

    // Drop index tool
    server.registerTool(
        'drop_index',
        {
            title: 'Drop Index',
            description: 'Drop an index from a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
                index_name: z.string().describe('Name of the index to drop'),
            },
        },
        withDbGuard(async ({ db_name, collection_name, index_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const result = await collection.dropIndex(index_name);
                const successResponse = {
                    success: true,
                    message: `Index '${index_name}' dropped successfully`,
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

    // Index stats tool
    server.registerTool(
        'index_stats',
        {
            title: 'Index Statistics',
            description: 'Get statistics for indexes on a collection',
            inputSchema: {
                db_name: z.string().describe('Name of the database'),
                collection_name: z.string().describe('Name of the collection'),
            },
        },
        withDbGuard(async ({ db_name, collection_name }) => {
            try {
                const { client } = getDocumentDBContext();
                const collection = client!.db(db_name).collection(collection_name);
                const stats = await collection.aggregate([{ $indexStats: {} }]).toArray();
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

    // Current operations tool (enhanced with optional filter)
    server.registerTool(
        'current_ops',
        {
            title: 'Current Operations',
            description: 'Get information about current MongoDB operations',
            inputSchema: {
                ops: z
                    .union([z.record(z.unknown()), z.string(), z.null()])
                    .optional()
                    .describe('Optional filter to narrow down the operations returned'),
            },
        },
        withDbGuard(async ({ ops = null }) => {
            try {
                const { client } = getDocumentDBContext();
                const parsed = parseParams([
                    {
                        raw: ops,
                        expected: 'object',
                        outKey: 'ops',
                        options: { fieldName: 'ops', optional: true, treatEmptyObjectAsUndefined: true },
                    },
                ]);
                const filter = parsed.ops as Record<string, any> | undefined;
                const command: Record<string, any> = { currentOp: true };
                if (filter) Object.assign(command, filter);
                const response = await client!.db('admin').command(command as any);
                return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
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
