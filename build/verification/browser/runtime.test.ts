/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type HarnessFixture } from './fixtures';
import { inertJson } from './template';

const base: HarnessFixture = {
    view: 'atlasCredentials',
    config: {},
    assetRoot: '/stage0/l2/artifact',
    brokenCss: false,
    monaco: false,
    content: ['Settled fixture'],
    styles: [],
    rpc: {
        'localQuickStart.checkPort': { type: 'query', results: [{ message: 'fixture response' }] },
        'common.reportEvent': { type: 'mutation', results: [], undefinedResult: true },
        'localQuickStart.onInstanceChanged': { type: 'subscription', results: [{ state: 'ready' }], keepOpen: true },
    },
};
let constructedWorkers = 0;
const forwardedMessages: unknown[] = [];

class FixtureNativeWorker extends EventTarget {
    public constructor(_url: string | URL, _options?: WorkerOptions) {
        super();
        constructedWorkers++;
    }
    public postMessage(message: unknown, _options?: Transferable[] | StructuredSerializeOptions): void {
        forwardedMessages.push(message);
    }
    public terminate(): void {}
}

function syncProbe(worker: Worker, uri = 'inmemory://fixture/editor.json'): void {
    worker.postMessage({
        type: 0,
        req: 'sync',
        method: '$acceptNewModel',
        args: [
            {
                url: uri,
                lines: ['{ "stage0_worker_probe": "left\u200bright", "invalid": }'],
                versionId: 2,
                EOL: '\n',
            },
        ],
    });
}

function validationRequest(worker: Worker, uri = 'inmemory://fixture/editor.json'): void {
    worker.postMessage({ type: 0, req: 'validation', method: '$fmr', args: ['doValidation', [uri]] });
}

async function boot(fixture: unknown = base): Promise<ReturnType<typeof window.acquireVsCodeApi>> {
    document.body.innerHTML = `<script type="application/json" id="stage0-fixture">${inertJson(fixture)}</script><div>Settled fixture</div>`;
    Object.defineProperty(document.body, 'innerText', { configurable: true, value: 'Settled fixture' });
    vi.resetModules();
    await import('./runtime');
    return window.acquireVsCodeApi();
}

