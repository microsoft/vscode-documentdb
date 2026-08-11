/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Proves the framework's fake transport works against **this extension's real
 * router**, not just a toy router defined inside the framework's own tests.
 *
 * `AppRouter` is imported as a **type only**, so nothing here loads `vscode` or
 * the router's resolvers at runtime. That is what makes a component test cheap:
 * the scenario is checked against the production procedure signatures at compile
 * time, and costs nothing at run time.
 *
 * If a procedure is renamed, or its input or output shape changes, the fixtures
 * below stop compiling. That is the property that keeps scenarios from drifting
 * into describing states the product can no longer produce.
 */

import { createFakeTransport, type Scenario } from '@microsoft/vscode-ext-webview/testing';
import { connectTrpc, type VsCodeLinkResponseMessage } from '@microsoft/vscode-ext-webview/webview';
import { type AppRouter } from './appRouter';

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

describe('fake transport against the real AppRouter', () => {
    it('answers a real procedure and records the attempt', async () => {
        // `common.openUrl` reports whether the URL was actually opened. Note the
        // fixture is `true`, not `undefined`: this procedure's return type is part
        // of the scenario's type, so a fixture that disagrees with the production
        // signature fails to compile rather than passing against a shape the
        // product no longer returns.
        const scenario: Scenario<AppRouter> = {
            'common.openUrl': { result: true },
        };
        const transport = createFakeTransport<AppRouter>({ scenario, deliver });
        const { client } = connectTrpc<AppRouter>(transport);

        await expect(client.common.openUrl.mutate({ url: 'https://aka.ms/documentdb' })).resolves.toBe(true);

        // The assertion that replaces "did the browser navigate?" - the UI's
        // attempt to leave the page is observable without it leaving the page.
        expect(transport.callsTo('common.openUrl')).toEqual([
            { path: 'common.openUrl', type: 'mutation', input: { url: 'https://aka.ms/documentdb' } },
        ]);
    });

    it('reaches a failure state that a real backend could not produce on demand', async () => {
        // "The browser refused to open" is a one-line fixture here, and an
        // orchestration problem against a real host.
        const scenario: Scenario<AppRouter> = {
            'common.openUrl': { result: false },
        };
        const transport = createFakeTransport<AppRouter>({ scenario, deliver });
        const { client } = connectTrpc<AppRouter>(transport);

        await expect(client.common.openUrl.mutate({ url: 'https://example.com' })).resolves.toBe(false);
    });

    it('propagates a host error to the webview', async () => {
        const scenario: Scenario<AppRouter> = {
            'common.openUrl': { error: { message: 'no default browser configured' } },
        };
        const transport = createFakeTransport<AppRouter>({ scenario, deliver });
        const { client } = connectTrpc<AppRouter>(transport);

        await expect(client.common.openUrl.mutate({ url: 'https://example.com' })).rejects.toThrow(
            'no default browser configured',
        );
    });
});
