/**
 * @jest-environment jsdom
 */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HarnessFixture } from './fixtures';
import { inertJson } from './template';

const base: HarnessFixture = {
    view: 'atlasCredentials', config: {}, assetRoot: '/stage0/l2/artifact', brokenCss: false,
    monaco: false, content: ['Settled fixture'], styles: [], rpc: {
        'fixture.query': { type: 'query', results: [{ message: 'fixture response' }] },
        'fixture.mutation': { type: 'mutation', results: [], undefinedResult: true },
        'fixture.subscription': { type: 'subscription', results: [{ state: 'ready' }], keepOpen: true },
    },
};

async function boot(fixture: HarnessFixture = base): Promise<ReturnType<typeof window.acquireVsCodeApi>> {
    document.body.innerHTML = `<script type="application/json" id="stage0-fixture">${inertJson(fixture)}</script><div>Settled fixture</div>`;
    Object.defineProperty(document.body, 'innerText', { configurable: true, value: 'Settled fixture' });
    jest.resetModules();
    await import('./runtime');
    return window.acquireVsCodeApi();
}

describe('Stage 0 L2 fixture transport', (): void => {
    beforeEach((): void => {
        Object.defineProperty(performance, 'getEntriesByType', {
            configurable: true, value: (): { name: string }[] => [{ name: 'http://localhost/stage0/l2/artifact/views.js' }],
        });
    });
    afterEach((): void => { jest.restoreAllMocks(); });

    it('answers the real {id, op} protocol with result then completion', async (): Promise<void> => {
        const messages = jest.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'query-id', op: { type: 'query', path: 'fixture.query', input: undefined } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'query-id', result: { message: 'fixture response' } }, { id: 'query-id', complete: true },
        ]);
    });

    it('preserves an explicit void result instead of turning JSON undefined into null', async (): Promise<void> => {
        const messages = jest.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'mutation-id', op: { type: 'mutation', path: 'fixture.mutation' } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'mutation-id', result: undefined }, { id: 'mutation-id', complete: true },
        ]);
    });

    it('fails unknown paths explicitly rather than replying null', async (): Promise<void> => {
        const messages = jest.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        expect((): void => api.postMessage({ id: 'unknown-id', op: { type: 'query', path: 'unknown.path' } }))
            .toThrow('No query fixture for unknown.path');
        expect(messages).toHaveBeenCalledWith({
            id: 'unknown-id', error: { name: 'FixtureError', message: 'No query fixture for unknown.path' }, complete: true,
        }, window.location.origin);
        const report = await window.stage0Harness.check();
        expect(report.errors).toContain('No query fixture for unknown.path');
    });

    it('fails invalid requests and operation-type mismatches', async (): Promise<void> => {
        jest.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        expect((): void => api.postMessage({ op: {} })).toThrow('Invalid tRPC request');
        expect((): void => api.postMessage({ id: 'wrong-type', op: { type: 'mutation', path: 'fixture.query' } }))
            .toThrow('No mutation fixture for fixture.query');
    });

    it('keeps streaming fixtures open and honors stop before delivery', async (): Promise<void> => {
        const messages = jest.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = await boot();
        api.postMessage({ id: 'sub-1', op: { type: 'subscription', path: 'fixture.subscription' } });
        await Promise.resolve();
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([{ id: 'sub-1', result: { state: 'ready' } }]);
        messages.mockClear();
        api.postMessage({ id: 'sub-2', op: { type: 'subscription', path: 'fixture.subscription' } });
        api.postMessage({ id: 'sub-2', op: { type: 'subscription.stop', path: 'fixture.subscription' } });
        api.postMessage({ id: 'sub-1', op: { type: 'abort', path: 'fixture.subscription' } });
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

    it('records CSP and preload failures in the persisted assertion surface', async (): Promise<void> => {
        await boot();
        const violation = Object.assign(new Event('securitypolicyviolation'), {
            violatedDirective: 'script-src', blockedURI: 'http://invalid.example/chunk.js',
        });
        document.dispatchEvent(violation);
        window.dispatchEvent(new Event('vite:preloadError'));
        const report = await window.stage0Harness.check();
        expect(report.errors).toContain('CSP: script-src: http://invalid.example/chunk.js');
        expect(report.errors).toContain('vite:preloadError');
    });

    it('requires a worker validation result, not merely construction or initialization', async (): Promise<void> => {
        const methods: string[] = [];
        let terminated = false;
        class FixtureWorker extends EventTarget {
            public postMessage(message: unknown): void {
                if (!message || typeof message !== 'object') {
                    return;
                }
                const operation = message as { method: string; req: string };
                methods.push(operation.method);
                const res: unknown = operation.method === '$fmr' ? [{ message: 'Value expected', severity: 1 }] : undefined;
                queueMicrotask((): void => {
                    this.dispatchEvent(new MessageEvent('message', { data: { seq: operation.req, res } }));
                });
            }
            public terminate(): void { terminated = true; }
        }
        Object.defineProperty(window, 'Worker', { configurable: true, value: FixtureWorker });
        await boot({ ...base, monaco: true });
        const report = await window.stage0Harness.check();
        expect(report.errors).toEqual([]);
        expect(methods).toEqual(['$initialize', '$loadForeignModule', '$acceptNewModel', '$fmr']);
        expect(report.worker).toEqual({
            url: '/stage0/l2/artifact/json.worker.js', roundTrip: 'doValidation',
            markers: [{ message: 'Value expected', severity: 1 }],
        });
        expect(terminated).toBe(true);
    });
});
