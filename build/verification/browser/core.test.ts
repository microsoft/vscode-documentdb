/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';

import { fakeVsCodeApi } from './core/fakeVsCodeApi';
import { type FixtureOutputs, type RpcFixtures } from './core/fixtures';

const port: FixtureOutputs['localQuickStart']['checkPort'] = 'available';
const rpc = {
    'localQuickStart.checkPort': { type: 'query', results: [port] },
    'common.openUrl': { type: 'mutation', results: [], undefinedResult: true },
    'clusterDashboard.copyConnectionString': { type: 'mutation', results: [], undefinedResult: true },
    'localQuickStart.openConnection': { type: 'mutation', results: [], undefinedResult: true },
} satisfies RpcFixtures;

describe('Shared browser fixture core', (): void => {
    afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it('records an unknown call and its error and answers with an error, never a default result', (): void => {
        const errors: string[] = [];
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = fakeVsCodeApi(rpc, errors)();
        expect((): void => api.postMessage({ id: 'unknown', op: { type: 'query', path: 'unknown.path', input: { key: 1 } } }))
            .toThrow('No query fixture for unknown.path');
        expect(errors).toEqual(['No query fixture for unknown.path']);
        expect(window.__harnessCalls).toEqual([{ path: 'unknown.path', type: 'query', input: { key: 1 } }]);
        expect(messages.mock.calls).toEqual([[
            { id: 'unknown', error: { name: 'FixtureError', message: 'No query fixture for unknown.path' }, complete: true },
            window.location.origin,
        ]]);
    });

    it('records every procedure path, type and input without deduplicating calls', async (): Promise<void> => {
        const errors: string[] = [];
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = fakeVsCodeApi(rpc, errors)();
        const path = 'localQuickStart.checkPort';
        api.postMessage({ id: 'first', op: { type: 'query', path, input: { port: 10260 } } });
        api.postMessage({ id: 'second', op: { type: 'query', path, input: { port: 10261 } } });
        await Promise.resolve();
        expect(window.__harnessCalls).toEqual([
            { path, type: 'query', input: { port: 10260 } },
            { path, type: 'query', input: { port: 10261 } },
        ]);
        expect(errors).toEqual([]);
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: 'first', result: 'available' }, { id: 'first', complete: true },
            { id: 'second', result: 'available' }, { id: 'second', complete: true },
        ]);
    });

    it('records escaping actions and answers only from fixtures without opening or copying anything', async (): Promise<void> => {
        const errors: string[] = [];
        const messages = vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const open = vi.spyOn(window, 'open').mockImplementation((): null => null);
        const writeText = vi.fn();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const api = fakeVsCodeApi(rpc, errors)();
        const calls = [
            { path: 'common.openUrl', type: 'mutation', input: { url: 'https://example.invalid/docker-desktop' } },
            { path: 'clusterDashboard.copyConnectionString', type: 'mutation', input: undefined },
            { path: 'localQuickStart.openConnection', type: 'mutation', input: undefined },
        ];
        for (const [index, op] of calls.entries()) {
            api.postMessage({ id: String(index), op });
        }
        await Promise.resolve();
        expect(window.__harnessCalls).toEqual(calls);
        expect(open).not.toHaveBeenCalled();
        expect(writeText).not.toHaveBeenCalled();
        expect(errors).toEqual([]);
        expect(messages.mock.calls.map((call): unknown => call[0])).toEqual([
            { id: '0', result: undefined }, { id: '0', complete: true },
            { id: '1', result: undefined }, { id: '1', complete: true },
            { id: '2', result: undefined }, { id: '2', complete: true },
        ]);
    });

    it('does not implicitly allow escaping actions missing from the fixture map', (): void => {
        const errors: string[] = [];
        vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const api = fakeVsCodeApi({}, errors)();
        expect((): void => api.postMessage({ id: 'escape', op: {
            type: 'mutation', path: 'common.openUrl', input: { url: 'https://example.invalid' },
        } })).toThrow('No mutation fixture for common.openUrl');
        expect(window.__harnessCalls).toEqual([{
            path: 'common.openUrl', type: 'mutation', input: { url: 'https://example.invalid' },
        }]);
        expect(errors).toEqual(['No mutation fixture for common.openUrl']);
    });

    it('starts a fresh call log and independent state for each harness installation', (): void => {
        vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        const acquire = fakeVsCodeApi(rpc, []);
        const api = acquire<{ active: boolean }>();
        api.postMessage({ id: 'first', op: { type: 'query', path: 'localQuickStart.checkPort' } });
        api.setState({ active: true });
        expect(api.getState()).toEqual({ active: true });
        expect((): unknown => acquire()).toThrow('acquireVsCodeApi called more than once');
        const next = fakeVsCodeApi(rpc, [])();
        expect(window.__harnessCalls).toEqual([]);
        expect(next.getState()).toBeUndefined();
        expect(api.getState()).toEqual({ active: true });
    });
});
