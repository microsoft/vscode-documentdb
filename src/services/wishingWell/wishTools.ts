/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { type McpTool } from './mcpHttpServer';
import { WISH_COMMANDS } from './wishEngine';

/**
 * The Wishing Well as tools for agents. One definition serves both Copilot agent mode inside
 * VS Code (`languageModelTools` in package.json must match these names, descriptions and schemas)
 * and outside agents over MCP.
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

/**
 * The spell contract in one paragraph. Copilot in VS Code gets no server instructions, so this
 * description is all it has to write a spell from.
 */
export const SPELL_DESCRIPTION = [
    'Optional. Pass one spell when you know exactly what to do; the well checks it like any wish.',
    'find and aggregate run read-only at once; every other spell waits for documentdb_grant_wish.',
    'Spells ("?" marks an optional field; collection and database default to this tool\'s own arguments;',
    'filter, project, sort and pipeline are JSON, with dates as {"$date":"2024-01-01T00:00:00Z"} and ids as {"$oid":"…"}):',
    'answer {message} where message is the answer itself;',
    'find {collection?, database?, filter?, project?, sort?, limit?};',
    'aggregate {collection?, database?, pipeline}, never $out or $merge;',
    'collectionView {collection?, database?, filter?, project?, sort?, tab?: documents|indexes|insights}, where insights explains a slow query;',
    'shell {command?} types one command into the interactive shell;',
    'playground {script} for anything that changes data;',
    'dashboard {};',
    'newDocument {collection?, database?};',
    'tool {tool: import|export|diagnose|createCollection|createDatabase, collection?, database?}, where export writes the whole collection to a JSON file (no filter, no CSV), import loads a JSON file the user picks, and the create tools ask the user for the name;',
    `command {commandId, argument?} with commandId one of ${WISH_COMMANDS.map((command) => command.id).join(', ')};`,
    `"argument" is search text, only for ${WISH_COMMANDS.filter((command) => command.takesText)
        .map((command) => command.id)
        .join(', ')};`,
    'agent {prompt} hands work outside the database to Copilot agent mode;',
    'link {url}, https only.',
    'Every spell also takes "title" and "message".',
    'Example: {"spell":"aggregate","collection":"orders","pipeline":[{"$count":"n"}]}',
].join(' ');

export const WISH_TOOLS: readonly McpTool[] = [
    {
        name: WISH_TOOL_NAMES.listConnections,
        title: 'List DocumentDB connections',
        description: [
            'Lists the DocumentDB and MongoDB API connections saved in the VS Code DocumentDB extension and whether each is connected. No secrets.',
            'Pass a connected connection to list its databases, and a database too to list its collections.',
            'Never signs in: for a connection that is not connected, ask the user to sign in from the DocumentDB side bar.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                connection: {
                    type: 'string',
                    description: 'Optional. Name or id of a saved connection, to list its databases.',
                },
                database: {
                    type: 'string',
                    description: 'Optional. A database of "connection", to list its collections.',
                },
            },
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
        name: WISH_TOOL_NAMES.makeWish,
        title: 'Make a wish',
        description: [
            'Make a wish at the DocumentDB Wishing Well in VS Code. Describe what you want in plain words;',
            'the well answers questions about the data by running read-only queries, drafts scripts for changes,',
            "and opens the extension's own tools (collection view with a query, interactive shell, query playground,",
            'cluster dashboard, index advice, import and export, connection diagnostics, DocumentDB Local).',
            'Nothing changes data: writes come back as a playground script for the user to run.',
            'A read comes back answered with the query that ran and its rows, at most 50 of them.',
            'Without Copilot in VS Code, plain words only pick a tool: pass "spell" to run a query.',
            'A reply that proposes an action has a wishId: call documentdb_grant_wish only when the user wants that to happen in VS Code.',
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                wish: { type: 'string', description: 'What you want, in plain words.' },
                spell: { type: 'object', description: SPELL_DESCRIPTION },
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
            'Carries out a wish that documentdb_make_wish proposed, in the user’s VS Code window: opens the view, playground, shell, command, link or Copilot Chat it named. Links, Copilot hand-offs and non-DocumentDB commands ask the user first. Tools (import, export, create, diagnose) and commands only open their steps: the result is "opened", the user finishes them, and it is not done until they say so. Never runs a write.',
        inputSchema: {
            type: 'object',
            properties: { wishId: { type: 'string', description: 'The wishId from documentdb_make_wish.' } },
            required: ['wishId'],
            additionalProperties: false,
        },
        // A granted link opens a web page.
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    {
        name: WISH_TOOL_NAMES.feelingLucky,
        title: "I'm feeling lucky",
        description:
            'Draws a surprise from the DocumentDB Wishing Well: a random document or trivia from the given connection, a feature tip, or a fortune.',
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
    'Call documentdb_list_connections to see the saved connections; pass a connection to list its databases,',
    'and a database to list its collections. Then call documentdb_make_wish.',
    'Read-only answers come back directly. Anything that opens UI or drafts a change comes back with a wishId;',
    'call documentdb_grant_wish with it only when the user wants that to happen in their editor.',
].join(' ');

export const wishScopeInput = z.object({
    connection: z.string().trim().min(1).optional(),
    database: z.string().trim().min(1).optional(),
    collection: z.string().trim().min(1).optional(),
});

export const listConnectionsInput = wishScopeInput.omit({ collection: true });
export const makeWishInput = wishScopeInput.extend({
    wish: z.string().trim().min(1).max(2000),
    spell: z.record(z.string(), z.unknown()).optional(),
});
export const grantWishInput = z.object({ wishId: z.string().trim().min(1) });
export const feelingLuckyInput = wishScopeInput.omit({ collection: true });

export type WishScopeInput = z.infer<typeof wishScopeInput>;