describe('Stage 0 L2 fixture transport', (): void => {
    beforeEach((): void => {
        constructedWorkers = 0;
        forwardedMessages.length = 0;
        Object.defineProperty(window, 'Worker', { configurable: true, writable: true, value: FixtureNativeWorker });
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true,
            value: (): { name: string }[] => [{ name: 'http://localhost/stage0/l2/artifact/views.js' }],
        });
    });
    afterEach((): void => {
        vi.restoreAllMocks();
    });

    it.each([
        { view: 'unknown-view' },
        { brokenCss: true },
        { brokenCss: 'unknown-mode' },
        { content: [true] },
        { styles: [{ selector: '.fixture', property: 7, expected: 'flex' }] },
        { rpc: { 'fixture.query': { type: 'query', results: 'invalid' } } },
        { rpc: { 'fixture.query': { type: 'query', results: [], keepOpen: 'invalid' } } },
    ])('rejects invalid inert fixture data at the JSON boundary: %j', async (override: unknown): Promise<void> => {
        if (!override || typeof override !== 'object') {
            throw new Error('Invalid regression test override');
        }
        await expect(boot({ ...base, ...override })).rejects.toThrow(
            'Stage 0 fixture data does not match the browser harness contract',
        );
    });

    it('answers the real {id, op} protocol with result then completion', async (): Promise<void> => {
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'query-id', op: { type: 'query', path: 'localQuickStart.checkPort', input: undefined } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'query-id', result: { message: 'fixture response' } },
            { id: 'query-id', complete: true },
        ]);
    });

    it('preserves an explicit void result instead of turning JSON undefined into null', async (): Promise<void> => {
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'mutation-id', op: { type: 'mutation', path: 'common.reportEvent' } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'mutation-id', result: undefined },
            { id: 'mutation-id', complete: true },
        ]);
    });

    it('fails unknown paths explicitly rather than replying null', async (): Promise<void> => {
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        expect((): void => api.postMessage({ id: 'unknown-id', op: { type: 'query', path: 'unknown.path' } })).toThrow(
            'No query fixture for unknown.path',
        );
        expect(messages).toHaveBeenCalledWith(
            {
                id: 'unknown-id',
                error: { name: 'FixtureError', message: 'No query fixture for unknown.path' },
                complete: true,
            },
            window.location.origin,
        );
        const report = await window.stage0Harness.check();
        expect(report.errors).toContain('No query fixture for unknown.path');
    });

    it('fails invalid requests and operation-type mismatches', async (): Promise<void> => {
        vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        expect((): void => api.postMessage({ op: {} })).toThrow('Invalid tRPC request');
        expect((): void =>
            api.postMessage({ id: 'wrong-type', op: { type: 'mutation', path: 'localQuickStart.checkPort' } }),
        ).toThrow('No mutation fixture for localQuickStart.checkPort');
    });

    it('keeps streaming fixtures open and honors stop before delivery', async (): Promise<void> => {
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'sub-1', op: { type: 'subscription', path: 'localQuickStart.onInstanceChanged' } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'sub-1', result: { state: 'ready' } },
        ]);
        messages.mockClear();
        api.postMessage({ id: 'sub-2', op: { type: 'subscription', path: 'localQuickStart.onInstanceChanged' } });
        api.postMessage({ id: 'sub-2', op: { type: 'subscription.stop', path: 'localQuickStart.onInstanceChanged' } });
        api.postMessage({ id: 'sub-1', op: { type: 'abort', path: 'localQuickStart.onInstanceChanged' } });
        await Promise.resolve();
        expect(messages).not.toHaveBeenCalled();
    });

    it('provides state persistence and single-acquire semantics', async (): Promise<void> => {
        const api = await boot();
        expect(api.getState()).toBeUndefined();
        expect(api.setState({ active: true })).toEqual({ active: true });
        expect(api.getState()).toEqual({ active: true });
        expect((): unknown => window.acquireVsCodeApi()).toThrow('more than once');
    });

    it('keeps rpcPaths unique and ordered while exposing every procedure call', async (): Promise<void> => {
        vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        const path = 'localQuickStart.checkPort';
        api.postMessage({ id: 'first', op: { type: 'query', path, input: { port: 10260 } } });
        api.postMessage({ id: 'second', op: { type: 'query', path, input: { port: 10261 } } });
        api.postMessage({ id: 'third', op: { type: 'mutation', path: 'common.reportEvent', input: undefined } });
        api.postMessage({ id: 'stop', op: { type: 'subscription.stop', path } });
        expect(window.__harnessCalls).toEqual([
            { path, type: 'query', input: { port: 10260 } },
            { path, type: 'query', input: { port: 10261 } },
            { path: 'common.reportEvent', type: 'mutation', input: undefined },
        ]);
        expect((await window.stage0Harness.check()).rpcPaths).toEqual([path, 'common.reportEvent']);
    });

    it('records CSP and preload failures in the persisted assertion surface', async (): Promise<void> => {
        await boot();
        const violation = Object.assign(new Event('securitypolicyviolation'), {
            violatedDirective: 'script-src',
            blockedURI: 'http://invalid.example/chunk.js',
        });
        document.dispatchEvent(violation);
        window.dispatchEvent(new Event('vite:preloadError'));
        const report = await window.stage0Harness.check();
        expect(report.errors).toContain('CSP: script-src: http://invalid.example/chunk.js');
        expect(report.errors).toContain('vite:preloadError');
    });

    it('never constructs a standalone worker or sends its own messages when checking', async (): Promise<void> => {
        await boot({ ...base, view: 'documentView', monaco: true });
        const report = await window.stage0Harness.check();
        expect(report.errors).toContain('No rendered-editor worker proof for documentView; observed methods: <none>');
        expect(report.worker).toBeUndefined();
        expect(constructedWorkers).toBe(0);
        expect(forwardedMessages).toEqual([]);
    });

    it('requires model synchronization, a matching editor request, and a correlated diagnostic response', async (): Promise<void> => {
        await boot({ ...base, view: 'documentView', monaco: true });
        const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
        window.stage0Harness.beginEditorProbe('stage0_worker_probe');
        syncProbe(worker);
        validationRequest(worker);
        worker.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    seq: 'unrelated',
                    res: [{ message: 'Value expected', severity: 1 }],
                },
            }),
        );
        expect(window.stage0Harness.editorProbeReady()).toBe(false);
        worker.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    seq: 'validation',
                    res: [{ message: 'Value expected', severity: 1 }],
                },
            }),
        );
        expect(window.stage0Harness.editorProbeReady()).toBe(true);
        const report = await window.stage0Harness.check();
        expect(report.errors).toEqual([]);
        expect(report.worker).toEqual({
            source: 'rendered-editor',
            workerUrl: '/stage0/l2/artifact/configured.worker.js',
            modelUri: 'inmemory://fixture/editor.json',
            probeMarker: 'stage0_worker_probe',
            roundTrip: 'doValidation',
            result: [{ message: 'Value expected', severity: 1 }],
        });
        expect(constructedWorkers).toBe(1);
        expect(forwardedMessages).toHaveLength(2);
    });

    it.each(['no-sync', 'wrong-model', 'empty-diagnostics', 'initialization'])(
        'rejects incomplete editor integration: %s',
        async (scenario: string): Promise<void> => {
            await boot({ ...base, view: 'documentView', monaco: true });
            const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
            window.stage0Harness.beginEditorProbe('stage0_worker_probe');
            if (scenario !== 'no-sync') {
                syncProbe(worker);
            }
            if (scenario === 'initialization') {
                worker.postMessage({ req: 'validation', method: '$initialize', args: [] });
            } else {
                validationRequest(worker, scenario === 'wrong-model' ? 'inmemory://different/model.json' : undefined);
            }
            worker.dispatchEvent(
                new MessageEvent('message', {
                    data: {
                        seq: 'validation',
                        res: scenario === 'empty-diagnostics' ? [] : [{ message: 'Value expected', severity: 1 }],
                    },
                }),
            );
            expect(window.stage0Harness.editorProbeReady()).toBe(false);
            expect((await window.stage0Harness.check()).worker).toBeUndefined();
        },
    );

    it('observes actual editor-worker highlighting for the custom Collection View language', async (): Promise<void> => {
        await boot({ ...base, view: 'collectionView', monaco: true });
        const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
        worker.postMessage({
            req: 'initial',
            method: '$acceptNewModel',
            args: [
                {
                    url: 'documentdb-query://filter/session',
                    lines: ['{}'],
                    EOL: '\n',
                },
            ],
        });
        window.stage0Harness.beginEditorProbe('stage0_worker_probe');
        worker.postMessage({
            req: 'sync',
            method: '$acceptModelChanged',
            args: [
                'documentdb-query://filter/session',
                {
                    changes: [
                        {
                            text: '{ "stage0_worker_probe": "left\u200bright", "invalid": }',
                            rangeOffset: 0,
                            rangeLength: 2,
                        },
                    ],
                    versionId: 2,
                },
            ],
        });
        worker.postMessage({
            req: 'highlight',
            method: '$computeUnicodeHighlights',
            args: ['documentdb-query://filter/session', {}],
        });
        worker.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    seq: 'highlight',
                    res: { ranges: [{ startLineNumber: 1, startColumn: 36, endLineNumber: 1, endColumn: 37 }] },
                },
            }),
        );
        expect(window.stage0Harness.editorProbeReady()).toBe(true);
        expect((await window.stage0Harness.check()).worker?.roundTrip).toBe('$computeUnicodeHighlights');
    });

    it('does not accept a main-thread marker or a worker reply that has no highlight', async (): Promise<void> => {
        await boot({ ...base, view: 'collectionView', monaco: true });
        const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
        window.stage0Harness.beginEditorProbe('stage0_worker_probe');
        syncProbe(worker);
        worker.postMessage({
            req: 'highlight',
            method: '$computeUnicodeHighlights',
            args: ['inmemory://fixture/editor.json', {}],
        });
        worker.dispatchEvent(new MessageEvent('message', { data: { seq: 'highlight', res: { ranges: [] } } }));
        document.body.insertAdjacentHTML('beforeend', '<span class="squiggly-error">Main-thread error</span>');
        expect(window.stage0Harness.editorProbeReady()).toBe(false);
        expect((await window.stage0Harness.check()).worker).toBeUndefined();
    });

    it('records worker response errors without manufacturing a successful proof', async (): Promise<void> => {
        await boot({ ...base, view: 'documentView', monaco: true });
        const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
        window.stage0Harness.beginEditorProbe('stage0_worker_probe');
        syncProbe(worker);
        validationRequest(worker);
        worker.dispatchEvent(
            new MessageEvent('message', { data: { seq: 'validation', err: { message: 'worker failed' } } }),
        );
        const report = await window.stage0Harness.check();
        expect(report.worker).toBeUndefined();
        expect(report.errors).toContain('Editor worker doValidation failed: {"message":"worker failed"}');
    });

    it('tracks probe text across incremental keystrokes and a model already synchronized before the probe', async (): Promise<void> => {
        await boot({ ...base, view: 'documentView', monaco: true });
        const worker = new window.Worker('/stage0/l2/artifact/configured.worker.js');
        worker.postMessage({
            req: 'initial',
            method: '$acceptNewModel',
            args: [
                {
                    url: 'inmemory://fixture/editor.json',
                    lines: [''],
                    EOL: '\n',
                },
            ],
        });
        window.stage0Harness.beginEditorProbe('stage0_worker_probe');
        const marker = 'stage0_worker_probe';
        for (let offset = 0; offset < marker.length; offset++) {
            worker.postMessage({
                req: `change-${offset}`,
                method: '$acceptModelChanged',
                args: [
                    'inmemory://fixture/editor.json',
                    {
                        changes: [{ rangeOffset: offset, rangeLength: 0, text: marker[offset] }],
                    },
                ],
            });
        }
        validationRequest(worker);
        worker.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    seq: 'validation',
                    res: [{ message: 'Value expected', severity: 1 }],
                },
            }),
        );
        expect(window.stage0Harness.editorProbeReady()).toBe(true);
        expect((await window.stage0Harness.check()).errors).toEqual([]);
    });

    describe('CSS-negative control', (): void => {
        const observers: MutationObserver[] = [];

        beforeEach((): void => {
            const NativeMutationObserver = window.MutationObserver;
            vi.stubGlobal(
                'MutationObserver',
                class extends NativeMutationObserver {
                    public constructor(callback: MutationCallback) {
                        super(callback);
                        observers.push(this);
                    }
                },
            );
        });
        afterEach((): void => {
            for (const observer of observers) {
                observer.disconnect();
            }
            observers.length = 0;
            vi.unstubAllGlobals();
            document.head.querySelectorAll('style, link').forEach((node): void => {
                node.remove();
            });
        });

        it('removes existing and late Vite bundle styles while retaining Fluent/Griffel styles and host CSS', async (): Promise<void> => {
            document.head.innerHTML =
                '<link rel="stylesheet" href="/stage0/l2/theme.css"><style data-make-styles-bucket="d">.fluent { display: flex; }</style><style data-documentdb-views-css>.fixture { display: flex; }</style>';
            await boot({ ...base, brokenCss: 'bundle-stylesheet' });
            expect(document.querySelector('style[data-documentdb-views-css]')).toBeNull();
            document.head.insertAdjacentHTML(
                'beforeend',
                '<style data-documentdb-views-css>.late { display: flex; }</style><style data-make-styles-bucket="r">.runtime { display: block; }</style>',
            );
            await Promise.resolve();
            expect(document.querySelector('style[data-documentdb-views-css]')).toBeNull();
            expect(document.querySelectorAll('style[data-make-styles-bucket]')).toHaveLength(2);
            expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/stage0/l2/theme.css');
            const report = await window.stage0Harness.check();
            expect(report.errors).toEqual([]);
            expect(report.brokenCss).toBe('bundle-stylesheet');
        });

        it('reports measured style failures with no unrelated diagnostics after removing the bundle stylesheet', async (): Promise<void> => {
            await boot({
                ...base,
                brokenCss: 'bundle-stylesheet',
                styles: [{ selector: '#css-probe', property: 'display', expected: 'flex' }],
            });
            document.body.insertAdjacentHTML(
                'beforeend',
                '<div id="css-probe">Probe</div><style data-documentdb-views-css>#css-probe { display: flex; }</style>',
            );
            await Promise.resolve();
            const report = await window.stage0Harness.check();
            expect(report.styles).toEqual([
                { selector: '#css-probe', property: 'display', expected: 'flex', actual: 'block' },
            ]);
            expect(report.errors).toEqual([
                'Style #css-probe display: expected flex, got block',
                'Empty layout: #css-probe',
            ]);
        });

        it('fails loudly if only an unmarked or renamed stylesheet is inserted, but accepts a later marked removal', async (): Promise<void> => {
            await boot({ ...base, brokenCss: 'bundle-stylesheet' });
            document.head.insertAdjacentHTML(
                'beforeend',
                '<style data-renamed-views-css>.fixture { display: flex; }</style>',
            );
            await Promise.resolve();
            expect((await window.stage0Harness.check()).errors).toEqual([
                'CSS-negative control removed no bundle stylesheet',
            ]);
            expect(document.querySelector('style[data-renamed-views-css]')).not.toBeNull();
            document.head.insertAdjacentHTML(
                'beforeend',
                '<style data-documentdb-views-css>.fixture { display: flex; }</style>',
            );
            await Promise.resolve();
            expect((await window.stage0Harness.check()).errors).toEqual([]);
        });

        it('never removes styles or requires a bundle stylesheet on normal pages', async (): Promise<void> => {
            document.head.innerHTML = '<style data-make-styles-bucket="d">.fluent { display: flex; }</style>';
            await boot();
            expect((await window.stage0Harness.check()).errors).toEqual([]);
            document.head.insertAdjacentHTML(
                'beforeend',
                '<style data-documentdb-views-css>.fixture { display: flex; }</style>',
            );
            await Promise.resolve();
            expect(document.querySelectorAll('style')).toHaveLength(2);
            expect((await window.stage0Harness.check()).errors).toEqual([]);
            expect(observers).toHaveLength(0);
        });
    });
});
