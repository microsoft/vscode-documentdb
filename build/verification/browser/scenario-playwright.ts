/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type HarnessCall } from './core/fakeVsCodeApi';
import { type IntegratedPage } from './playwright';
import { type Scenario, type ScenarioRoute, type ScenarioStep } from './scenarios';

export interface ScenarioReport {
    readonly route: string;
    readonly ready: boolean;
    readonly errors: readonly string[];
    readonly assertions: readonly { name: string; passed: boolean; actual: unknown; expected: unknown }[];
    readonly calls: readonly HarnessCall[];
}

// Serialized by the serve-only plugin. All executable helpers must stay inside this function.
export async function runScenario(page: IntegratedPage, origin: string, route: ScenarioRoute): Promise<ScenarioReport> {
    const errors: string[] = [];
    const assertions: ScenarioReport['assertions'][number][] = [];
    const onConsole = (message: { type(): string; text(): string }): void => {
        if (message.type() === 'error' || message.type() === 'warning') {
            errors.push(`console.${message.type()}: ${message.text()}`);
        }
    };
    const onError = (error: Error): void => {
        errors.push(`pageerror: ${error.message}`);
    };
    const wait = async <A>(predicate: (argument: A) => boolean, argument: A, description: string): Promise<void> => {
        const deadline = Date.now() + 60000;
        while (!(await page.evaluate(predicate, argument))) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${description}`);
            }
            await new Promise<void>((resolve): void => {
                setTimeout(resolve, 50);
            });
        }
    };
    const steps = async (items: readonly ScenarioStep[]): Promise<void> => {
        for (const step of items) {
            if (await page.evaluate((): boolean => document.documentElement.dataset.ready === 'failed')) {
                throw new Error(`Page failed before step: ${step.name}`);
            }
            const locator = page.getByRole(step.role, { name: step.name, exact: true });
            if (step.action === 'click') {
                await locator.click({ timeout: 60000 });
            } else {
                await locator.fill(step.value, { timeout: 60000 });
            }
        }
    };
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 60000 });
    page.on('console', onConsole);
    page.on('pageerror', onError);
    try {
        try {
            await page.goto(`${origin}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.bringToFront();
            await wait(
                (): boolean => !!window.__scenario || document.documentElement.dataset.ready === 'failed',
                undefined,
                'scenario boot',
            );
            if (await page.evaluate((): boolean => document.documentElement.dataset.ready !== 'failed')) {
                const data: Scenario = await page.evaluate((): Scenario => window.__scenario.data);
                await steps(data.steps ?? []);
                await wait(
                    (): boolean => ['true', 'failed'].includes(document.documentElement.dataset.ready ?? ''),
                    undefined,
                    'data-ready',
                );
                if (await page.evaluate((): boolean => document.documentElement.dataset.ready === 'true')) {
                    for (const assertion of data.assertions ?? []) {
                        if (assertion.kind === 'calls') {
                            await steps(assertion.steps);
                            await wait(
                                (expected: { path: string; count: number }): boolean =>
                                    document.documentElement.dataset.ready === 'failed' ||
                                    window.__harnessCalls.filter((call): boolean => call.path === expected.path)
                                        .length >= expected.count,
                                { path: assertion.path, count: assertion.count },
                                'expected host call',
                            );
                            const actual = await page.evaluate(
                                (expected: typeof assertion): { count: number; matching: number } => {
                                    const calls = window.__harnessCalls.filter(
                                        (call): boolean => call.path === expected.path,
                                    );
                                    return {
                                        count: calls.length,
                                        matching: calls.filter(
                                            (call): boolean =>
                                                JSON.stringify(call.input) === JSON.stringify(expected.input),
                                        ).length,
                                    };
                                },
                                assertion,
                            );
                            assertions.push({
                                name: assertion.name,
                                passed: actual.count === assertion.count && actual.matching === assertion.count,
                                actual,
                                expected: { count: assertion.count, input: assertion.input },
                            });
                        } else if (assertion.kind === 'order') {
                            const actual = await page.evaluate(
                                (selector: string): string[] =>
                                    [...document.querySelectorAll(selector)].map((element): string =>
                                        (element instanceof HTMLElement
                                            ? element.innerText
                                            : (element.textContent ?? '')
                                        )
                                            .replace(/\s+/g, ' ')
                                            .trim(),
                                    ),
                                assertion.selector,
                            );
                            assertions.push({
                                name: assertion.name,
                                passed:
                                    actual.length === assertion.texts.length &&
                                    assertion.texts.every((text, index): boolean => actual[index].includes(text)),
                                actual,
                                expected: assertion.texts,
                            });
                        } else if (assertion.kind === 'below') {
                            const actual = await page.evaluate(
                                (expected: {
                                    above: string;
                                    below: string;
                                }): { follows: boolean; gap: number } | null => {
                                    const above = document.querySelector(expected.above);
                                    const below = document.querySelector(expected.below);
                                    if (!above || !below) {
                                        return null;
                                    }
                                    return {
                                        follows:
                                            (above.compareDocumentPosition(below) &
                                                Node.DOCUMENT_POSITION_FOLLOWING) !==
                                            0,
                                        gap: below.getBoundingClientRect().top - above.getBoundingClientRect().bottom,
                                    };
                                },
                                { above: assertion.above, below: assertion.below },
                            );
                            assertions.push({
                                name: assertion.name,
                                passed: actual !== null && actual.follows && actual.gap >= 0,
                                actual,
                                expected: { follows: true, gap: '>= 0' },
                            });
                        } else if (assertion.kind === 'text') {
                            const text = await page.evaluate((selector: string): string | null => {
                                const element = document.querySelector(selector);
                                if (!element) {
                                    return null;
                                }
                                return (
                                    element instanceof HTMLElement ? element.innerText : (element.textContent ?? '')
                                )
                                    .replace(/\s+/g, ' ')
                                    .trim();
                            }, assertion.selector);
                            const missing =
                                text === null
                                    ? [...assertion.includes]
                                    : assertion.includes.filter((expected): boolean => !text.includes(expected));
                            const found =
                                text === null
                                    ? []
                                    : assertion.excludes.filter((pattern): boolean =>
                                          new RegExp(pattern, 'i').test(text),
                                      );
                            assertions.push({
                                name: assertion.name,
                                passed: text !== null && missing.length === 0 && found.length === 0,
                                actual: { text, missing, found },
                                expected: { includes: assertion.includes, excludes: assertion.excludes },
                            });
                        } else if (assertion.kind === 'rowHeights') {
                            const actual = await page.evaluate(
                                (expected: {
                                    list: string;
                                    selector: string;
                                }): {
                                    width: number;
                                    listTop: number | null;
                                    heights: number[];
                                } => {
                                    const list = document.querySelector(expected.list);
                                    return {
                                        width: window.innerWidth,
                                        listTop: list ? list.getBoundingClientRect().top + window.scrollY : null,
                                        heights: [...document.querySelectorAll(expected.selector)].map(
                                            (element): number => element.getBoundingClientRect().height,
                                        ),
                                    };
                                },
                                { list: assertion.list, selector: assertion.selector },
                            );
                            const spread = actual.heights.length
                                ? Math.max(...actual.heights) - Math.min(...actual.heights)
                                : 0;
                            assertions.push({
                                name: assertion.name,
                                passed:
                                    actual.heights.length === assertion.count &&
                                    actual.heights.every((height): boolean => height > 0) &&
                                    spread <= assertion.tolerance,
                                actual: { ...actual, spread },
                                expected: { count: assertion.count, spread: `<= ${assertion.tolerance}` },
                            });
                        } else if (assertion.kind === 'inside') {
                            const actual = await page.evaluate(
                                (expected: {
                                    container: string;
                                    inner: string;
                                    under: string | null;
                                }): {
                                    top: number;
                                    bottom: number;
                                    floor: number | null;
                                    inner: { top: number; centre: number }[];
                                }[] =>
                                    [...document.querySelectorAll(expected.container)].map((container) => {
                                        const box = container.getBoundingClientRect();
                                        const under =
                                            expected.under === null ? null : container.querySelector(expected.under);
                                        return {
                                            top: box.top,
                                            bottom: box.bottom,
                                            // Null without `under`; NaN when `under` matches nothing, which fails.
                                            floor:
                                                expected.under === null
                                                    ? null
                                                    : (under?.getBoundingClientRect().bottom ?? Number.NaN),
                                            inner: [...container.querySelectorAll(expected.inner)].map((element) => {
                                                const inner = element.getBoundingClientRect();
                                                return { top: inner.top, centre: inner.top + inner.height / 2 };
                                            }),
                                        };
                                    }),
                                {
                                    container: assertion.container,
                                    inner: assertion.inner,
                                    under: assertion.under ?? null,
                                },
                            );
                            const count = actual.reduce((total, row): number => total + row.inner.length, 0);
                            assertions.push({
                                name: assertion.name,
                                passed:
                                    count >= assertion.minimum &&
                                    actual.every((row): boolean =>
                                        row.inner.every(
                                            (inner): boolean =>
                                                inner.centre >= row.top &&
                                                inner.centre <= row.bottom &&
                                                // Half a pixel for sub-pixel layout.
                                                (row.floor === null || inner.top >= row.floor - 0.5),
                                        ),
                                    ),
                                actual: { count, rows: actual },
                                expected: {
                                    minimum: assertion.minimum,
                                    centre: 'within its own container',
                                    ...(assertion.under === undefined
                                        ? {}
                                        : { top: `>= bottom of ${assertion.under}` }),
                                },
                            });
                        } else if (assertion.kind === 'attribute') {
                            await steps(assertion.steps ?? []);
                            const actual = await page.evaluate(
                                (expected: { selector: string; attribute: string }): string | null =>
                                    document.querySelector(expected.selector)?.getAttribute(expected.attribute) ?? null,
                                { selector: assertion.selector, attribute: assertion.attribute },
                            );
                            assertions.push({
                                name: assertion.name,
                                passed: actual === assertion.expected,
                                actual,
                                expected: assertion.expected,
                            });
                        } else if (assertion.kind === 'stableText') {
                            const read = (): Promise<string | null> =>
                                page.evaluate((selector: string): string | null => {
                                    const element = document.querySelector(selector);
                                    if (!element) {
                                        return null;
                                    }
                                    return (
                                        element instanceof HTMLElement ? element.innerText : (element.textContent ?? '')
                                    )
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                }, assertion.selector);
                            const before = await read();
                            await steps(assertion.steps);
                            const after = await read();
                            assertions.push({
                                name: assertion.name,
                                passed: before !== null && before === after,
                                actual: { before, after },
                                expected: 'the same text after the steps',
                            });
                        } else if (assertion.kind === 'sequence') {
                            const times = await page.evaluate(
                                (name: string): (number | null)[] => window.__scenarioTimeline?.[name] ?? [],
                                assertion.name,
                            );
                            const first = times[0] ?? 0;
                            const offsets = times.map((time): number | null =>
                                time === null ? null : Math.round(time - first),
                            );
                            const gaps = offsets
                                .slice(1)
                                .map((offset, index): number | null =>
                                    offset === null || offsets[index] === null ? null : offset - (offsets[index] ?? 0),
                                );
                            const span = offsets[offsets.length - 1] ?? null;
                            assertions.push({
                                name: assertion.name,
                                passed:
                                    offsets.length === assertion.milestones.length &&
                                    gaps.every((gap): boolean => gap !== null && gap >= assertion.minimumGapMs) &&
                                    span !== null &&
                                    span >= assertion.minimumSpanMs,
                                actual: { offsets, gaps, span },
                                expected: {
                                    minimumGapMs: assertion.minimumGapMs,
                                    minimumSpanMs: assertion.minimumSpanMs,
                                },
                            });
                        } else if (assertion.kind === 'top') {
                            const actual = await page.evaluate((selector: string): number | null => {
                                const element = document.querySelector(selector);
                                return element ? element.getBoundingClientRect().top + window.scrollY : null;
                            }, assertion.selector);
                            assertions.push({
                                name: assertion.name,
                                passed: actual !== null && Math.round(actual) === assertion.top,
                                actual,
                                expected: assertion.top,
                            });
                        } else {
                            const actual = await page.evaluate((expected: typeof assertion): string => {
                                const element = document.querySelector(expected.selector);
                                return element
                                    ? getComputedStyle(element).getPropertyValue(expected.property)
                                    : '<missing>';
                            }, assertion);
                            assertions.push({
                                name: `${assertion.selector} ${assertion.property}`,
                                passed: actual === assertion.expected,
                                actual,
                                expected: assertion.expected,
                            });
                        }
                    }
                }
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
        // Transfer browser-only diagnostics (including import errors) into the page failure signal.
        await page.evaluate((observed: string[]): void => {
            window.__harnessErrors ??= [];
            for (const error of observed) {
                if (!window.__harnessErrors.includes(error)) window.__harnessErrors.push(error);
            }
            window.__scenario?.check();
            if (window.__harnessErrors.length) document.documentElement.dataset.ready = 'failed';
        }, errors);
        const report = await page.evaluate(
            (path: string): ScenarioReport => ({
                route: path,
                ready: document.documentElement.dataset.ready === 'true',
                errors: [...new Set(window.__harnessErrors ?? [])],
                assertions: [],
                calls: window.__harnessCalls ?? [],
            }),
            route.path,
        );
        return { ...report, assertions };
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onError);
    }
}
