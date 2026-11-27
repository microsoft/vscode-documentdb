/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type IntegratedPage } from './playwright';
import { runScenario } from './scenario-playwright';
import { installScenario, readinessHolds } from './scenario-runtime';
import { parseScenarioRoute, scenarioRunner } from './scenario-server';
import { scenarios, type Scenario, type ScenarioAssertion } from './scenarios';

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

    function boot(assertions?: readonly ScenarioAssertion[]): void {
        vi.useFakeTimers();
        document.body.innerHTML = '<h2>Visible fixture</h2>';
        Object.defineProperty(document.body, 'innerText', { configurable: true, value: 'Visible fixture' });
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            width: 200,
            height: 40,
            top: 0,
            bottom: 40,
            left: 0,
            right: 200,
            toJSON: (): object => ({}),
        });
        window.__harnessErrors = [];
        const route = parseScenarioRoute('/localQuickStart/introduction/dark');
        if (!route) throw new Error('Missing test route');
        installScenario(route, assertions ? { ...data, assertions } : data);
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
        expect((): void => api.postMessage({ id: 'missing', op: { type: 'query', path: 'unknown.path' } })).toThrow(
            'No query fixture for unknown.path',
        );
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

    it('records when each sequence milestone first matches, from page load', (): void => {
        boot([
            {
                kind: 'sequence',
                name: 'paced',
                milestones: ['h2', '#first', '#second'],
                minimumGapMs: 100,
                minimumSpanMs: 200,
            },
        ]);
        const loadedAt = performance.now();
        expect(window.__scenarioTimeline.paced).toEqual([loadedAt, null, null]);
        vi.advanceTimersByTime(300);
        document.body.insertAdjacentHTML('beforeend', '<p id="first"></p>');
        vi.advanceTimersByTime(50);
        vi.advanceTimersByTime(250);
        document.body.insertAdjacentHTML('beforeend', '<p id="second"></p>');
        vi.advanceTimersByTime(50);
        // A milestone keeps its first time even if it later stops matching.
        document.getElementById('first')?.remove();
        vi.advanceTimersByTime(100);
        expect(window.__scenarioTimeline.paced).toEqual([loadedAt, loadedAt + 350, loadedAt + 650]);
    });
});

