/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type BaseRouterContext } from '../shared/BaseRouterContext';
import { initWebviewTrpc } from '../shared/initWebviewTrpc';
import { type VsCodeLinkRequestMessage } from '../shared/wireProtocol';
import { openWebview } from './openWebview';
import { WebviewController } from './WebviewController';

const sourceLayout = {
    bundled: { dir: 'dist', file: 'views.js' },
    dev: { dir: 'out', file: 'views.js' },
};

/** Lets queued microtasks settle. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function makeContext(): vscode.ExtensionContext {
    return {
        extensionPath: '/ext',
        extensionMode: vscode.ExtensionMode.Production,
    } as unknown as vscode.ExtensionContext;
}

/** Builds the factory options (minus `extensionContext`) with a tiny router. */
function makeOptions() {
    const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<BaseRouterContext>();
    const appRouter = router({
        greet: publicProcedure.query(() => 'hi'),
    });
    return {
        title: 'My View',
        viewType: 'myView',
        router: appRouter,
        createCallerFactory,
        context: {} as BaseRouterContext,
        config: { hello: 'world' },
        sourceLayout,
    };
}

/** Reaches past the real `vscode` types into the mock panel internals. */
function mockWebview(controller: { panel: { webview: unknown } }): {
    posted: unknown[];
    receive(message: unknown): void;
} {
    return controller.panel.webview as unknown as { posted: unknown[]; receive(message: unknown): void };
}

describe('openWebview', () => {
    it('opens a panel and returns a WebviewController handle', () => {
        const controller = openWebview(makeContext(), makeOptions());

        expect(controller).toBeInstanceOf(WebviewController);
        expect(controller.panel).toBeDefined();
        expect(controller.isDisposed).toBe(false);
        expect(controller.onDisposed).toBeDefined();
        expect(typeof controller.revealToForeground).toBe('function');
        expect(typeof controller.dispose).toBe('function');
    });

    it('renders the configuration and viewType into the panel HTML', () => {
        const controller = openWebview(makeContext(), makeOptions());

        const html = controller.panel.webview.html;
        expect(html).toContain("render('myView'");
        expect(html).toContain(encodeURIComponent(JSON.stringify({ hello: 'world' })));
    });

    it('reveals the panel via revealToForeground', () => {
        const controller = openWebview(makeContext(), makeOptions());
        const panel = controller.panel as unknown as { revealCount: number };

        controller.revealToForeground();

        expect(panel.revealCount).toBe(1);
    });

    it('fires onDisposed and flips isDisposed on dispose', () => {
        const controller = openWebview(makeContext(), makeOptions());
        let fired = false;
        controller.onDisposed(() => {
            fired = true;
        });

        controller.dispose();

        expect(controller.isDisposed).toBe(true);
        expect(fired).toBe(true);
    });

    it('auto-wires tRPC so the panel answers a query', async () => {
        const controller = openWebview(makeContext(), makeOptions());
        const webview = mockWebview(controller);

        const message: VsCodeLinkRequestMessage = {
            id: 'q1',
            op: {
                id: 0,
                type: 'query',
                path: 'greet',
                input: undefined,
                context: {},
            } as VsCodeLinkRequestMessage['op'],
        };
        webview.receive(message);
        await flush();

        expect(webview.posted).toContainEqual({ id: 'q1', result: 'hi' });
    });
});

describe('new WebviewController(options)', () => {
    it('accepts the options bag directly', () => {
        const controller = new WebviewController({ extensionContext: makeContext(), ...makeOptions() });

        expect(controller).toBeInstanceOf(WebviewController);
        expect(controller.isDisposed).toBe(false);
        expect(controller.panel.webview.html).toContain("render('myView'");
    });
});
