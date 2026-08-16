/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initWebviewTrpc } from '../shared/initWebviewTrpc';
import { type VsCodeLinkResponseMessage } from '../shared/wireProtocol';
import { connectTrpc } from '../webview/connectTrpc';
import { createFakeTransport, type Scenario } from './fakeTransport';

const { router, publicProcedure } = initWebviewTrpc();

// A router whose *type* parametrizes both the client and the scenario. The
// resolver bodies never run: the fake transport answers before anything reaches
// them. That is the point — the scenario is checked against these signatures.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced only via `typeof` to type the client
const appRouter = router({
    greet: publicProcedure.query((): string => 'unused'),
    common: router({
        // A void mutation, which is the case the wire protocol gets wrong if
        // `undefined` is posted verbatim.
        openUrl: publicProcedure.input((raw: unknown) => raw as { url: string }).mutation((): void => undefined),
    }),
    stages: publicProcedure.subscription(async function* (): AsyncGenerator<{ stage: string }> {
        await Promise.resolve();
        yield { stage: 'unused' };
    }),
});
type AppRouter = typeof appRouter;

// The package jest env is `node`, so there is no DOM. Install a minimal `window`
// that records 'message' listeners, and route the fake transport's responses to
// them. This mirrors `connectTrpc.test.ts`.
type MessageListener = (event: MessageEvent) => void;
const messageListeners = new Set<MessageListener>();

function deliver(message: VsCodeLinkResponseMessage): void {
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

function connect(scenario: Scenario<AppRouter>) {
    const transport = createFakeTransport<AppRouter>({ scenario, deliver });
    const { client } = connectTrpc<AppRouter>(transport);
    return { transport, client };
}

describe('createFakeTransport', () => {
    it('resolves a query from its fixture', async () => {
        const { client } = connect({ greet: { result: 'hello' } });

        await expect(client.greet.query()).resolves.toBe('hello');
    });

    it('settles a void mutation whose fixture result is undefined', async () => {
        // Regression guard for the wire protocol's sharpest edge: the structured-
        // clone algorithm strips `undefined`, and the client only completes when
        // `result !== undefined`. A fake that posts `undefined` verbatim leaves the
        // caller hanging forever, so the host coerces to `null` and so must this.
        const { client } = connect({ 'common.openUrl': { result: undefined } });

        await expect(client.common.openUrl.mutate({ url: 'https://example.com' })).resolves.toBeNull();
    });

    it('rejects when the fixture is an error', async () => {
        const { client } = connect({ greet: { error: { message: 'daemon unreachable' } } });

        await expect(client.greet.query()).rejects.toThrow('daemon unreachable');
    });

    it('emits every stream value then completes a subscription', async () => {
        const { client } = connect({
            stages: { stream: [{ stage: 'checking' }, { stage: 'pulling' }, { stage: 'done' }] },
        });

        const seen: { stage: string }[] = [];
        const completed = new Promise<void>((resolve, reject) => {
            client.stages.subscribe(undefined, {
                onData: (value) => seen.push(value),
                onComplete: () => resolve(),
                onError: (error) => reject(new Error(error.message)),
            });
        });

        await completed;
        expect(seen.map((event) => event.stage)).toEqual(['checking', 'pulling', 'done']);
    });

    it('records the path, type and input of every call', async () => {
        const { transport, client } = connect({ 'common.openUrl': { result: undefined } });

        await client.common.openUrl.mutate({ url: 'https://aka.ms/docker' });

        expect(transport.calls).toHaveLength(1);
        expect(transport.calls[0]).toMatchObject({
            path: 'common.openUrl',
            type: 'mutation',
            input: { url: 'https://aka.ms/docker' },
        });
    });

    it('filters recorded calls by procedure path', async () => {
        const { transport, client } = connect({
            greet: { result: 'hi' },
            'common.openUrl': { result: undefined },
        });

        await client.greet.query();
        await client.common.openUrl.mutate({ url: 'https://example.com' });

        expect(transport.callsTo('common.openUrl')).toHaveLength(1);
        expect(transport.callsTo('greet')).toHaveLength(1);
    });

    it('reports an unmocked procedure instead of hanging', async () => {
        const { client } = connect({});

        await expect(client.greet.query()).rejects.toThrow(/No fixture for 'greet'/);
    });

    it('ignores traffic that is not a transport request', () => {
        const transport = createFakeTransport<AppRouter>({ scenario: {}, deliver });

        expect(() => {
            transport.postMessage(null);
            transport.postMessage('a string');
            transport.postMessage({ somethingElse: true });
        }).not.toThrow();
        expect(transport.calls).toHaveLength(0);
    });

    it('clears recorded calls on reset', async () => {
        const { transport, client } = connect({ greet: { result: 'hi' } });

        await client.greet.query();
        expect(transport.calls).toHaveLength(1);

        transport.reset();
        expect(transport.calls).toHaveLength(0);
    });
});
