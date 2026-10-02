/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Representative calls on every public entry point of the workspace packages. Shared by the
// CommonJS probe (`require`), the ESM probe (`import`) and the Vitest probe; each passes its own
// `load(specifier)` so the module under test is loaded the way that consumer loads it.
//
// A check returns a short description of what it proved, or throws. Checks marked `dom` need a
// browser DOM and only run under the Vitest probe (jsdom); the Node probes still load the entry.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function render(element) {
    // eslint-disable-next-line import/no-internal-modules -- `react-dom/server` is a public entry point
    const { renderToString } = await import('react-dom/server');
    return renderToString(element);
}

function messageTarget() {
    if (!globalThis.window) {
        globalThis.window = new EventTarget();
    }
    const target = globalThis.window;
    const MessageEventCtor = target.MessageEvent ?? globalThis.MessageEvent;
    return {
        target,
        dispatch: (data) => target.dispatchEvent(new MessageEventCtor('message', { data })),
    };
}

function greetRouter(shared) {
    const { router, publicProcedure, createCallerFactory } = shared.initWebviewTrpc();
    return { appRouter: router({ greet: publicProcedure.query(() => 'hello') }), createCallerFactory };
}

// The host side of the transport, over a stub `WebviewPanel`.
function stubPanel(onPost) {
    let handler;
    const panel = {
        webview: {
            onDidReceiveMessage(callback) {
                handler = callback;
                return { dispose() {} };
            },
            postMessage(message) {
                onPost(message);
                return Promise.resolve(true);
            },
        },
    };
    return { panel, send: (message) => handler(message) };
}

