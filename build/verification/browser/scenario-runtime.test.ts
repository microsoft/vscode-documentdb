/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installScenario, readinessHolds } from './scenario-runtime';
import { parseScenarioRoute } from './scenario-server';
import { scenarios, type Scenario } from './scenarios';

describe('L2-dev readiness', (): void => {
    afterEach((): void => {
        window.dispatchEvent(new Event('pagehide'));
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const data: Scenario = {
        ...scenarios.localQuickStart.introduction,
        readiness: { content: ['Visible fixture'], selectors: ['h2'], noProgressbar: true },
    };

    function boot(): void {
        vi.useFakeTimers();
        document.body.innerHTML = '<h2>Visible fixture</h2>';
        Object.defineProperty(document.body, 'innerText', { configurable: true, value: 'Visible fixture' });
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, width: 200, height: 40, top: 0, bottom: 40, left: 0, right: 200, toJSON: (): object => ({}),
        });
        window.__harnessErrors = [];
        const route = parseScenarioRoute('/localQuickStart/introduction/dark');
        if (!route) throw new Error('Missing test route');
        installScenario(route, data);
    }

    it('waits for visible content/selectors and ignores only hidden progressbars', (): void => {
        boot();
        expect(document.documentElement.dataset.ready).toBe('true');
        document.body.insertAdjacentHTML('beforeend', '<div role="progressbar"></div>');
        expect(readinessHolds(data)).toBe(false);
        document.querySelector('[role="progressbar"]')?.setAttribute('style', 'display:none');
        expect(readinessHolds(data)).toBe(true);
        document.querySelector('h2')?.setAttribute('style', 'display:none');
        expect(readinessHolds(data)).toBe(false);
    });

    it('fails an unknown procedure and records its path even after ready', (): void => {
        boot();
        const api = window.acquireVsCodeApi();
        vi.spyOn(window, 'postMessage').mockImplementation((): void => {});
        expect((): void => api.postMessage({ id: 'missing', op: { type: 'query', path: 'unknown.path' } }))
            .toThrow('No query fixture for unknown.path');
        vi.advanceTimersByTime(50);
        expect(document.documentElement.dataset.ready).toBe('failed');
        expect(window.__harnessErrors).toContain('No query fixture for unknown.path');
        expect(window.__harnessCalls[0].path).toBe('unknown.path');
    });

    it('never turns a late failure back into ready', (): void => {
        boot();
        window.__harnessErrors.push('console.error: late app failure');
        vi.advanceTimersByTime(100);
        expect(document.documentElement.dataset.ready).toBe('failed');
        window.__scenario.check();
        expect(document.documentElement.dataset.ready).toBe('failed');
    });
});
