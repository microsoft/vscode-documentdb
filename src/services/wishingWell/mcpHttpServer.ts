/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timingSafeEqual } from 'crypto';
import * as http from 'http';
import { type AddressInfo } from 'net';

/**
 * A minimal Model Context Protocol server over Streamable HTTP: JSON responses only, no SSE
 * stream, no sessions. Enough for `initialize`, `tools/list` and `tools/call`, which is all the
 * Wishing Well needs, without pulling an SDK into the extension bundle.
 *
 * Bound to 127.0.0.1 and gated by a bearer token. Host and Origin are checked as the MCP spec
 * requires, so a web page cannot reach it through DNS rebinding.
 */

export interface McpTool {
    readonly name: string;
    readonly title: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly annotations?: Readonly<Record<string, unknown>>;
}

export interface McpToolResult {
    readonly text: string;
    readonly structured?: Readonly<Record<string, unknown>>;
    readonly isError?: boolean;
}

export interface McpServerOptions {
    readonly name: string;
    readonly version: string;
    readonly instructions: string;
    readonly token: string;
    readonly tools: readonly McpTool[];
    readonly callTool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<McpToolResult>;
    readonly log?: (message: string) => void;
}

export interface RunningMcpServer {
    readonly url: string;
    readonly port: number;
    close(): Promise<void>;
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 1024 * 1024;
const UNAUTHORIZED_MESSAGE =
    'The bearer token is missing or wrong. In VS Code, run "DocumentDB: Connect an Agent to the Wishing Well" to get a fresh config.';

interface JsonRpcRequest {
    readonly jsonrpc: '2.0';
    readonly id?: string | number | null;
    readonly method?: string;
    readonly params?: unknown;
}

type JsonRpcReply =
    | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
    | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokenMatches(header: string | undefined, token: string): boolean {
    const presented = /^Bearer (.+)$/i.exec(header ?? '')?.[1] ?? '';
    const a = Buffer.from(presented);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Only this machine's loopback names, on our own port. */
function isLocalHost(hostHeader: string | undefined, port: number): boolean {
    return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

/** Non-browser clients send no Origin. A browser page must be on our own origin, which it never is. */
function isAllowedOrigin(origin: string | undefined, port: number): boolean {
    return origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export async function handleJsonRpc(
    message: unknown,
    options: McpServerOptions,
    signal: AbortSignal,
): Promise<JsonRpcReply | undefined> {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        // Responses from the client and malformed messages get no reply.
        return isRecord(message) && 'id' in message && typeof message.method !== 'string'
            ? undefined
            : { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    }

    const request = message as unknown as JsonRpcRequest;
    if (request.id === undefined) {
        return undefined;
    }
    const id = request.id;
    const params = isRecord(request.params) ? request.params : {};

    switch (request.method) {
        case 'initialize': {
            const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
                        ? requested
                        : SUPPORTED_PROTOCOL_VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: options.name, version: options.version },
                    instructions: options.instructions,
                },
            };
        }
        case 'ping':
            return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
            return { jsonrpc: '2.0', id, result: { tools: options.tools } };
        case 'tools/call': {
            const name = typeof params.name === 'string' ? params.name : '';
            if (!options.tools.some((tool) => tool.name === name)) {
                return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
            }
            const args = isRecord(params.arguments) ? params.arguments : {};
            try {
                const result = await options.callTool(name, args, signal);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: result.text }],
                        ...(result.structured ? { structuredContent: result.structured } : {}),
                        isError: result.isError === true,
                    },
                };
            } catch (error) {
                // Tool failures are results the model can read, not protocol errors.
                const text = error instanceof Error ? error.message : String(error);
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
            }
        }
        default:
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
}

function readBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request too large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

function send(response: http.ServerResponse, status: number, body?: unknown): void {
    if (body === undefined) {
        response.writeHead(status).end();
        return;
    }
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Starts on `preferredPort`, or any free port when it is taken. */
export async function startMcpHttpServer(options: McpServerOptions, preferredPort: number): Promise<RunningMcpServer> {
    let port = 0;
    const server = http.createServer((request, response) => {
        void (async (): Promise<void> => {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/mcp') {
                send(response, 404);
                return;
            }
            if (!isLocalHost(request.headers.host, port) || !isAllowedOrigin(request.headers.origin, port)) {
                send(response, 403);
                return;
            }
            if (!tokenMatches(request.headers.authorization, options.token)) {
                response.setHeader('WWW-Authenticate', 'Bearer');
                // A bare 401 leaves the user guessing; the usual cause is a token reissued in VS Code.
                send(response, 401, {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32001, message: UNAUTHORIZED_MESSAGE },
                });
                return;
            }
            if (request.method !== 'POST') {
                // No server-initiated stream and no sessions to end.
                response.setHeader('Allow', 'POST');
                send(response, 405);
                return;
            }

            const abort = new AbortController();
            response.on('close', () => abort.abort());

            let message: unknown;
            try {
                message = JSON.parse(await readBody(request));
            } catch {
                send(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
                return;
            }

            const reply = await handleJsonRpc(message, options, abort.signal);
            if (reply === undefined) {
                send(response, 202);
            } else {
                send(response, 200, reply);
            }
        })().catch((error: unknown) => {
            options.log?.(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
            if (!response.headersSent) {
                send(response, 500);
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        const tryListen = (candidate: number): void => {
            server.once('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE' && candidate !== 0) {
                    tryListen(0);
                } else {
                    reject(error);
                }
            });
            server.listen(candidate, '127.0.0.1', () => resolve());
        };
        tryListen(preferredPort);
    });

    port = (server.address() as AddressInfo).port;
    return {
        url: `http://127.0.0.1:${port}/mcp`,
        port,
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            }),
    };
}
