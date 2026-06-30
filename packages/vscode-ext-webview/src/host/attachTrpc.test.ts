/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewPanel } from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { initWebviewTrpc } from '../shared/initWebviewTrpc';
import { TypedEventSink } from '../shared/TypedEventSink';
import { type VsCodeLinkRequestMessage } from '../shared/wireProtocol';
import { attachTrpc } from './attachTrpc';

type PostedMessage = { id: string; result?: unknown; error?: { message: string }; complete?: boolean };

/**
 * Minimal stub of the parts of `vscode.WebviewPanel` that `attachTrpc` touches:
 * `webview.onDidReceiveMessage` (to capture the dispatcher's handler) and
 * `webview.postMessage` (to capture what the dispatcher sends back).
 */
function createStubPanel() {
    let handler: ((m: VsCodeLinkRequestMessage) => unknown) | undefined;
    let listenerDisposed = false;
    const posted: PostedMessage[] = [];

    const panel = {
        webview: {
            onDidReceiveMessage(cb: (m: VsCodeLinkRequestMessage) => unknown) {
                handler = cb;
                return {
                    dispose() {
                        listenerDisposed = true;
                    },
                };
            },
            postMessage(message: PostedMessage) {
                posted.push(message);
                return Promise.resolve(true);
            },
        },
    } as unknown as WebviewPanel;

    return {
        panel,
        posted,
        isListenerDisposed: () => listenerDisposed,
        async send(message: VsCodeLinkRequestMessage): Promise<void> {
            await handler?.(message);
        },
    };
}

/** Lets queued microtasks / awaited generator steps settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function makeMessage(
    id: string,
    type: 'query' | 'mutation' | 'subscription' | 'abort' | 'subscription.stop',
    path: string,
    input?: unknown,
): VsCodeLinkRequestMessage {
    return {
        id,
        op: { id: 0, type, path, input, context: {} } as VsCodeLinkRequestMessage['op'],
    };
}

describe('attachTrpc', () => {
    it('dispatches a query and posts the result', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            greet: publicProcedure.query(() => 'hello'),
        });

        const stub = createStubPanel();
        attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('q1', 'query', 'greet'));

        expect(stub.posted).toEqual([{ id: 'q1', result: 'hello' }]);
    });

    it('coalesces an undefined mutation result to null so it survives postMessage', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            doIt: publicProcedure.mutation(() => undefined),
        });

        const stub = createStubPanel();
        attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('m1', 'mutation', 'doIt'));

        expect(stub.posted).toEqual([{ id: 'm1', result: null }]);
    });

    it('posts an error message when a procedure throws', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            boom: publicProcedure.query(() => {
                throw new Error('kaboom');
            }),
        });

        const stub = createStubPanel();
        attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('e1', 'query', 'boom'));

        expect(stub.posted).toHaveLength(1);
        expect(stub.posted[0].id).toBe('e1');
        expect(stub.posted[0].error?.message).toBe('kaboom');
    });

    it('dispatches against a nested router by dotted path', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            outer: router({
                inner: publicProcedure.query(() => 'deep'),
            }),
        });

        const stub = createStubPanel();
        attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('n1', 'query', 'outer.inner'));

        expect(stub.posted).toEqual([{ id: 'n1', result: 'deep' }]);
    });

    it('streams subscription yields and a final complete', async () => {
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            counter: publicProcedure.subscription(async function* () {
                await Promise.resolve();
                yield 1;
                yield 2;
            }),
        });

        const stub = createStubPanel();
        const { activeSubscriptions } = attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('s1', 'subscription', 'counter'));
        await flush();
        await flush();

        expect(stub.posted).toEqual([
            { id: 's1', result: 1 },
            { id: 's1', result: 2 },
            { id: 's1', complete: true },
        ]);
        expect(activeSubscriptions.size).toBe(0);
    });

    it('aborts an in-flight operation on an abort message', async () => {
        let observedAborted: boolean | undefined;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            slow: publicProcedure.query(async ({ ctx }: { ctx: BaseRouterContext }) => {
                await gate;
                observedAborted = ctx.signal?.aborted;
                return 'done';
            }),
        });

        const stub = createStubPanel();
        const { activeOperations } = attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        const inflight = stub.send(makeMessage('a1', 'query', 'slow'));
        await flush();
        expect(activeOperations.has('a1')).toBe(true);

        void stub.send(makeMessage('a1', 'abort', 'slow'));
        expect(activeOperations.has('a1')).toBe(false);

        release();
        await inflight;
        await flush();

        // The per-operation signal fired, and no result was posted for the aborted op.
        expect(observedAborted).toBe(true);
        expect(stub.posted).toHaveLength(0);
    });

    it('stops a subscription: aborts its controller and clears tracking', async () => {
        const sink = new TypedEventSink<{ type: 'tick' }>();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            forever: publicProcedure.subscription(async function* () {
                for await (const event of sink) {
                    yield event;
                }
            }),
        });

        const stub = createStubPanel();
        const { activeSubscriptions } = attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('sub', 'subscription', 'forever'));
        await flush();

        const entry = activeSubscriptions.get('sub');
        expect(entry).toBeDefined();

        void stub.send(makeMessage('sub', 'subscription.stop', 'forever'));

        // The stop handler synchronously aborts the per-operation controller,
        // calls `iterator.return()`, and drops the tracking entry.
        expect(activeSubscriptions.has('sub')).toBe(false);
        expect(entry?.abortController.signal.aborted).toBe(true);
    });

    it('completes a subscription when its event sink closes', async () => {
        const sink = new TypedEventSink<{ type: 'tick' }>();
        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            ticks: publicProcedure.subscription(async function* () {
                for await (const event of sink) {
                    yield event;
                }
            }),
        });

        const stub = createStubPanel();
        const { activeSubscriptions } = attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        await stub.send(makeMessage('t1', 'subscription', 'ticks'));
        await flush();

        sink.emit({ type: 'tick' });
        await flush();
        sink.close();
        await flush();

        expect(stub.posted).toEqual([
            { id: 't1', result: { type: 'tick' } },
            { id: 't1', complete: true },
        ]);
        expect(activeSubscriptions.size).toBe(0);
    });

    it('disposes the listener and aborts in-flight work on dispose', async () => {
        let observedAborted: boolean | undefined;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
        const appRouter = router({
            slow: publicProcedure.query(async ({ ctx }: { ctx: BaseRouterContext }) => {
                await gate;
                observedAborted = ctx.signal?.aborted;
                return 'done';
            }),
        });

        const stub = createStubPanel();
        const { disposable, activeOperations } = attachTrpc(stub.panel, {}, appRouter, createCallerFactory);

        const inflight = stub.send(makeMessage('d1', 'query', 'slow'));
        await flush();
        expect(activeOperations.has('d1')).toBe(true);

        disposable.dispose();

        expect(stub.isListenerDisposed()).toBe(true);
        expect(activeOperations.size).toBe(0);

        release();
        await inflight;
        await flush();
        expect(observedAborted).toBe(true);
    });
});
