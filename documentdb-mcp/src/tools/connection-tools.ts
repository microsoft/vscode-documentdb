/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { connectToDocumentDB, disconnectFromDocumentDB, getConnectionStatus } from '../context/documentdb';
import { parseParams } from './utils/paramParser';

/**
 * Register connection-related tools
 */
export function registerConnectionTools(server: McpServer): void {
    // Connect to MongoDB tool
    server.registerTool(
        'connect_mongodb',
        {
            title: 'Connect to MongoDB',
            description: 'Connect to a MongoDB instance with a connection string',
            inputSchema: {
                connection_string: z.string().describe('MongoDB connection string (e.g., mongodb://localhost:27017)'),
                test_connection: z
                    .union([z.boolean(), z.string()])
                    .default(true)
                    .describe('Test the connection after connecting (boolean or boolean-like string)'),
            },
        },
        async ({ connection_string, test_connection = true }) => {
            try {
                const parsed = parseParams([
                    {
                        raw: test_connection,
                        expected: 'boolean',
                        outKey: 'test_connection',
                        options: { fieldName: 'test_connection', defaultValue: true },
                    },
                ]);
                const testConn = parsed.test_connection as boolean;
                const result = await connectToDocumentDB(connection_string, testConn);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
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
        },
    );

    // Disconnect from MongoDB tool
    server.registerTool(
        'disconnect_mongodb',
        {
            title: 'Disconnect from MongoDB',
            description: 'Disconnect from the current MongoDB instance',
        },
        async () => {
            try {
                const result = await disconnectFromDocumentDB();

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
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
        },
    );

    // Get connection status tool
    server.registerTool(
        'get_connection_status',
        {
            title: 'Get Connection Status',
            description: 'Get the current MongoDB connection status and details',
        },
        async () => {
            try {
                const status = await getConnectionStatus();

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(status, null, 2),
                        },
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
        },
    );
}
