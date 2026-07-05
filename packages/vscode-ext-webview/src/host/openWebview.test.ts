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
        isBundled: true,
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
        // R766-N03: initial data (including viewType) is delivered in an inert
        // application/json block; the boot script parses it and calls render(...).
        expect(html).toContain('id="vscode-ext-webview-initial-data"');
        expect(html).toContain('"viewType":"myView"');
        expect(html).toContain('render(__data.viewType');
        expect(html).toContain(encodeURIComponent(JSON.stringify({ hello: 'world' })));
    });

    it('escapes `</script>` in the serialized initial-data block so it cannot break out (R766-N03)', () => {
        const controller = openWebview(makeContext(), {
            ...makeOptions(),
            viewType: '</script><script>alert(1)</script>',
        });
        const html = controller.panel.webview.html;

        // The injected `<` must be escaped as \u003c inside the inert JSON block,
        // so the raw break-out sequence never appears in the document.
        expect(html).not.toContain('<script>alert(1)');
        expect(html).toContain('\\u003c/script');
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

    it('closes the panel when dispose() is called (R766-02)', () => {
        const controller = openWebview(makeContext(), makeOptions());
        const panel = controller.panel as unknown as { disposed: boolean };

        controller.dispose();

        // A public handle whose dispose() left the tab open would be surprising;
        // dispose() must close the panel.
        expect(panel.disposed).toBe(true);
        expect(controller.isDisposed).toBe(true);
    });

    it('disposes the controller exactly once when the user closes the tab (R766-02)', () => {
        const controller = openWebview(makeContext(), makeOptions());
        const panel = controller.panel as unknown as { disposed: boolean };
        let firedCount = 0;
        controller.onDisposed(() => {
            firedCount += 1;
        });

        // Simulate the user closing the tab: VS Code disposes the panel, firing
        // onDidDispose. The controller must dispose exactly once and must not
        // recurse back into panel.dispose().
        controller.panel.dispose();

        expect(controller.isDisposed).toBe(true);
        expect(panel.disposed).toBe(true);
        expect(firedCount).toBe(1);
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

    it('wires the caller factory from the `trpc` instance option (R766-N02)', async () => {
        // Pass the whole `initWebviewTrpc()` result via `trpc` and NO standalone
        // `createCallerFactory`. The controller must read `trpc.createCallerFactory`
        // off it, so the query dispatches against the same instance the router was
        // built from.
        const trpc = initWebviewTrpc<BaseRouterContext>();
        const appRouter = trpc.router({
            greet: trpc.publicProcedure.query(() => 'hi from trpc'),
        });
        const controller = openWebview(makeContext(), {
            title: 'My View',
            viewType: 'myView',
            router: appRouter,
            trpc,
            context: {} as BaseRouterContext,
            config: { hello: 'world' },
            sourceLayout,
            isBundled: true,
        });
        const webview = mockWebview(controller);

        webview.receive({
            id: 'q1',
            op: { id: 0, type: 'query', path: 'greet', input: undefined, context: {} },
        } as VsCodeLinkRequestMessage);
        await flush();

        expect(webview.posted).toContainEqual({ id: 'q1', result: 'hi from trpc' });
    });
});

describe('new WebviewController(options)', () => {
    it('accepts the options bag directly', () => {
        const controller = new WebviewController({ extensionContext: makeContext(), ...makeOptions() });

        expect(controller).toBeInstanceOf(WebviewController);
        expect(controller.isDisposed).toBe(false);
        expect(controller.panel.webview.html).toContain('id="vscode-ext-webview-initial-data"');
        expect(controller.panel.webview.html).toContain('"viewType":"myView"');
    });
});

describe('script source layout selection', () => {
    // Distinct file names so the selected layout is unambiguous in the HTML.
    const splitLayout = {
        bundled: { dir: 'dist', file: 'views.js' },
        dev: { dir: 'out', file: 'index.js' },
    };
    const devServerHost = 'http://localhost:18080';

    function makeContextWithMode(mode: number): vscode.ExtensionContext {
        return {
            extensionPath: '/ext',
            extensionMode: mode,
        } as unknown as vscode.ExtensionContext;
    }

    function htmlFor(overrides: { mode: number; isBundled: boolean; devServer: boolean }): string {
        const previous = process.env.DEVSERVER;
        if (overrides.devServer) {
            process.env.DEVSERVER = 'true';
        } else {
            delete process.env.DEVSERVER;
        }
        try {
            const controller = openWebview(makeContextWithMode(overrides.mode), {
                ...makeOptions(),
                sourceLayout: splitLayout,
                devServerHost,
                isBundled: overrides.isBundled,
            });
            return controller.panel.webview.html;
        } finally {
            if (previous === undefined) {
                delete process.env.DEVSERVER;
            } else {
                process.env.DEVSERVER = previous;
            }
        }
    }

    it('loads the bundled file from the dev server when bundled in development (regression: index.js 404)', () => {
        // A webpack-bundled extension running in Development with the dev server
        // on must ask the dev server for the *bundled* asset name (views.js),
        // because `webpack serve` emits that name. Keying the layout off the mode
        // alone would request the tsc `index.js` and 404.
        const html = htmlFor({ mode: vscode.ExtensionMode.Development, isBundled: true, devServer: true });

        expect(html).toContain(`import { render } from "${devServerHost}/views.js"`);
        expect(html).not.toContain(`${devServerHost}/index.js`);
    });

    it('loads the dev (tsc) file from the dev server when not bundled', () => {
        const html = htmlFor({ mode: vscode.ExtensionMode.Development, isBundled: false, devServer: true });

        expect(html).toContain(`import { render } from "${devServerHost}/index.js"`);
    });
});
