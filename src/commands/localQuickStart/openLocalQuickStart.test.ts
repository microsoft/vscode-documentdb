/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { openLocalQuickStartWebview } from '../../webviews/documentdb/localQuickStart/localQuickStartController';
import { openLocalQuickStart } from './openLocalQuickStart';

jest.mock('../../webviews/documentdb/localQuickStart/localQuickStartController', () => ({
    openLocalQuickStartWebview: jest.fn(),
}));

describe('openLocalQuickStart', () => {
    afterEach(() => jest.restoreAllMocks());

    it('waits for authoritative hydration before revealing the webview', async () => {
        let finishHydration: (() => void) | undefined;
        jest.spyOn(QuickStartService, 'ensureHydrated').mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishHydration = resolve;
                }),
        );
        const revealToForeground = jest.fn();
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        const opening = openLocalQuickStart({} as IActionContext);
        expect(openLocalQuickStartWebview).not.toHaveBeenCalled();

        finishHydration?.();
        await opening;

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith({ id: 'localQuickStart' });
        expect(revealToForeground).toHaveBeenCalledTimes(1);
    });

    it('still opens the webview when hydration fails because Docker is unavailable', async () => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockRejectedValue(new Error('Docker unavailable'));
        const revealToForeground = jest.fn();
        jest.mocked(openLocalQuickStartWebview).mockReturnValue({
            panel: { viewColumn: undefined },
            revealToForeground,
        } as never);

        await expect(openLocalQuickStart({} as IActionContext)).resolves.toBeUndefined();

        expect(openLocalQuickStartWebview).toHaveBeenCalledWith({ id: 'localQuickStart' });
        expect(revealToForeground).toHaveBeenCalledTimes(1);
    });
});
