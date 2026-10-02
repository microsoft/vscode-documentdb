/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { VsCodeLinkRequestMessage, VsCodeLinkResponseMessage } from '../../../packages/vscode-ext-webview/src/shared/wireProtocol';
import type { HarnessFixture } from './fixtures';
import type { WebviewApi } from 'vscode-webview';

export interface BrowserReport {
    readonly view: string;
    readonly errors: readonly string[];
    readonly rpcPaths: readonly string[];
    readonly styles: readonly { selector: string; property: string; actual: string; expected: string }[];
    readonly chunks: readonly string[];
    readonly worker: unknown;
    readonly brokenCss: boolean;
}

declare global {
    interface Window {
        stage0Harness: { check: () => Promise<BrowserReport>; ready: () => boolean };
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function request(value: unknown): value is VsCodeLinkRequestMessage {
    return isObject(value) && typeof value.id === 'string' && isObject(value.op) && typeof value.op.type === 'string';
}

const element = document.getElementById('stage0-fixture');
if (!element?.textContent) {
    throw new Error('Stage 0 fixture data missing');
}
const fixture: HarnessFixture = JSON.parse(element.textContent);
const errors: string[] = [];
const rpcPaths = new Set<string>();
const subscriptions = new Set<string>();
let acquired = false;

const originalError = console.error.bind(console);
console.error = (...values: unknown[]): void => {
    errors.push(`console.error: ${values.map(String).join(' ')}`);
    originalError(...values);
};
window.addEventListener('error', (event: ErrorEvent): void => { errors.push(`pageerror: ${event.message}`); });
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent): void => { errors.push(`unhandledrejection: ${String(event.reason)}`); });
document.addEventListener('securitypolicyviolation', (event: SecurityPolicyViolationEvent): void => {
    errors.push(`CSP: ${event.violatedDirective}: ${event.blockedURI}`);
});
window.addEventListener('vite:preloadError', (): void => { errors.push('vite:preloadError'); });

function send(message: VsCodeLinkResponseMessage): void {
    window.postMessage(message, window.location.origin);
}

function receive(value: unknown): void {
    if (!request(value)) {
        errors.push('Invalid tRPC request');
        throw new Error('Invalid tRPC request');
    }
    const { id, op } = value;
    if (op.type === 'subscription.stop' || op.type === 'abort') {
        subscriptions.delete(id);
        return;
    }
    rpcPaths.add(op.path);
    const response = Object.hasOwn(fixture.rpc, op.path) ? fixture.rpc[op.path] : undefined;
    if (!response || response.type !== op.type) {
        const message = `No ${op.type} fixture for ${op.path}`;
        errors.push(message);
        send({ id, error: { name: 'FixtureError', message }, complete: true });
        throw new Error(message);
    }
    if (response.keepOpen) {
        subscriptions.add(id);
    }
    queueMicrotask((): void => {
        if (response.keepOpen && !subscriptions.has(id)) {
            return;
        }
        for (const result of response.results) {
            send({ id, result });
        }
        if (response.undefinedResult) {
            send({ id, result: undefined });
        }
        if (!response.keepOpen) {
            send({ id, complete: true });
        }
    });
}

window.acquireVsCodeApi = <StateType = unknown>(): WebviewApi<StateType> => {
    if (acquired) {
        throw new Error('acquireVsCodeApi called more than once');
    }
    acquired = true;
    let state: StateType | undefined;
    return {
        postMessage: receive, getState: (): StateType | undefined => state,
        setState: <T extends StateType | undefined>(next: T): T => { state = next; return next; },
    };
};

// With style-loader, removing an external stylesheet is not a valid negative control:
// the production CSS lives in JS. This variant drops ONLY styles inserted by the bundle.
if (fixture.brokenCss) {
    const stripStyles = (): void => {
        document.querySelectorAll('style').forEach((style): void => { style.remove(); });
    };
    new MutationObserver(stripStyles).observe(document.documentElement, { childList: true, subtree: true });
}

