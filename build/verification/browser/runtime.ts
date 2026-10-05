/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewName } from '../../../src/webviews/_integration/WebviewRegistry';
import { fakeVsCodeApi } from './core/fakeVsCodeApi';
import { isRpcFixture } from './core/fixtures';
import { type HarnessFixture, type StyleExpectation } from './fixtures';

export interface BrowserReport {
    readonly view: string;
    readonly errors: readonly string[];
    readonly rpcPaths: readonly string[];
    readonly styles: readonly { selector: string; property: string; actual: string; expected: string }[];
    readonly chunks: readonly string[];
    readonly worker: EditorWorkerProof | undefined;
    readonly brokenCss: HarnessFixture['brokenCss'];
}

export interface EditorWorkerProof {
    readonly source: 'rendered-editor';
    readonly workerUrl: string;
    readonly modelUri: string;
    readonly probeMarker: string;
    readonly roundTrip: 'doValidation' | '$computeUnicodeHighlights';
    readonly result: unknown;
}

declare global {
    interface Window {
        stage0Harness: {
            check: () => Promise<BrowserReport>;
            ready: () => boolean;
            beginEditorProbe: (marker: string) => void;
            editorProbeReady: () => boolean;
        };
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return isUnknownArray(value) && value.every((item: unknown): boolean => typeof item === 'string');
}

function isStyleExpectation(value: unknown): value is StyleExpectation {
    return isObject(value) && typeof value.selector === 'string' && typeof value.property === 'string' &&
        typeof value.expected === 'string';
}

function isHarnessFixture(value: unknown): value is HarnessFixture {
    const views = {
        clusterDashboard: true, collectionView: true, documentView: true, localQuickStart: true, atlasCredentials: true,
    } satisfies Record<WebviewName, boolean>;
    return isObject(value) && typeof value.view === 'string' && Object.hasOwn(views, value.view) &&
        typeof value.assetRoot === 'string' &&
        (value.brokenCss === false || value.brokenCss === 'bundle-stylesheet' || value.brokenCss === 'all-styles') &&
        typeof value.monaco === 'boolean' &&
        Object.hasOwn(value, 'config') && isStringArray(value.content) && isUnknownArray(value.styles) &&
        value.styles.every(isStyleExpectation) && isObject(value.rpc) && Object.values(value.rpc).every(isRpcFixture);
}

const element = document.getElementById('stage0-fixture');
if (!element?.textContent) {
    throw new Error('Stage 0 fixture data missing');
}
const parsedFixture: unknown = JSON.parse(element.textContent);
if (!isHarnessFixture(parsedFixture)) {
    throw new Error('Stage 0 fixture data does not match the browser harness contract');
}
const fixture = parsedFixture;
const errors: string[] = [];
let probeMarker: string | undefined;
let editorWorkerProof: EditorWorkerProof | undefined;
const workerRecords: WorkerRecord[] = [];

interface WorkerRecord {
    readonly url: string;
    readonly models: Map<string, string>;
    readonly pending: Map<string, { modelUri: string; method: EditorWorkerProof['roundTrip'] }>;
    readonly methods: Set<string>;
}

function observeWorkerRequest(record: WorkerRecord, message: unknown): void {
    if (!isObject(message) || typeof message.method !== 'string' || !isUnknownArray(message.args)) {
        return;
    }
    const { method, args } = message;
    if (probeMarker) {
        record.methods.add(method);
    }
    if (method === '$acceptNewModel') {
        const model: unknown = args[0];
        if (isObject(model) && typeof model.url === 'string' && typeof model.EOL === 'string' && isStringArray(model.lines)) {
            record.models.set(model.url, model.lines.join(model.EOL));
        } else {
            errors.push('Unsupported editor worker model synchronization format');
        }
    }
    if (method === '$acceptModelChanged' && typeof args[0] === 'string' && isObject(args[1]) && isUnknownArray(args[1].changes)) {
        const changes: { offset: number; length: number; text: string }[] = [];
        for (const change of args[1].changes) {
            if (!isObject(change) || typeof change.text !== 'string' ||
                typeof change.rangeOffset !== 'number' || typeof change.rangeLength !== 'number') {
                errors.push(`Unsupported editor worker model change format: ${args[0]}`);
                return;
            }
            changes.push({ offset: change.rangeOffset, length: change.rangeLength, text: change.text });
        }
        let text = record.models.get(args[0]);
        if (text === undefined) {
            errors.push(`Editor worker changed an unsynchronized model: ${args[0]}`);
            return;
        }
        // Monaco may deliver one input event per character. Reconstruct the synchronized
        // model instead of requiring the whole probe marker in a single change.
        for (const change of changes.sort((left, right): number => right.offset - left.offset)) {
            if (!Number.isInteger(change.offset) || !Number.isInteger(change.length) || change.offset < 0 ||
                change.length < 0 || change.offset + change.length > text.length) {
                errors.push(`Invalid editor worker model change range: ${args[0]}`);
                return;
            }
            text = text.slice(0, change.offset) + change.text + text.slice(change.offset + change.length);
        }
        record.models.set(args[0], text);
    }
    if (method === '$acceptRemovedModel' && typeof args[0] === 'string') {
        record.models.delete(args[0]);
    }
    if (!probeMarker) {
        return;
    }
    let operation: EditorWorkerProof['roundTrip'] | undefined;
    let modelUri: unknown;
    if (fixture.view === 'documentView' && method === '$fmr' && args[0] === 'doValidation' && isUnknownArray(args[1])) {
        operation = 'doValidation';
        modelUri = args[1][0];
    } else if (fixture.view === 'collectionView' && method === '$computeUnicodeHighlights') {
        operation = '$computeUnicodeHighlights';
        modelUri = args[0];
    }
    if (operation && typeof modelUri === 'string' && record.models.get(modelUri)?.includes(probeMarker) && typeof message.req === 'string') {
        record.pending.set(message.req, { modelUri, method: operation });
    }
}

function observeWorkerResponse(record: WorkerRecord, message: unknown): void {
    if (!probeMarker || !isObject(message) || typeof message.seq !== 'string') {
        return;
    }
    const operation = record.pending.get(message.seq);
    if (!operation) {
        return;
    }
    record.pending.delete(message.seq);
    if (message.err) {
        errors.push(`Editor worker ${operation.method} failed: ${JSON.stringify(message.err)}`);
        return;
    }
    const result = message.res;
    const hasDiagnostic = operation.method === 'doValidation' && isUnknownArray(result) &&
        result.some((marker: unknown): boolean => isObject(marker) && typeof marker.message === 'string' && marker.severity === 1);
    const hasUnicodeHighlight = operation.method === '$computeUnicodeHighlights' && isObject(result) &&
        isUnknownArray(result.ranges) && result.ranges.length > 0;
    if (hasDiagnostic || hasUnicodeHighlight) {
        editorWorkerProof = {
            source: 'rendered-editor', workerUrl: record.url, modelUri: operation.modelUri,
            probeMarker, roundTrip: operation.method, result,
        };
    }
}

if (fixture.monaco) {
    const NativeWorker = window.Worker;
    if (typeof NativeWorker !== 'function') {
        throw new Error('Rendered Monaco verification requires native Worker support');
    }
    // Observe workers created by the production bundle without supplying a URL or sending
    // our own worker messages. The editor must sync the probe text and request the response.
    window.Worker = class extends NativeWorker {
        private readonly record: WorkerRecord;

        public constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.record = { url: String(url), models: new Map(), pending: new Map(), methods: new Set() };
            workerRecords.push(this.record);
            this.addEventListener('message', (event: MessageEvent<unknown>): void => {
                observeWorkerResponse(this.record, event.data);
            });
            this.addEventListener('error', (event: ErrorEvent): void => {
                errors.push(`Editor worker error: ${event.message}`);
            });
        }

        public override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
            observeWorkerRequest(this.record, message);
            if (Array.isArray(transferOrOptions)) {
                super.postMessage(message, transferOrOptions);
            } else {
                super.postMessage(message, transferOrOptions);
            }
        }
    };
}

