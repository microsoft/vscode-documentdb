/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect, vi } from 'vitest';

import { type BrowserReport } from './runtime';
import { runIntegratedCheck, type IntegratedPage } from './playwright';

interface LocatorFixture {
    click(): Promise<void>;
    fill(value: string): Promise<void>;
    press(key: string): Promise<void>;
    focus(): Promise<void>;
    first(): LocatorFixture;
    last(): LocatorFixture;
}

function fixturePage(report: BrowserReport): IntegratedPage {
    const locator: LocatorFixture = {
        click: vi.fn(async (): Promise<void> => {}), fill: vi.fn(async (): Promise<void> => {}),
        press: vi.fn(async (): Promise<void> => {}),
        focus: vi.fn(async (): Promise<void> => {}),
        first: (): LocatorFixture => locator,
        last: (): LocatorFixture => locator,
    };
    return {
        on: vi.fn(), off: vi.fn(), bringToFront: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
        keyboard: { insertText: vi.fn(async (): Promise<void> => {}) },
        getByRole: vi.fn((): LocatorFixture => locator),
        locator: vi.fn((): LocatorFixture => locator),
        evaluate: vi.fn().mockImplementation(async (operation: () => unknown): Promise<unknown> => {
            return operation.toString().includes('navigator.platform') ? 'Control' :
                operation.toString().includes('beginEditorProbe') ? undefined :
                operation.toString().includes('stage0Harness.check') ? report : undefined;
        }),
    };
}

const good: BrowserReport = {
    view: 'collectionView', errors: [], rpcPaths: ['mongoClusters.collectionView.runFindQuery'],
    styles: [], chunks: ['http://localhost/stage0/l2/artifact/views.js'],
    worker: { source: 'rendered-editor', workerUrl: '/stage0/l2/artifact/editor.worker.js', modelUri: 'documentdb-query://filter/session',
        probeMarker: 'stage0_worker_probe', roundTrip: '$computeUnicodeHighlights', result: { ranges: [{}] } }, brokenCss: false,
};

describe('Stage 0 L2 integrated browser helper', (): void => {
    it('persists the successful report and detaches all observers', async (): Promise<void> => {
        const page = fixturePage(good);
        const report = await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html');
        expect(report.verified).toBe(true);
        expect(page.evaluate).toHaveBeenCalledTimes(4);
        expect(page.on).toHaveBeenCalledTimes(4);
        expect(page.off).toHaveBeenCalledTimes(4);
        expect(page.bringToFront).toHaveBeenCalledTimes(2);
        expect(page.goto).toHaveBeenCalledWith('http://localhost/stage0/l2/pages/collectionView.html', {
            waitUntil: 'domcontentloaded', timeout: 60000,
        });
    });

    it('persists and rejects a normal run with CSS regression', async (): Promise<void> => {
        const page = fixturePage({ ...good, errors: ['Style .slick-cell position: expected absolute, got static'] });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html')).rejects.toThrow('L2 collectionView failed');
        expect(page.evaluate).toHaveBeenCalledTimes(4);
        expect(page.off).toHaveBeenCalledTimes(4);
    });

    it.each(['bundle-stylesheet', 'all-styles'] as const)('accepts only an explicitly broken %s variant with measured CSS failures', async (brokenCss): Promise<void> => {
        const page = fixturePage({ ...good, brokenCss, errors: ['Style .slick-cell position: expected absolute, got static'] });
        const report = await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView-broken-css.html', true);
        expect(report.verified).toBe(true);
        const unbroken = fixturePage(good);
        await expect(runIntegratedCheck(unbroken, 'http://localhost/stage0/l2/pages/collectionView.html', true)).rejects.toThrow('negative control');
    });

    it('does not treat a pageerror as proof that CSS checks work', async (): Promise<void> => {
        const page = fixturePage({ ...good, brokenCss: 'bundle-stylesheet',
            errors: ['Style .slick-cell position: expected absolute, got static', 'pageerror: unrelated runtime failure'] });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView-broken-css.html', true)).rejects.toThrow('negative control');
    });

    it('rejects a missing bundle stylesheet even when style checks fail', async (): Promise<void> => {
        const page = fixturePage({ ...good, brokenCss: 'bundle-stylesheet',
            errors: ['Style .slick-cell position: expected absolute, got static', 'CSS-negative control removed no bundle stylesheet'] });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView-broken-css.html', true))
            .rejects.toThrow('CSS-negative control removed no bundle stylesheet');
    });

    it('drives Local Quick Start out of introduction', async (): Promise<void> => {
        const page = fixturePage({ ...good, view: 'localQuickStart' });
        await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/localQuickStart.html');
        expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Continue', exact: true });
    });

    it('verifies Atlas credentials using the fixture instead of stopping at an idle form', async (): Promise<void> => {
        const page = fixturePage({ ...good, view: 'atlasCredentials' });
        await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/atlasCredentials.html');
        expect(page.getByRole).toHaveBeenCalledWith('textbox', { name: 'Public Key', exact: true });
        expect(page.getByRole).toHaveBeenCalledWith('textbox', { name: 'Private Key', exact: true });
        expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Verify & Save', exact: true });
    });

    it.each(['collectionView', 'documentView'])('edits and restores the rendered %s editor to prove its own worker integration', async (view: string): Promise<void> => {
        const worker = view === 'documentView' ? {
            source: 'rendered-editor' as const, workerUrl: '/stage0/l2/artifact/json.worker.js', modelUri: 'inmemory://fixture/editor.json',
            probeMarker: 'stage0_worker_probe', roundTrip: 'doValidation' as const, result: [{ message: 'Value expected', severity: 1 }],
        } : good.worker;
        const page = fixturePage({ ...good, view, worker });
        await runIntegratedCheck(page, `http://localhost/stage0/l2/pages/${view}.html`);
        expect(page.keyboard.insertText).toHaveBeenCalledWith('{ "stage0_worker_probe": "left\u200bright", "invalid": }');
        expect(page.getByRole).toHaveBeenCalledWith('textbox', {
            name: view === 'documentView' ? 'Document Editor: Edit the document in JSON format' : 'Filter: Enter the DocumentDB query filter',
            exact: true,
        });
        expect(page.waitForFunction).toHaveBeenCalledTimes(7);
        expect(page.locator).toHaveBeenCalledWith('.monaco-editor');
        if (view === 'documentView') {
            expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Reload document from the database', exact: true });
        } else {
            expect(page.locator).toHaveBeenCalledWith('.queryEditorActions button');
        }
    });

    it('fails a success-shaped report that has no rendered-editor worker evidence', async (): Promise<void> => {
        const page = fixturePage({ ...good, worker: undefined });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html'))
            .rejects.toThrow('Rendered Monaco editor worker proof missing or mismatched');
    });

    it('preserves an activation or readiness timeout as a failure rather than reporting a passing fixture', async (): Promise<void> => {
        const page = fixturePage(good);
        vi.mocked(page.waitForFunction).mockRejectedValueOnce(new Error('Page never became visible'));
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html'))
            .rejects.toThrow('settling (activating the browser page): Page never became visible');
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.off).toHaveBeenCalledTimes(4);
    });
});
