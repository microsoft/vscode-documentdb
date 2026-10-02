/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BrowserReport } from './runtime';

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
    click(options?: { timeout: number }): Promise<void>;
    fill(value: string, options?: { timeout: number }): Promise<void>;
    press(key: string, options?: { timeout: number }): Promise<void>;
    focus(options?: { timeout: number }): Promise<void>;
    first(): BrowserLocator;
    last(): BrowserLocator;
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
    bringToFront(): Promise<void>;
    goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
    getByRole(role: string, options: { name: string; exact?: boolean }): BrowserLocator;
    locator(selector: string): BrowserLocator;
    readonly keyboard: { insertText: (text: string) => Promise<void> };
    waitForFunction<A>(predicate: (argument: A) => boolean, argument: A, options: { timeout: number }): Promise<unknown>;
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
    let phase = 'activating the browser page';
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
            const monacoView = url.endsWith('/collectionView.html') || url.endsWith('/documentView.html') ||
                url.endsWith('/collectionView-broken-css.html');
            await page.bringToFront();
            await page.waitForFunction((): boolean => document.visibilityState === 'visible',
                undefined, { timeout: 60000 });
            phase = 'loading the production page';
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.bringToFront();
            await page.waitForFunction((): boolean => document.visibilityState === 'visible' &&
                window.stage0Harness !== undefined, undefined, { timeout: 60000 });
            phase = 'settling fixture content and editor geometry';
            if (url.endsWith('/localQuickStart.html')) {
                await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 60000 });
            }
            if (url.endsWith('/atlasCredentials.html')) {
                await page.getByRole('textbox', { name: 'Public Key', exact: true }).fill('stage0-public-key', { timeout: 60000 });
                await page.getByRole('textbox', { name: 'Private Key', exact: true }).fill('stage0-private-key', { timeout: 60000 });
                await page.getByRole('button', { name: 'Verify & Save', exact: true }).click({ timeout: 60000 });
            }
            await page.waitForFunction((options: { editor: boolean; cssNegative: boolean }): boolean => {
                if (document.visibilityState !== 'visible' || !window.stage0Harness.ready() || document.fonts.status !== 'loaded') {
                    return false;
                }
                if (!options.editor) {
                    return true;
                }
                const editor = document.querySelector('.monaco-editor');
                const lines = document.querySelector('.monaco-editor .view-lines');
                if (!editor || !lines) {
                    return false;
                }
                // Missing CSS is deliberate only in the negative control; normal editor
                // input must wait for real, nonzero layout rather than an offscreen mount.
                return options.cssNegative || [editor, lines].every((element): boolean => {
                    const box = element.getBoundingClientRect();
                    return box.width > 0 && box.height > 0;
                });
            }, { editor: monacoView, cssNegative: expectedFailure }, { timeout: 60000 });
            if (monacoView) {
                const documentView = url.endsWith('/documentView.html');
                const label = documentView ? 'Document Editor: Edit the document in JSON format' : 'Filter: Enter the DocumentDB query filter';
                const editor = page.getByRole('textbox', {
                    name: label,
                    exact: true,
                });
                const modifier = await page.evaluate((): 'Meta' | 'Control' => /mac/i.test(navigator.platform) ? 'Meta' : 'Control');
                phase = 'focusing the rendered editor';
                if (!expectedFailure) {
                    await page.locator('.monaco-editor').first().click({ timeout: 60000 });
                }
                await editor.focus({ timeout: 60000 });
                await page.waitForFunction((name: string): boolean => document.visibilityState === 'visible' &&
                    document.hasFocus() && document.activeElement?.getAttribute('aria-label') === name,
                label, { timeout: 60000 });
                phase = 'clearing the rendered editor before the probe';
                await editor.press(`${modifier}+A`, { timeout: 60000 });
                await editor.press('Backspace', { timeout: 60000 });
                await page.waitForFunction((): boolean =>
                    document.querySelector('.monaco-editor .view-lines')?.textContent?.trim() === '',
                undefined, { timeout: 60000 });
                phase = 'awaiting the editor-originated worker response';
                await page.evaluate((): void => window.stage0Harness.beginEditorProbe('stage0_worker_probe'));
                await page.keyboard.insertText('{ "stage0_worker_probe": "left\u200bright", "invalid": }');
                await page.waitForFunction((): boolean => window.stage0Harness.editorProbeReady(), undefined, { timeout: 60000 });
                phase = 'restoring settled fixture content';
                if (documentView) {
                    await page.getByRole('button', { name: 'Reload document from the database', exact: true }).click({ timeout: 60000 });
                } else {
                    await page.locator('.queryEditorActions button').last().click({ timeout: 60000 });
                }
                await page.waitForFunction((): boolean => window.stage0Harness.ready() &&
                    !document.querySelector('.monaco-editor .view-lines')?.textContent?.includes('stage0_worker_probe'),
                undefined, { timeout: 60000 });
            }
        } catch (error) {
            errors.push(`settling (${phase}): ${error instanceof Error ? error.message : String(error)}`);
        }
        const browser = await page.evaluate(async (): Promise<BrowserReport> => {
            if (!window.stage0Harness) {
                throw new Error('Stage 0 runtime did not boot');
            }
            return window.stage0Harness.check();
        });
        if (browser.view === 'collectionView' || browser.view === 'documentView') {
            const expectedMethod = browser.view === 'documentView' ? 'doValidation' : '$computeUnicodeHighlights';
            if (browser.worker?.source !== 'rendered-editor' || browser.worker.probeMarker !== 'stage0_worker_probe' ||
                browser.worker.roundTrip !== expectedMethod) {
                errors.push(`Rendered Monaco editor worker proof missing or mismatched for ${browser.view}`);
            }
        }
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