const originalError: (...values: unknown[]) => void = console.error;
console.error = (...values: unknown[]): void => {
    errors.push(`console.error: ${values.map(String).join(' ')}`);
    Reflect.apply(originalError, console, values);
};
window.addEventListener('error', (event: ErrorEvent): void => { errors.push(`pageerror: ${event.message}`); });
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent): void => { errors.push(`unhandledrejection: ${String(event.reason)}`); });
document.addEventListener('securitypolicyviolation', (event: SecurityPolicyViolationEvent): void => {
    errors.push(`CSP: ${event.violatedDirective}: ${event.blockedURI}`);
});
window.addEventListener('vite:preloadError', (): void => { errors.push('vite:preloadError'); });

window.acquireVsCodeApi = fakeVsCodeApi(fixture.rpc, errors);

// Production CSS lives in JS: remove only Vite's marked bundle stylesheet, preserving
// Fluent/Griffel runtime styles; webpack/style-loader still requires removing all styles.
let removedBundleStylesheets = 0;
if (fixture.brokenCss) {
    const stripStyles = (): void => {
        const styles = document.querySelectorAll(fixture.brokenCss === 'bundle-stylesheet'
            ? 'style[data-documentdb-views-css]' : 'style');
        if (fixture.brokenCss === 'bundle-stylesheet') {
            removedBundleStylesheets += styles.length;
        }
        styles.forEach((style): void => { style.remove(); });
    };
    new MutationObserver(stripStyles).observe(document.documentElement, { childList: true, subtree: true });
    stripStyles();
}

function ready(): boolean {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return fixture.content.every((content): boolean => text.includes(content.replace(/\s+/g, ' '))) &&
        fixture.styles.every((style): boolean => document.querySelector(style.selector) !== null) &&
        !document.querySelector('[role="progressbar"]:not([aria-hidden="true"])');
}

async function check(): Promise<BrowserReport> {
    const failures = [...errors];
    if (fixture.brokenCss === 'bundle-stylesheet' && removedBundleStylesheets === 0) {
        failures.push('CSS-negative control removed no bundle stylesheet');
    }
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
    if (fixture.monaco && !editorWorkerProof) {
        const methods = [...new Set(workerRecords.flatMap((record): string[] => [...record.methods]))];
        failures.push(`No rendered-editor worker proof for ${fixture.view}; observed methods: ${methods.join(', ') || '<none>'}`);
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
    const rpcPaths = new Set(window.__harnessCalls.map((call): string => call.path));
    return { view: fixture.view, errors: [...new Set([...failures, ...errors])], rpcPaths: [...rpcPaths],
        styles, chunks, worker: editorWorkerProof, brokenCss: fixture.brokenCss };
}

function beginEditorProbe(marker: string): void {
    if (!fixture.monaco || !marker) {
        throw new Error('Editor worker probe requires a Monaco fixture and a nonempty marker');
    }
    probeMarker = marker;
    editorWorkerProof = undefined;
    for (const record of workerRecords) {
        record.pending.clear();
        record.methods.clear();
    }
}

window.stage0Harness = {
    ready, check, beginEditorProbe,
    editorProbeReady: (): boolean => editorWorkerProof !== undefined,
};