function ready(): boolean {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return fixture.content.every((content): boolean => text.includes(content.replace(/\s+/g, ' '))) &&
        fixture.styles.every((style): boolean => document.querySelector(style.selector) !== null) &&
        !document.querySelector('[role="progressbar"]:not([aria-hidden="true"])');
}

async function workerRoundTrip(): Promise<unknown> {
    const worker = new Worker(`${fixture.assetRoot}/json.worker.js`);
    let sequence = 0;
    const rpc = (method: string, args: readonly unknown[]): Promise<unknown> => new Promise((resolve, reject): void => {
        const req = String(++sequence);
        const timeout = window.setTimeout((): void => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            reject(new Error(`Monaco worker timed out: ${method}`));
        }, 10000);
        const cleanup = (): void => {
            clearTimeout(timeout);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };
        const onError = (event: ErrorEvent): void => { cleanup(); reject(new Error(event.message)); };
        const onMessage = (event: MessageEvent<unknown>): void => {
            const data = event.data;
            if (!isObject(data) || data.seq !== req) {
                return;
            }
            cleanup();
            if (data.err) {
                reject(new Error(`Monaco worker ${method}: ${JSON.stringify(data.err)}`));
            } else {
                resolve(data.res);
            }
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({ vsWorker: 17, type: 0, req, channel: 'default', method, args });
    });
    try {
        // Monaco's worker entry consumes its first message to install the request handler.
        worker.postMessage('vs/language/json/jsonWorker');
        await rpc('$initialize', [17, null, 'vs/editor/common/services/editorSimpleWorker']);
        await rpc('$loadForeignModule', ['vs/language/json/jsonWorker', {
            languageId: 'json', languageSettings: { validate: true, allowComments: false }, enableSchemaRequest: false,
        }, []]);
        const uri = 'inmemory://stage0/invalid.json';
        await rpc('$acceptNewModel', [{ url: uri, versionId: 1, lines: ['{ "stage0": }'], EOL: '\n' }]);
        const markers = await rpc('$fmr', ['doValidation', [uri]]);
        if (!Array.isArray(markers) || !markers.some((marker: unknown): boolean =>
            isObject(marker) && typeof marker.message === 'string' && marker.severity === 1)) {
            throw new Error(`Monaco JSON worker returned no validation error: ${JSON.stringify(markers)}`);
        }
        return { url: `${fixture.assetRoot}/json.worker.js`, roundTrip: 'doValidation', markers };
    } finally {
        worker.terminate();
    }
}

async function check(): Promise<BrowserReport> {
    const failures = [...errors];
    if (!ready()) {
        failures.push(`Fixture content has not settled: ${fixture.content.join(', ')}`);
    }
    const styles = fixture.styles.map((style): BrowserReport['styles'][number] => {
        const node = document.querySelector(style.selector);
        const actual = node ? getComputedStyle(node).getPropertyValue(style.property) : '<missing>';
        if (actual !== style.expected) {
            failures.push(`Style ${style.selector} ${style.property}: expected ${style.expected}, got ${actual}`);
        }
        if (node && (node.getBoundingClientRect().width <= 0 || node.getBoundingClientRect().height <= 0)) {
            failures.push(`Empty layout: ${style.selector}`);
        }
        return { ...style, actual };
    });
    let worker: unknown;
    if (fixture.monaco) {
        try {
            worker = await workerRoundTrip();
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
        }
    }
    const chunks = performance.getEntriesByType('resource')
        .map((entry): string => entry.name).filter((name): boolean => /\.m?js(?:$|\?)/.test(name));
    if (!chunks.some((name): boolean => name.endsWith('/views.js'))) {
        failures.push('Production views.js was not fetched');
    }
    for (const name of chunks) {
        if (!new URL(name).pathname.startsWith(`${new URL(fixture.assetRoot, location.href).pathname}/`)) {
            if (!name.endsWith('/runtime.js')) {
                failures.push(`Chunk escaped non-root artifact prefix: ${name}`);
            }
        }
    }
    return { view: fixture.view, errors: [...new Set([...failures, ...errors])], rpcPaths: [...rpcPaths],
        styles, chunks, worker, brokenCss: fixture.brokenCss };
}

window.stage0Harness = { ready, check };
