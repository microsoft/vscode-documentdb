/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

import { config } from './config';
import { closeDocumentDBContext, initializeDocumentDBContext } from './context/documentdb';
import { registerIndexAdvisorPrompts } from './prompts/index-advisor-prompts';
import { registerCollectionResources } from './resources/collection-resources';
import { registerDatabaseResources } from './resources/database-resources';
import { registerOtherResources } from './resources/other-resources';
import { registerCollectionTools } from './tools/collection-tools';
import { registerConnectionTools } from './tools/connection-tools';
import { registerDatabaseTools } from './tools/database-tools';
import { registerDocumentTools } from './tools/document-tools';
import { registerIndexTools } from './tools/index-tools';
import { registerWorkflowTools } from './tools/workflow-tools';

/**
 * Create and configure the MCP server
 */
export function createServer(): McpServer {
    const server = new McpServer({
        name: 'documentdb-mcp-server',
        version: '0.1.0',
    });

    // Register Tools
    // Register connection tools
    registerConnectionTools(server);
    // Register database tools
    registerDatabaseTools(server);
    // Register collection tools
    registerCollectionTools(server);
    // Register document tools
    registerDocumentTools(server);
    // Register index tools
    registerIndexTools(server);
    // Register workflow tools
    registerWorkflowTools(server);

    // Register Resources
    // Register collection resources
    registerCollectionResources(server);
    // Register database resources
    registerDatabaseResources(server);
    // Register other resources
    registerOtherResources(server);

    // Register index advisor related prompts
    registerIndexAdvisorPrompts(server);

    return server;
}

async function safeInitDbContext(): Promise<void> {
    try {
        const ctx = await initializeDocumentDBContext(true);
        if (!ctx.connected) {
            console.error(
                '[DocumentDB] Context initialized in DISCONNECTED (lazy) mode; will attempt real connection when provided a URI.',
            );
        } else {
            console.error('[DocumentDB] Connected to MongoDB.');
        }
    } catch (e) {
        console.error(
            '[DocumentDB] Failed to initialize context (lazy mode). Proceeding without active connection:',
            e,
        );
    }
}

/**
 * Run the server with stdio transport
 */
export async function runStdioServer(): Promise<void> {
    const server = createServer();

    await safeInitDbContext();

    // Setup cleanup on process termination
    const cleanup = async () => {
        await closeDocumentDBContext();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        await cleanup();
    });
    process.on('unhandledRejection', async (reason) => {
        console.error('Unhandled rejection:', reason);
        await cleanup();
    });

    // Create and run transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('DocumentDB MCP Server running on stdio transport');
}

/**
 * Run the server with streamable HTTP transport
 */
export async function runHttpServer(): Promise<void> {
    const app = express();
    app.use(express.json());
    // Store transports by session ID
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    await safeInitDbContext();

    // Handle all MCP Streamable HTTP requests (GET, POST, DELETE)
    app.all('/mcp', async (req: Request, res: Response) => {
        console.error(`Received ${req.method} request to /mcp`);

        try {
            // Check for existing session ID
            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                // Reuse existing transport
                transport = transports[sessionId];
            } else if (!sessionId && req.method === 'POST' && req.body?.method === 'initialize') {
                // Create new transport for initialization request
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sessionId: string) => {
                        console.error(`Session initialized with ID: ${sessionId}`);
                        transports[sessionId] = transport;
                    },
                    onsessionclosed: (sessionId: string | undefined) => {
                        if (sessionId && transports[sessionId]) {
                            console.error(`Session closed: ${sessionId}`);
                            delete transports[sessionId];
                        }
                    },
                });

                // Set up onclose handler to clean up transport when closed
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && transports[sid]) {
                        console.error(`Transport closed for session ${sid}`);
                        delete transports[sid];
                    }
                };

                // Connect the transport to the MCP server
                const server = createServer();
                await server.connect(transport);
            } else {
                // Invalid request
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Bad Request: No valid session ID provided or not an initialization request',
                    },
                    id: null,
                });
                return;
            }

            // Handle the request with the transport
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('Error handling MCP request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    });

    // Setup cleanup on process termination
    const cleanup = async () => {
        console.error('Shutting down HTTP server...');

        // Close all active transports
        for (const sessionId in transports) {
            try {
                console.error(`Closing transport for session ${sessionId}`);
                await transports[sessionId].close();
                delete transports[sessionId];
            } catch (error) {
                console.error(`Error closing transport for session ${sessionId}:`, error);
            }
        }

        await closeDocumentDBContext();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (error) => {
        console.error('Uncaught exception:', error);
        await cleanup();
    });
    process.on('unhandledRejection', async (reason) => {
        console.error('Unhandled rejection:', reason);
        await cleanup();
    });

    // Start the HTTP server
    const server = app.listen(config.port, config.host, () => {
        console.error(`DocumentDB MCP Server running on http://${config.host}:${config.port}/mcp`);
        console.error('Supported methods: GET, POST, DELETE');
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.on('listening', () => resolve());
    });
}

/**
 * Run the server with the specified transport
 */
export async function runServer(): Promise<void> {
    if (config.transport === 'streamable-http') {
        await runHttpServer();
    } else if (config.transport === 'sse') {
        await runSseServer();
    } else {
        await runStdioServer();
    }
}

/**
 * SSE server: GET /sse establishes stream; POST /sse/messages?sessionId=... sends messages
 */
export async function runSseServer(): Promise<void> {
    const app = express();
    app.use(express.json());

    const transports: Record<string, SSEServerTransport> = {};

    await safeInitDbContext();

    app.get('/sse', async (req: Request, res: Response) => {
        try {
            const transport = new SSEServerTransport('/sse/messages', res);
            transports[transport.sessionId] = transport;
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (transports[sid]) {
                    delete transports[sid];
                    console.error(`SSE session closed: ${sid}`);
                }
            };
            const server = createServer();
            await server.connect(transport); // starts transport
            console.error(`SSE session started: ${transport.sessionId}`);
        } catch (err) {
            console.error('Failed to start SSE session', err);
            if (!res.headersSent) res.status(500).end('Failed to start SSE session');
        }
    });

    app.post('/sse/messages', async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).end('Invalid or missing sessionId');
            return;
        }
        const transport = transports[sessionId];
        try {
            await transport.handlePostMessage(req as any, res as any, req.body);
        } catch (err) {
            console.error('Error handling SSE message', err);
            if (!res.headersSent) res.status(500).end('Error handling message');
        }
    });

    const cleanup = async () => {
        console.error('Shutting down SSE server...');
        for (const sid of Object.keys(transports)) {
            try {
                await transports[sid].close();
            } catch {}
            delete transports[sid];
        }
        await closeDocumentDBContext();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', async (e) => {
        console.error('Uncaught exception:', e);
        await cleanup();
    });
    process.on('unhandledRejection', async (r) => {
        console.error('Unhandled rejection:', r);
        await cleanup();
    });

    const server = app.listen(config.port, config.host, () => {
        console.error(`DocumentDB MCP Server (SSE) running at http://${config.host}:${config.port}/sse`);
        console.error('SSE endpoints: GET /sse, POST /sse/messages?sessionId=...');
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.on('listening', () => resolve());
    });
}
