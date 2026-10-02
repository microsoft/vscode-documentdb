/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserReport } from './runtime';
import { runIntegratedCheck, type IntegratedPage } from './playwright';

function fixturePage(report: BrowserReport): IntegratedPage {
    return {
        on: jest.fn(), off: jest.fn(), goto: jest.fn(), waitForFunction: jest.fn(),
        getByRole: jest.fn((): { click: () => Promise<void>; fill: () => Promise<void> } => ({
            click: jest.fn(async (): Promise<void> => {}), fill: jest.fn(async (): Promise<void> => {}),
        })),
        evaluate: jest.fn().mockResolvedValueOnce(report).mockResolvedValue(undefined),
    };
}

const good: BrowserReport = {
    view: 'collectionView', errors: [], rpcPaths: ['mongoClusters.collectionView.runFindQuery'],
    styles: [], chunks: ['http://localhost/stage0/l2/artifact/views.js'], worker: { roundTrip: 'doValidation' }, brokenCss: false,
};

describe('Stage 0 L2 integrated browser helper', (): void => {
    it('persists the successful report and detaches all observers', async (): Promise<void> => {
        const page = fixturePage(good);
        const report = await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html');
        expect(report.verified).toBe(true);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.on).toHaveBeenCalledTimes(4);
        expect(page.off).toHaveBeenCalledTimes(4);
    });

    it('persists and rejects a normal run with CSS regression', async (): Promise<void> => {
        const page = fixturePage({ ...good, errors: ['Style .slick-cell position: expected absolute, got static'] });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView.html')).rejects.toThrow('L2 collectionView failed');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.off).toHaveBeenCalledTimes(4);
    });

    it('accepts only an explicitly broken CSS variant with measured CSS failures', async (): Promise<void> => {
        const page = fixturePage({ ...good, brokenCss: true, errors: ['Style .slick-cell position: expected absolute, got static'] });
        const report = await runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView-broken-css.html', true);
        expect(report.verified).toBe(true);
        const unbroken = fixturePage(good);
        await expect(runIntegratedCheck(unbroken, 'http://localhost/stage0/l2/pages/collectionView.html', true)).rejects.toThrow('negative control');
    });

    it('does not treat a pageerror as proof that CSS checks work', async (): Promise<void> => {
        const page = fixturePage({ ...good, brokenCss: true,
            errors: ['Style .slick-cell position: expected absolute, got static', 'pageerror: unrelated runtime failure'] });
        await expect(runIntegratedCheck(page, 'http://localhost/stage0/l2/pages/collectionView-broken-css.html', true)).rejects.toThrow('negative control');
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
});
