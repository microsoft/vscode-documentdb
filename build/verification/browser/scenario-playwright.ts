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
    const onError = (error: Error): void => { errors.push(`pageerror: ${error.message}`); };
    const wait = async <A>(predicate: (argument: A) => boolean, argument: A, description: string): Promise<void> => {
        const deadline = Date.now() + 60000;
        while (!await page.evaluate(predicate, argument)) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${description}`);
            }
            await new Promise<void>((resolve): void => { setTimeout(resolve, 50); });
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
            await wait((): boolean => !!window.__scenario || document.documentElement.dataset.ready === 'failed', undefined, 'scenario boot');
            if (await page.evaluate((): boolean => document.documentElement.dataset.ready !== 'failed')) {
                const data: Scenario = await page.evaluate((): Scenario => window.__scenario.data);
                await steps(data.steps ?? []);
                await wait((): boolean => ['true', 'failed'].includes(document.documentElement.dataset.ready ?? ''), undefined, 'data-ready');
                if (await page.evaluate((): boolean => document.documentElement.dataset.ready === 'true')) {
                    for (const assertion of data.assertions ?? []) {
                        if (assertion.kind === 'calls') {
                            await steps(assertion.steps);
                            await wait((expected: { path: string; count: number }): boolean =>
                                document.documentElement.dataset.ready === 'failed' ||
                                window.__harnessCalls.filter((call): boolean => call.path === expected.path).length >= expected.count,
                            { path: assertion.path, count: assertion.count }, 'expected host call');
                            const actual = await page.evaluate((expected: typeof assertion): { count: number; matching: number } => {
                                const calls = window.__harnessCalls.filter((call): boolean => call.path === expected.path);
                                return { count: calls.length, matching: calls.filter((call): boolean =>
                                    JSON.stringify(call.input) === JSON.stringify(expected.input)).length };
                            }, assertion);
                            assertions.push({
                                name: assertion.name,
                                passed: actual.count === assertion.count && actual.matching === assertion.count,
                                actual, expected: { count: assertion.count, input: assertion.input },
                            });
                        } else {
                            const actual = await page.evaluate((expected: typeof assertion): string => {
                                const element = document.querySelector(expected.selector);
                                return element ? getComputedStyle(element).getPropertyValue(expected.property) : '<missing>';
                            }, assertion);
                            assertions.push({
                                name: `${assertion.selector} ${assertion.property}`, passed: actual === assertion.expected,
                                actual, expected: assertion.expected,
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
        const report = await page.evaluate((path: string): ScenarioReport => ({
            route: path, ready: document.documentElement.dataset.ready === 'true',
            errors: [...new Set(window.__harnessErrors ?? [])],
            assertions: [], calls: window.__harnessCalls ?? [],
        }), route.path);
        return { ...report, assertions };
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onError);
    }
}
