/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserReport } from './runtime';

interface BrowserRequest {
    url(): string;
    failure(): { errorText: string } | null;
}
interface BrowserResponse {
    url(): string;
    status(): number;
}
interface BrowserConsole {
    type(): string;
    text(): string;
}
interface BrowserLocator {
    click(): Promise<void>;
    fill(value: string): Promise<void>;
}

export interface IntegratedPage {
    on(event: 'console', listener: (message: BrowserConsole) => void): void;
    on(event: 'pageerror', listener: (error: Error) => void): void;
    on(event: 'requestfailed', listener: (request: BrowserRequest) => void): void;
    on(event: 'response', listener: (response: BrowserResponse) => void): void;
    off(event: 'console', listener: (message: BrowserConsole) => void): void;
    off(event: 'pageerror', listener: (error: Error) => void): void;
    off(event: 'requestfailed', listener: (request: BrowserRequest) => void): void;
    off(event: 'response', listener: (response: BrowserResponse) => void): void;
    goto(url: string, options: { waitUntil: 'networkidle' }): Promise<unknown>;
    getByRole(role: string, options: { name: string; exact?: boolean }): BrowserLocator;
    waitForFunction(predicate: () => boolean, argument: undefined, options: { timeout: number }): Promise<unknown>;
    evaluate<T>(operation: () => T | Promise<T>): Promise<T>;
    evaluate<T, A>(operation: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
}

export interface IntegratedReport extends BrowserReport {
    readonly responses: readonly { url: string; status: number }[];
    readonly expectedFailure: boolean;
    readonly verified: boolean;
}

// Kept self-contained so the generator can emit this function as an integrated-browser snippet.
export async function runIntegratedCheck(page: IntegratedPage, url: string, expectedFailure = false): Promise<IntegratedReport> {
    const errors: string[] = [];
    const responses: { url: string; status: number }[] = [];
    const onConsole = (message: BrowserConsole): void => {
        if (message.type() === 'error' ||
            (message.type() === 'warning' && /worker|preload|content.security|csp/i.test(message.text()))) {
            errors.push(`console.${message.type()}: ${message.text()}`);
        }
    };
    const onError = (error: Error): void => { errors.push(`pageerror: ${error.message}`); };
    const onRequestFailed = (request: BrowserRequest): void => {
        errors.push(`requestfailed: ${request.url()}: ${request.failure()?.errorText ?? '<unknown>'}`);
    };
    const onResponse = (response: BrowserResponse): void => {
        responses.push({ url: response.url(), status: response.status() });
        if (response.status() < 200 || response.status() >= 300) {
            errors.push(`response: ${response.status()} ${response.url()}`);
        }
    };
    page.on('console', onConsole);
    page.on('pageerror', onError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    try {
        try {
            await page.goto(url, { waitUntil: 'networkidle' });
            if (url.endsWith('/localQuickStart.html')) {
                await page.getByRole('button', { name: 'Continue', exact: true }).click();
            }
            if (url.endsWith('/atlasCredentials.html')) {
                await page.getByRole('textbox', { name: 'Public Key', exact: true }).fill('stage0-public-key');
                await page.getByRole('textbox', { name: 'Private Key', exact: true }).fill('stage0-private-key');
                await page.getByRole('button', { name: 'Verify & Save', exact: true }).click();
            }
            await page.waitForFunction((): boolean => window.stage0Harness?.ready() === true, undefined, { timeout: 30000 });
        } catch (error) {
            errors.push(`settling: ${error instanceof Error ? error.message : String(error)}`);
        }
        const browser = await page.evaluate(async (): Promise<BrowserReport> => {
            if (!window.stage0Harness) {
                throw new Error('Stage 0 runtime did not boot');
            }
            return window.stage0Harness.check();
        });
        const combined = [...new Set([...browser.errors, ...errors])];
        const cssFailed = combined.some((error): boolean => error.startsWith('Style '));
        const onlyCssErrors = combined.every((error): boolean => error.startsWith('Style ') || error.startsWith('Empty layout:'));
        const verified = expectedFailure ? browser.brokenCss && cssFailed && onlyCssErrors : combined.length === 0 && !browser.brokenCss;
        const report: IntegratedReport = { ...browser, errors: combined, responses, expectedFailure, verified };
        await page.evaluate(async (result: IntegratedReport): Promise<void> => {
            const target = new URL(`../reports/${result.view}${result.brokenCss ? '-broken-css' : ''}`, location.href);
            const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify(result) });
            if (!response.ok) {
                throw new Error(`Cannot persist L2 report: ${response.status}`);
            }
        }, report);
        if (!verified) {
            throw new Error(`L2 ${browser.view} ${expectedFailure ? 'negative control' : 'failed'}: ${combined.join('\n')}`);
        }
        return report;
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onError);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
    }
}
