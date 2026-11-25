/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMcpHttpServer, type McpServerOptions, type RunningMcpServer } from './mcpHttpServer';

const token = 'test-token-0123456789';

function options(overrides: Partial<McpServerOptions> = {}): McpServerOptions {
    return {
        name: 'wishing-well',
        version: '1.0.0',
        instructions: 'Make a wish.',
        token,
        tools: [{ name: 'make_wish', title: 'Make a wish', description: 'd', inputSchema: { type: 'object' } }],
        callTool: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
            text: `granted ${String(args.wish)}`,
            structured: { ok: true },
        })),
        ...overrides,
    };
}

interface Reply {
    readonly status: number;
    readonly body: string;
    readonly headers: http.IncomingHttpHeaders;
}

function post(
    server: RunningMcpServer,
    body: unknown,
    headers: Record<string, string> = {},
    host?: string,
): Promise<Reply> {
    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                host: '127.0.0.1',
                port: server.port,
                path: '/mcp',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...(host ? { Host: host } : {}),
                    ...headers,
                },
            },
            (response) => {
                let data = '';
                response.on('data', (chunk: Buffer) => (data += chunk.toString()));
                response.on('end', () =>
                    resolve({ status: response.statusCode ?? 0, body: data, headers: response.headers }),
                );
            },
        );
        request.on('error', reject);
        request.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
}

describe('startMcpHttpServer', () => {
    let server: RunningMcpServer | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it('negotiates the protocol, lists tools and calls one', async () => {
        const serverOptions = options();
        server = await startMcpHttpServer(serverOptions, 0);

        const init = await post(server, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
        });
        expect(JSON.parse(init.body)).toMatchObject({
            id: 1,
            result: {
                protocolVersion: '2025-03-26',
                capabilities: { tools: {} },
                serverInfo: { name: 'wishing-well' },
            },
        });

        expect((await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);

        const list = JSON.parse((await post(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).body) as {
            result: { tools: { name: string }[] };
        };
        expect(list.result.tools.map((tool) => tool.name)).toEqual(['make_wish']);

        const call = await post(server, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'make_wish', arguments: { wish: 'a pony' } },
        });
        expect(JSON.parse(call.body)).toMatchObject({
            result: {
                content: [{ type: 'text', text: 'granted a pony' }],
                structuredContent: { ok: true },
                isError: false,
            },
        });
    });

    it('answers an unknown version with its own latest one', async () => {
        server = await startMcpHttpServer(options(), 0);
        const init = await post(server, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '1999-01-01' },
        });
        expect(JSON.parse(init.body)).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
    });

    it('turns a tool failure into an error result the model can read', async () => {
        server = await startMcpHttpServer(
            options({ callTool: vi.fn(async () => Promise.reject(new Error('No such connection: prod'))) }),
            0,
        );
        const call = await post(server, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'make_wish' } });
        expect(JSON.parse(call.body)).toMatchObject({
            result: { isError: true, content: [{ text: 'No such connection: prod' }] },
        });
    });

    it('rejects unknown tools and methods', async () => {
        server = await startMcpHttpServer(options(), 0);
        const tool = await post(server, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'drop_everything' },
        });
        expect(JSON.parse(tool.body)).toMatchObject({ error: { code: -32602 } });
        const method = await post(server, { jsonrpc: '2.0', id: 2, method: 'resources/list' });
        expect(JSON.parse(method.body)).toMatchObject({ error: { code: -32601 } });
    });

    it.each([
        ['no token', { Authorization: '' }, undefined, 401],
        ['a wrong token', { Authorization: 'Bearer nope' }, undefined, 401],
        ['a token of another length', { Authorization: `Bearer ${token}x` }, undefined, 401],
        ['a browser origin', { Origin: 'https://evil.example' }, undefined, 403],
        ['a rebinding host name', {}, 'evil.example:80', 403],
    ])('refuses a request with %s', async (_label, headers, host, status) => {
        server = await startMcpHttpServer(options(), 0);
        const reply = await post(server, { jsonrpc: '2.0', id: 1, method: 'ping' }, headers, host);
        expect(reply.status).toBe(status);
    });

    it('tells a caller with a bad token how to get a fresh config', async () => {
        server = await startMcpHttpServer(options(), 0);
        const reply = await post(server, { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer nope' });
        expect(reply.status).toBe(401);
        expect(reply.headers['www-authenticate']).toBe('Bearer');
        expect(reply.headers['content-type']).toBe('application/json');
        const message = (JSON.parse(reply.body) as { error: { message: string } }).error.message;
        expect(message).toContain('token is missing or wrong');
        expect(message).toContain('DocumentDB: Connect an Agent to the Wishing Well');
    });

    it('accepts its own origin and localhost', async () => {
        server = await startMcpHttpServer(options(), 0);
        const port = server.port;
        expect(
            (
                await post(
                    server,
                    { jsonrpc: '2.0', id: 1, method: 'ping' },
                    { Origin: `http://localhost:${port}` },
                    `localhost:${port}`,
                )
            ).status,
        ).toBe(200);
    });

    it('rejects malformed JSON', async () => {
        server = await startMcpHttpServer(options(), 0);
        const reply = await post(server, '{not json');
        expect(reply.status).toBe(400);
        expect(JSON.parse(reply.body)).toMatchObject({ error: { code: -32700 } });
    });

    it('falls back to a free port when the preferred one is taken', async () => {
        const first = await startMcpHttpServer(options(), 0);
        try {
            server = await startMcpHttpServer(options(), first.port);
            expect(server.port).not.toBe(first.port);
        } finally {
            await first.close();
        }
    });
});
