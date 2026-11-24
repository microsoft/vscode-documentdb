/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type McpTool } from './mcpHttpServer';

/**
 * The Wishing Well as tools for agents. One definition serves both Copilot agent mode inside
 * VS Code (`languageModelTools` in package.json must match these names and schemas) and outside
 * agents over MCP.
 */

export const WISH_TOOL_NAMES = {
    listConnections: 'documentdb_list_connections',
    makeWish: 'documentdb_make_wish',
    grantWish: 'documentdb_grant_wish',
    feelingLucky: 'documentdb_feeling_lucky',
} as const;

const scopeProperties = {
    connection: {
        type: 'string',
        description:
            'Name or id of a saved DocumentDB connection from documentdb_list_connections. Omit for wishes that need no database.',
    },
    database: { type: 'string', description: 'Database to wish on. Needs "connection".' },
    collection: { type: 'string', description: 'Collection to wish on. Needs "database".' },
} as const;

export const WISH_TOOLS: readonly McpTool[] = [
    {
        name: WISH_TOOL_NAMES.listConnections,
        title: 'List DocumentDB connections',
        description:
            'Lists the DocumentDB and MongoDB API connections saved in the VS Code DocumentDB extension, with their databases when already connected. No secrets.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: WISH_TOOL_NAMES.makeWish,
        title: 'Make a wish',
        description: [
            'Make a wish at the DocumentDB Wishing Well in VS Code. Describe what you want in plain words;',
            'the well answers questions about the data by running read-only queries, drafts scripts for changes,',
            "and opens the extension's own tools (collection view with a query, interactive shell, query playground,",
            'cluster dashboard, index advisor, import and export, connection diagnostics, DocumentDB Local).',
            'Nothing changes data: writes come back as a playground script for the user to run.',
            'When the reply has a wishId and an action, call documentdb_grant_wish to make it happen in VS Code.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                wish: { type: 'string', description: 'What you want, in plain words.' },
                spell: {
                    type: 'object',
                    description:
                        'Optional. When you already know exactly what to do, pass one spell from the server instructions, e.g. {"spell":"aggregate","collection":"orders","pipeline":[{"$count":"n"}]}. The well checks it like any other wish: read-only queries run, everything else waits for documentdb_grant_wish.',
                },
                ...scopeProperties,
            },
            required: ['wish'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: WISH_TOOL_NAMES.grantWish,
        title: 'Grant a wish',
        description:
            'Carries out a wish that documentdb_make_wish proposed, in the user’s VS Code window: opens the view, playground, shell or command it named. Never runs a write.',
        inputSchema: {
            type: 'object',
            properties: { wishId: { type: 'string', description: 'The wishId from documentdb_make_wish.' } },
            required: ['wishId'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
        name: WISH_TOOL_NAMES.feelingLucky,
        title: "I'm feeling lucky",
        description:
            'Draws a surprise from the well: a random document or trivia from the given connection, a feature tip, or a fortune.',
        inputSchema: {
            type: 'object',
            properties: { connection: scopeProperties.connection, database: scopeProperties.database },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
];

export const WISH_TOOL_INSTRUCTIONS = [
    'This server is the Wishing Well of the DocumentDB extension running in the user’s VS Code.',
    'Call documentdb_list_connections to see which databases you can wish on, then documentdb_make_wish.',
    'Read-only answers come back directly. Anything that opens UI or drafts a change comes back with a wishId;',
    'call documentdb_grant_wish with it only when the user wants that to happen in their editor.',
].join(' ');

export const wishScopeInput = z.object({
    connection: z.string().trim().min(1).optional(),
    database: z.string().trim().min(1).optional(),
    collection: z.string().trim().min(1).optional(),
});

export const makeWishInput = wishScopeInput.extend({
    wish: z.string().trim().min(1).max(2000),
    spell: z.record(z.string(), z.unknown()).optional(),
});
export const grantWishInput = z.object({ wishId: z.string().trim().min(1) });
export const feelingLuckyInput = wishScopeInput.omit({ collection: true });

export type WishScopeInput = z.infer<typeof wishScopeInput>;