export const checks = {
    '@documentdb-js/operator-registry': async (load) => {
        const m = await load('@documentdb-js/operator-registry');
        const all = m.getAllCompletions();
        const filter = m.getFilteredCompletions({ meta: m.FILTER_COMPLETION_META });
        assert.ok(all.length > 100, 'getAllCompletions() returned too few entries');
        const eq = filter.find((entry) => entry.value === '$eq');
        assert.ok(eq, 'FILTER completions miss $eq');
        assert.match(String(m.getDocLink('$eq', eq.meta)), /^https:\/\//);
        return `${all.length} operators, ${filter.length} filter completions, $eq doc link`;
    },

    '@documentdb-js/schema-analyzer': async (load) => {
        const m = await load('@documentdb-js/schema-analyzer');
        const { ObjectId, Int32, Double } = await load('mongodb');
        const analyzer = new m.SchemaAnalyzer();
        analyzer.addDocument({ _id: new ObjectId(), n: new Int32(7), d: new Double(1.5), tags: ['a'] });
        const fields = m.getKnownFields(analyzer.getSchema()).map((field) => field.path);
        for (const path of ['_id', 'n', 'd', 'tags']) {
            assert.ok(fields.includes(path), `getKnownFields misses ${path}: ${fields.join(', ')}`);
        }
        assert.equal(m.BSONTypes.inferType(new ObjectId()), 'objectid');
        assert.equal(m.BSONTypes.inferType(new Int32(1)), 'int32');
        assert.equal(m.BSONTypes.inferType(new Double(1)), 'double');
        return `fields ${fields.join(', ')}; ObjectId/Int32/Double classified`;
    },

    '@documentdb-js/shell-api-types': async (load) => {
        const m = await load('@documentdb-js/shell-api-types');
        const dts = m.getShellApiDtsContent();
        assert.ok(dts.length > 10_000 && dts.includes('declare'), 'getShellApiDtsContent() did not read the .d.ts');
        assert.ok(m.getMethodsByTarget('collection').length > 10);
        assert.ok(m.getRequiredServerCommands().includes('find'));
        return `read ${dts.length} chars of .d.ts; ${m.SHELL_API_METHODS.length} methods`;
    },

    '@documentdb-js/shell-api-types/typeDefs/*': async (load) => {
        const m = await load('@documentdb-js/shell-api-types');
        const file = require.resolve('@documentdb-js/shell-api-types/typeDefs/documentdb-shell-api.d.ts');
        assert.equal(readFileSync(file, 'utf8'), m.getShellApiDtsContent());
        return 'typeDefs/documentdb-shell-api.d.ts resolves and equals getShellApiDtsContent()';
    },

    '@documentdb-js/shell-runtime': async (load) => {
        const m = await load('@documentdb-js/shell-runtime');
        const { MongoClient } = await load('mongodb');
        const help = new m.HelpProvider().getHelpText();
        assert.ok(help.length > 100, 'HelpProvider returned no help');
        // `help` is answered by the command interceptor, so no server is needed.
        const runtime = new m.DocumentDBShellRuntime(new MongoClient('mongodb://127.0.0.1:1'));
        try {
            const result = await runtime.evaluate('help', 'test');
            assert.ok(JSON.stringify(result).length > 100, 'runtime.evaluate("help") returned nothing');
        } finally {
            runtime.dispose();
        }
        return `help ${help.length} chars; DocumentDBShellRuntime.evaluate('help') answered`;
    },

    '@microsoft/vscode-ext-webview': async (load) => {
        const m = await load('@microsoft/vscode-ext-webview');
        const { appRouter, createCallerFactory } = greetRouter(m);
        assert.equal(await createCallerFactory(appRouter)({}).greet(), 'hello');
        assert.equal(typeof m.mergeRouters, 'function');
        return 'initWebviewTrpc router answered through a caller';
    },

    '@microsoft/vscode-ext-webview/host': async (load) => {
        const host = await load('@microsoft/vscode-ext-webview/host');
        const shared = await load('@microsoft/vscode-ext-webview');
        const { appRouter, createCallerFactory } = greetRouter(shared);
        const posted = [];
        const stub = stubPanel((message) => posted.push(message));
        host.attachTrpc(stub.panel, {}, appRouter, createCallerFactory);
        await stub.send({ id: 'q1', op: { id: 0, type: 'query', path: 'greet', input: undefined, context: {} } });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = posted.find((message) => message.id === 'q1');
        assert.equal(response?.result, 'hello', `unexpected host response: ${JSON.stringify(posted)}`);
        assert.equal(typeof host.telemetryMiddlewareBody, 'function');
        return 'attachTrpc answered a query over a stub panel';
    },

    '@microsoft/vscode-ext-webview/webview': async (load) => {
        const webview = await load('@microsoft/vscode-ext-webview/webview');
        const host = await load('@microsoft/vscode-ext-webview/host');
        const shared = await load('@microsoft/vscode-ext-webview');
        const { appRouter, createCallerFactory } = greetRouter(shared);
        const bus = messageTarget();
        const stub = stubPanel((message) => queueMicrotask(() => bus.dispatch(message)));
        host.attachTrpc(stub.panel, {}, appRouter, createCallerFactory);
        const vscodeApi = { postMessage: (message) => void stub.send(message), getState() {}, setState() {} };
        const { client } = webview.connectTrpc(vscodeApi);
        assert.equal(await client.greet.query(), 'hello');
        return 'connectTrpc client <-> attachTrpc host round trip';
    },

    '@microsoft/vscode-ext-webview/react': async (load) => {
        const react = await load('@microsoft/vscode-ext-webview/react');
        const { createElement } = await load('react');
        let clientKind;
        const Probe = () => {
            clientKind = typeof react.useTrpcClient().greet.query;
            return createElement('span', null, 'react-probe');
        };
        messageTarget();
        const vscodeApi = { postMessage() {}, getState() {}, setState() {} };
        const html = await render(createElement(react.WithWebviewContext, { vscodeApi }, createElement(Probe)));
        assert.match(html, /react-probe/);
        assert.equal(clientKind, 'function');
        return 'WithWebviewContext + useTrpcClient rendered';
    },

    '@microsoft/vscode-ext-webview-fluentui': {
        dom: true,
        run: async (load) => {
            const m = await load('@microsoft/vscode-ext-webview-fluentui');
            const { createElement } = await load('react');
            const theme = m.createVSCodeFluentTheme('vscode-dark');
            assert.equal(typeof theme?.colorNeutralBackground1, 'string');
            const html = await render(createElement(m.VSCodeFluentProvider, null, 'fluent-probe'));
            assert.match(html, /fluent-probe/);
            return 'createVSCodeFluentTheme + VSCodeFluentProvider rendered';
        },
    },

    '@microsoft/vscode-ext-webview-fluentui/components': {
        dom: true,
        run: async (load) => {
            const m = await load('@microsoft/vscode-ext-webview-fluentui/components');
            const { createElement } = await load('react');
            const html = await render(createElement(m.MetricCard, { label: 'Execution time', value: '1 ms' }));
            assert.match(html, /Execution time/);
            return 'MetricCard rendered';
        },
    },

    '@microsoft/vscode-ext-webview-fluentui/monaco': {
        dom: true,
        run: async (load) => {
            const m = await load('@microsoft/vscode-ext-webview-fluentui/monaco');
            const theme = m.createVSCodeMonacoTheme({ themeKind: 'vscode-dark' });
            assert.equal(theme.data.base, 'vs-dark');
            assert.equal(typeof theme.themeName, 'string');
            return 'createVSCodeMonacoTheme returned a vs-dark theme';
        },
    },
};

// The module specifier a check loads first; `typeDefs/*` is a non-JS subpath of shell-api-types.
export function entryOf(name) {
    return name.endsWith('/typeDefs/*') ? name.slice(0, -'/typeDefs/*'.length) : name;
}

export function normalize(check) {
    return typeof check === 'function' ? { dom: false, run: check } : check;
}