describe('L2-dev layout assertions', (): void => {
    afterEach((): void => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    const rows: Extract<ScenarioAssertion, { kind: 'rowHeights' }> = {
        kind: 'rowHeights',
        name: 'rows',
        list: '#list',
        selector: '#list [role="listitem"]',
        count: 3,
        tolerance: 1,
    };
    const top: Extract<ScenarioAssertion, { kind: 'top' }> = { kind: 'top', name: 'top', selector: '#list', top: 100 };

    /**
     * Renders a list starting at `listTop` with one row per height, or `html` when given, then runs
     * `assertions` against it. An element's `data-top` overrides `listTop` for that element.
     */
    async function measure(
        heights: readonly number[],
        listTop: number,
        assertions: readonly ScenarioAssertion[],
        html?: string,
        expectedErrors: readonly string[] = [],
    ): Promise<Awaited<ReturnType<typeof runScenario>>['assertions']> {
        document.body.innerHTML =
            html ??
            `<div id="list">${heights
                .map((height): string => `<div role="listitem" data-height="${height}"></div>`)
                .join('')}</div>`;
        // jsdom omits innerText; these disposable fixture getters track text mutations.
        for (const element of document.body.querySelectorAll('*')) {
            if (element instanceof HTMLElement) {
                Object.defineProperty(element, 'innerText', {
                    configurable: true,
                    get: (): string => element.textContent ?? '',
                });
            }
        }
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
            const data = (this as HTMLElement).dataset;
            const height = this.id === 'list' ? 120 : Number(data.height);
            const elementTop = data.top === undefined ? listTop : Number(data.top);
            return {
                x: 0,
                y: elementTop,
                width: 200,
                height,
                top: elementTop,
                bottom: elementTop + height,
                left: 0,
                right: 200,
                toJSON: (): object => ({}),
            };
        });
        const route = parseScenarioRoute('/connectionDiagnostics/default/dark');
        if (!route) throw new Error('Missing test route');
        window.__harnessErrors = [];
        window.__harnessCalls = [];
        window.__scenario = {
            route,
            data: { ...scenarios.connectionDiagnostics.default, steps: [], assertions },
            check: (): void => {},
        };
        document.documentElement.dataset.ready = 'true';
        interface Locator {
            click(): Promise<void>;
            dblclick(): Promise<void>;
            evaluateAll<T>(operation: (elements: Element[]) => T): Promise<T>;
            fill(value: string): Promise<void>;
            press(key: string): Promise<void>;
            focus(): Promise<void>;
            first(): Locator;
            last(): Locator;
        }
        const locator: Locator = {
            click: vi.fn(async (): Promise<void> => {}),
            dblclick: vi.fn(async (): Promise<void> => {}),
            evaluateAll: async <T>(operation: (elements: Element[]) => T): Promise<T> => operation([]),
            fill: vi.fn(async (): Promise<void> => {}),
            press: vi.fn(async (): Promise<void> => {}),
            focus: vi.fn(async (): Promise<void> => {}),
            first: (): Locator => locator,
            last: (): Locator => locator,
        };
        const page: IntegratedPage = {
            on: vi.fn(),
            off: vi.fn(),
            bringToFront: vi.fn(async (): Promise<void> => {}),
            goto: vi.fn(async (): Promise<void> => {}),
            keyboard: {
                insertText: vi.fn(async (): Promise<void> => {}),
                press: vi.fn(async (): Promise<void> => {}),
            },
            getByRole: vi.fn((): Locator => locator),
            locator: vi.fn((selector: string): Locator => ({
                ...locator,
                evaluateAll: async <T>(operation: (elements: Element[]) => T): Promise<T> =>
                    operation([...document.querySelectorAll(selector)]),
            })),
            // jsdom is the page: run each serialized operation in place.
            evaluate: vi
                .fn()
                .mockImplementation(
                    async (operation: (argument: unknown) => unknown, argument?: unknown): Promise<unknown> =>
                        operation(argument),
                ),
        };
        const report = await runScenario(page, 'http://localhost:18080', route);
        expect(report.errors).toEqual(expectedErrors);
        return report.assertions;
    }

    it.each([
        '',
        '<div inert><div id="list" role="grid"></div></div>',
        '<div aria-hidden="true"><div id="list" role="grid"></div></div>',
        '<div style="display:none"><div id="list" role="grid"></div></div>',
    ])('reports a missing accessible grid without executing that contract or skipping its sibling (%s)', async (grid): Promise<void> => {
        const results = await measure([], 100, [
            {
                kind: 'attribute', name: 'TDD: K2 cannot pass with a missing grid', requiresGrid: 'grid',
                selector: '[role="row"][aria-selected="true"]', attribute: 'role', expected: null,
                steps: [{ action: 'releaseReply', tag: 'must-not-run' }],
            },
            { kind: 'text', name: 'supporting shell', selector: 'h2', includes: ['Shell'], excludes: [] },
        ], `${grid}<h2>Shell</h2>`);
        expect(results).toEqual([
            {
                name: 'TDD: K2 cannot pass with a missing grid', passed: false,
                actual: 'Absent accessible grid (hidden/inert placeholders do not qualify)', expected: 'grid',
            },
            {
                name: 'supporting shell', passed: true,
                actual: { text: 'Shell', missing: [], found: [] }, expected: { includes: ['Shell'], excludes: [] },
            },
        ]);
        expect(document.documentElement.dataset.ready).toBe('true');
    });

    it('executes optional text steps after an accessible treegrid exists', async (): Promise<void> => {
        const release = vi.fn((tag: string): boolean => {
            expect(tag).toBe('tree-result');
            const value = document.getElementById('value');
            if (!value) throw new Error('Missing release result target');
            value.textContent = 'Released result';
            return true;
        });
        window.__releaseScenarioReply = release;
        const [result] = await measure([], 100, [{
            kind: 'text', name: 'TDD: M4 released text', requiresGrid: 'treegrid',
            selector: '#value', includes: ['Released result'], excludes: ['Pending'],
            steps: [{ action: 'releaseReply', tag: 'tree-result' }],
        }], '<div id="list" role="treegrid"><span id="value">Pending</span></div>');
        expect(result.passed).toBe(true);
        expect(release).toHaveBeenCalledOnce();
    });

    it.each([false, true])('synchronizes text only when opted in (%s), without repeating its steps', async (waitForText): Promise<void> => {
        vi.useFakeTimers();
        const release = vi.fn((): boolean => {
            const value = document.getElementById('value');
            if (!value) throw new Error('Missing text result target');
            setTimeout((): void => { value.textContent = 'leaf Alpha nested Alpha'; }, 100);
            setTimeout((): void => { value.textContent = 'leaf \n Alpha'; }, 200);
            return true;
        });
        window.__releaseScenarioReply = release;
        const run = measure([], 100, [{
            kind: 'text', name: 'step-in result', selector: '#value',
            includes: ['leaf Alpha'], excludes: ['NESTED Alpha'],
            ...(waitForText ? { waitForText: true } : {}),
            steps: [{ action: 'releaseReply', tag: 'step-in' }],
        }], '<span id="value">nested Alpha</span>');
        await vi.advanceTimersByTimeAsync(250);
        expect((await run)[0]).toEqual({
            name: 'step-in result',
            passed: waitForText,
            actual: waitForText
                ? { text: 'leaf Alpha', missing: [], found: [] }
                : { text: 'nested Alpha', missing: ['leaf Alpha'], found: ['NESTED Alpha'] },
            expected: { includes: ['leaf Alpha'], excludes: ['NESTED Alpha'] },
        });
        expect(release).toHaveBeenCalledOnce();
    });

    it.each([false, true])('keeps a synchronized text assertion failing on timeout or page failure (%s)', async (pageFails): Promise<void> => {
        vi.useFakeTimers();
        const release = vi.fn((): boolean => {
            if (pageFails) {
                setTimeout((): void => {
                    const value = document.getElementById('value');
                    if (!value) throw new Error('Missing text result target');
                    value.textContent = 'leaf Alpha';
                    document.documentElement.dataset.ready = 'failed';
                }, 100);
            }
            return true;
        });
        window.__releaseScenarioReply = release;
        const run = measure([], 100, [{
            kind: 'text', name: 'step-in result', selector: '#value',
            includes: ['leaf Alpha'], excludes: ['nested Alpha'], waitForText: true,
            steps: [{ action: 'releaseReply', tag: 'step-in' }],
        }], '<span id="value">nested Alpha</span>', [
            pageFails ? 'Page failed while waiting for step-in result' : 'Timed out waiting for step-in result',
        ]);
        await vi.advanceTimersByTimeAsync(3100);
        expect((await run)[0]).toEqual({
            name: 'step-in result',
            passed: false,
            actual: pageFails
                ? { text: 'leaf Alpha', missing: [], found: [] }
                : { text: 'nested Alpha', missing: ['leaf Alpha'], found: ['nested Alpha'] },
            expected: { includes: ['leaf Alpha'], excludes: ['nested Alpha'] },
        });
        expect(release).toHaveBeenCalledOnce();
        expect(document.documentElement.dataset.ready).toBe('failed');
    });

    it('reports an unavailable contract target as an assertion result, not a harness failure', async (): Promise<void> => {
        const [result] = await measure([], 100, [{
            kind: 'focused', name: 'TDD: M6 missing cell', requiresGrid: 'grid',
            target: { role: 'gridcell', name: 'Unavailable document' },
            steps: [{ action: 'focus', role: 'gridcell', name: 'Unavailable document' }],
        }], '<div id="list" role="grid"></div>');
        expect(result).toMatchObject({
            passed: false, actual: 'Unavailable accessible gridcell: Unavailable document',
        });
        expect(document.documentElement.dataset.ready).toBe('true');
    });

    it('checks a DOM bound without claiming a timing or screen-reader measurement', async (): Promise<void> => {
        const assertion: ScenarioAssertion = {
            kind: 'countAtMost', name: 'TDD: K11 mounted rows', requiresGrid: 'grid',
            selector: '[role="row"]', max: 2,
        };
        const html = '<div id="list" role="grid"><div role="row"></div><div role="row"></div></div>';
        expect((await measure([], 100, [assertion], html))[0]).toMatchObject({ passed: true, actual: 2, expected: '<= 2' });
        expect((await measure([], 100, [{ ...assertion, max: 1 }], html))[0]).toMatchObject({ passed: false, actual: 2 });
    });

    it('compares an attribute after its steps, and treats a missing element as null', async (): Promise<void> => {
        const attribute = (
            selector: string,
            name: string,
            expected: string | null,
        ): Extract<ScenarioAssertion, { kind: 'attribute' }> => ({
            kind: 'attribute',
            name: `${selector} ${name}`,
            selector,
            attribute: name,
            expected,
            steps: [{ action: 'click', role: 'button', name: 'Details for List' }],
        });
        const results = await measure([37], 100, [
            attribute('#list', 'id', 'list'),
            attribute('#missing', 'aria-expanded', null),
            attribute('#list', 'aria-expanded', 'true'),
        ]);
        expect(results.map((result): boolean => result.passed)).toEqual([true, true, false]);
        expect(results[2].actual).toBeNull();
    });

    it('fails an inside check with fewer inner controls than its minimum', async (): Promise<void> => {
        const inside = (minimum: number): Extract<ScenarioAssertion, { kind: 'inside' }> => ({
            kind: 'inside',
            name: 'inside',
            container: '#list [role="listitem"]',
            inner: '[data-inner]',
            minimum,
        });
        // These rows hold no inner control; the real geometry is covered by the L2-dev runs.
        expect((await measure([37, 37], 100, [inside(0)]))[0].passed).toBe(true);
        const [missing] = await measure([37, 37], 100, [inside(1)]);
        expect(missing.passed).toBe(false);
        expect(missing.actual).toMatchObject({ count: 0 });
    });

    it('checks with `under` that a control sits below its row title, inside its own row', async (): Promise<void> => {
        const row = (buttonTop: number): string =>
            `<div role="listitem" data-top="100" data-height="40"><span data-top="100" data-height="18"></span>` +
            `<div data-top="100" data-height="40"><span data-top="100" data-height="20">Title</span>` +
            `<span data-top="121" data-height="16"><button data-inner data-top="${buttonTop}" data-height="16"></button></span>` +
            `</div></div>`;
        const inside: Extract<ScenarioAssertion, { kind: 'inside' }> = {
            kind: 'inside',
            name: 'under',
            container: '#list [role="listitem"]',
            inner: '[data-inner]',
            minimum: 1,
            under: ':scope > div > :first-child',
        };
        // On the evidence line (121) under the title (bottom 120).
        expect((await measure([], 0, [inside], `<div id="list">${row(121)}</div>`))[0].passed).toBe(true);
        // On the title line: still inside the row, but not under the title.
        const [onTitle] = await measure([], 0, [inside], `<div id="list">${row(102)}</div>`);
        expect(onTitle.passed).toBe(false);
        expect(onTitle.actual).toMatchObject({ rows: [{ floor: 120, inner: [{ top: 102 }] }] });
        // Without `under`, the same title-line control passes.
        expect(
            (await measure([], 0, [{ ...inside, under: undefined }], `<div id="list">${row(102)}</div>`))[0].passed,
        ).toBe(true);
        // A title selector that matches nothing fails rather than passing silently.
        expect(
            (await measure([], 0, [{ ...inside, under: ':scope > nav' }], `<div id="list">${row(121)}</div>`))[0]
                .passed,
        ).toBe(false);
    });

    it('passes milestones in order with enough time between them, and fails any other timeline', async (): Promise<void> => {
        const sequence: Extract<ScenarioAssertion, { kind: 'sequence' }> = {
            kind: 'sequence',
            name: 'paced',
            milestones: ['#a', '#b', '#c'],
            minimumGapMs: 150,
            minimumSpanMs: 400,
        };
        const run = async (times: (number | null)[]): Promise<Awaited<ReturnType<typeof measure>>[number]> => {
            window.__scenarioTimeline = { paced: times };
            return (await measure([37], 100, [sequence]))[0];
        };
        const passed = await run([1_000.4, 1_200, 1_450]);
        expect(passed.passed).toBe(true);
        expect(passed.actual).toEqual({ offsets: [0, 200, 450], gaps: [200, 250], span: 450 });
        // Too close together, out of order, too short overall, missing, or never recorded.
        expect((await run([0, 100, 450])).passed).toBe(false);
        expect((await run([0, 300, 200])).passed).toBe(false);
        expect((await run([0, 160, 320])).passed).toBe(false);
        expect((await run([0, 200, null])).passed).toBe(false);
        expect((await run([null, 200, 450])).passed).toBe(false);
        window.__scenarioTimeline = {};
        expect((await measure([37], 100, [sequence]))[0].passed).toBe(false);
    });

    it('passes rows of one height within the tolerance and records the width and list top', async (): Promise<void> => {
        const [result] = await measure([37, 37.6, 38], 100, [rows]);
        expect(result.passed).toBe(true);
        expect(result.actual).toEqual({ width: window.innerWidth, listTop: 100, heights: [37, 37.6, 38], spread: 1 });
    });

    it('fails a row that grew by more than the tolerance, such as a wrapped detail line', async (): Promise<void> => {
        const [result] = await measure([37, 53, 37], 100, [rows]);
        expect(result.passed).toBe(false);
        expect(result.actual).toMatchObject({ heights: [37, 53, 37], spread: 16 });
    });

    it('fails a missing or extra row, and a row with no height', async (): Promise<void> => {
        expect((await measure([37, 37], 100, [rows]))[0].passed).toBe(false);
        expect((await measure([37, 37, 37, 37], 100, [rows]))[0].passed).toBe(false);
        expect((await measure([0, 0, 0], 100, [rows]))[0].passed).toBe(false);
    });

    it('passes the list at the expected top, rounding sub-pixel offsets', async (): Promise<void> => {
        expect(await measure([37, 37, 37], 100.4, [top])).toEqual([
            { name: 'top', passed: true, actual: 100.4, expected: 100 },
        ]);
    });

    it('fails a list that moved, and a missing list', async (): Promise<void> => {
        expect((await measure([37, 37, 37], 137, [top]))[0]).toMatchObject({ passed: false, actual: 137 });
        expect((await measure([37, 37, 37], 100, [{ ...top, selector: '#missing' }]))[0]).toMatchObject({
            passed: false,
            actual: null,
        });
    });

    it('drives keyboard, double-click and focus steps and checks exact focus targets', async (): Promise<void> => {
        document.body.innerHTML =
            '<button id="already">Already focused</button>' +
            '<div id="record" role="gridcell" data-name="Open record"></div>' +
            '<input id="filter" role="textbox" data-name="Filter">';
        const already = document.getElementById('already');
        const filter = document.getElementById('filter');
        already?.focus();
        const route = parseScenarioRoute('/connectionDiagnostics/default/dark');
        if (!route) throw new Error('Missing test route');
        window.__harnessErrors = [];
        window.__harnessCalls = [];
        window.__scenario = {
            route,
            data: {
                ...scenarios.connectionDiagnostics.default,
                steps: [
                    { action: 'press', key: 'Control+Enter' },
                    { action: 'dblclick', role: 'gridcell', name: 'Open record' },
                ],
                assertions: [
                    {
                        kind: 'focused',
                        name: 'role target',
                        target: { role: 'textbox', name: 'Filter' },
                        steps: [{ action: 'focus', role: 'textbox', name: 'Filter' }],
                    },
                    { kind: 'focused', name: 'missing role target', target: { role: 'row', name: 'Missing' } },
                    { kind: 'focused', name: 'selector target', target: { selector: '#filter' } },
                    { kind: 'focused', name: 'missing selector target', target: { selector: '#missing' } },
                ],
            },
            check: (): void => {},
        };
        document.documentElement.dataset.ready = 'true';

        interface Locator {
            click(): Promise<void>;
            dblclick(): Promise<void>;
            evaluateAll<T>(operation: (elements: Element[]) => T): Promise<T>;
            fill(value: string): Promise<void>;
            press(key: string): Promise<void>;
            focus(): Promise<void>;
            first(): Locator;
            last(): Locator;
        }
        const dblclick = vi.fn(async (): Promise<void> => {});
        const focus = vi.fn(async (onFocus?: () => void): Promise<void> => onFocus?.());
        const makeLocator = (elements: Element[], onFocus?: () => void): Locator => ({
            click: vi.fn(async (): Promise<void> => {}),
            dblclick,
            evaluateAll: async <T>(operation: (matched: Element[]) => T): Promise<T> => operation(elements),
            fill: vi.fn(async (): Promise<void> => {}),
            press: vi.fn(async (): Promise<void> => {}),
            focus: async (): Promise<void> => focus(onFocus),
            first: (): Locator => locatorFor(elements),
            last: (): Locator => locatorFor(elements),
        });
        const locatorFor = (elements: Element[]): Locator => makeLocator(elements);
        const getByRole = vi.fn((role: string, options: { name: string; exact?: boolean }): Locator => {
            const elements = [...document.querySelectorAll(`[role="${role}"][data-name="${options.name}"]`)];
            return makeLocator(elements, (): void => {
                if (elements[0] instanceof HTMLElement) elements[0].focus();
            });
        });
        const press = vi.fn(async (): Promise<void> => {
            expect(document.activeElement).toBe(already);
        });
        const page: IntegratedPage = {
            on: vi.fn(),
            off: vi.fn(),
            bringToFront: vi.fn(async (): Promise<void> => {}),
            goto: vi.fn(async (): Promise<void> => {}),
            keyboard: {
                insertText: vi.fn(async (): Promise<void> => {}),
                press,
            },
            getByRole,
            locator: vi.fn((selector: string): Locator => locatorFor([...document.querySelectorAll(selector)])),
            evaluate: vi
                .fn()
                .mockImplementation(
                    async (operation: (argument: unknown) => unknown, argument?: unknown): Promise<unknown> =>
                        operation(argument),
                ),
        };

        const report = await runScenario(page, 'http://localhost:18080', route);

        expect(report.errors).toEqual([]);
        expect(report.ready).toBe(true);
        expect(report.assertions.map((result): boolean => result.passed)).toEqual([true, false, true, false]);
        expect(press).toHaveBeenCalledWith('Control+Enter');
        expect(dblclick).toHaveBeenCalledTimes(1);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(getByRole).toHaveBeenCalledWith('gridcell', { name: 'Open record', exact: true });
        expect(getByRole).toHaveBeenCalledWith('textbox', { name: 'Filter', exact: true });
        expect(document.activeElement).toBe(filter);

        const snippet = scenarioRunner([route]);
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        expect((): void => {
            new AsyncFunction('page', snippet);
        }).not.toThrow();
        expect(snippet).toContain('page.keyboard.press');
    });
});
