/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initWebviewTrpc } from '../shared/initWebviewTrpc';
import { type VsCodeLinkResponseMessage } from '../shared/wireProtocol';
import { connectTrpc, type VsCodeApiLike } from './connectTrpc';

// A router whose *type* parametrizes the client; the resolver bodies are never
// executed (the client side only proxies calls over the transport).
const { router, publicProcedure } = initWebviewTrpc();
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` to type the client
const appRouter = router({
    greet: publicProcedure.query(() => 'unused'),
});
type AppRouter = typeof appRouter;

// The package jest env is `node`, so there is no DOM. We install a minimal
// `window` that records 'message' listeners and lets a test deliver responses.
type MessageListener = (event: MessageEvent) => void;
const messageListeners = new Set<MessageListener>();

function deliver(message: unknown): void {
    for (const listener of [...messageListeners]) {
        listener({ data: message } as MessageEvent);
    }
}

beforeEach(() => {
    messageListeners.clear();
    Object.assign(globalThis, {
        window: {
            addEventListener: (type: string, listener: MessageListener) => {
                if (type === 'message') {
                    messageListeners.add(listener);
                }
            },
            removeEventListener: (_type: string, listener: MessageListener) => {
                messageListeners.delete(listener);
            },
        },
    });
});

afterEach(() => {
    messageListeners.clear();
    Reflect.deleteProperty(globalThis, 'window');
});

/**
 * A fake VS Code webview API that echoes a response for each request using the
 * request's own id, so the client's per-operation handler always matches.
 */
function echoingApi(respond: (requestId: string) => VsCodeLinkResponseMessage): {
    api: VsCodeApiLike;
    sent: { id: string }[];
} {
    const sent: { id: string }[] = [];
    const api: VsCodeApiLike = {
        postMessage(message: unknown) {
            const request = message as { id: string };
            sent.push(request);
            // Deliver the response on a later microtask, after the client's
            // onReceive listener is registered and the promise is awaited.
            queueMicrotask(() => deliver(respond(request.id)));
        },
    };
    return { api, sent };
}

describe('connectTrpc', () => {
    it('returns a client and an observe-only events channel', () => {
        const { api } = echoingApi((id) => ({ id, result: null }));
        const { client, events } = connectTrpc<AppRouter>(api);

        expect(typeof events.onSuccess).toBe('function');
        expect(typeof events.onError).toBe('function');
        expect(typeof events.onAborted).toBe('function');
        expect(client.greet).toBeDefined();
    });

    it('drives a query through the transport and surfaces a success event', async () => {
        const { api, sent } = echoingApi((id) => ({ id, result: 'pong' }));
        const onSuccess = jest.fn();

        const { client, events } = connectTrpc<AppRouter>(api);
        events.onSuccess(onSuccess);

        const result = await client.greet.query();

        expect(result).toBe('pong');
        expect(sent).toHaveLength(1);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'query', path: 'greet' }),
            'pong',
        );
    });

    it('surfaces an error event and forwards it to the onError option', async () => {
        const { api } = echoingApi((id) => ({ id, error: { name: 'Error', message: 'boom' } }));
        const onErrorOption = jest.fn();
        const onErrorChannel = jest.fn();

        const { client, events } = connectTrpc<AppRouter>(api, { onError: onErrorOption });
        events.onError(onErrorChannel);

        await expect(client.greet.query()).rejects.toThrow();

        expect(onErrorChannel).toHaveBeenCalledTimes(1);
        expect(onErrorOption).toHaveBeenCalledTimes(1);
        expect(onErrorChannel).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ type: 'query', path: 'greet' }),
        );
    });

    it('reports an aborted call via onAborted, not onError', async () => {
        const { api } = echoingApi((id) => ({ id, result: 'never' }));
        const onError = jest.fn();
        const onAborted = jest.fn();

        const { client, events } = connectTrpc<AppRouter>(api);
        events.onError(onError);
        events.onAborted(onAborted);

        await expect(client.greet.query(undefined, { signal: AbortSignal.abort() })).rejects.toThrow();

        expect(onAborted).toHaveBeenCalledTimes(1);
        expect(onAborted).toHaveBeenCalledWith(expect.objectContaining({ type: 'query', path: 'greet' }));
        expect(onError).not.toHaveBeenCalled();
    });
});
