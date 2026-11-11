/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    openUrl: vi.fn(),
    update: vi.fn(),
    getSession: vi.fn(),
}));

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    window: {
        showInformationMessage: mocks.showInformationMessage,
        showWarningMessage: mocks.showWarningMessage,
    },
    workspace: { getConfiguration: () => ({ update: mocks.update }) },
    authentication: { getSession: mocks.getSession },
}));
vi.mock('../../utils/openUrl', () => ({ openUrl: mocks.openUrl }));

import { Links } from '../../constants';
import { showEntraUnavailableDetails } from './showEntraUnavailableDetails';

describe('showEntraUnavailableDetails', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.showInformationMessage.mockReset();
        mocks.showWarningMessage.mockReset();
        mocks.openUrl.mockReset();
    });

    it.each(['back', 'escape'] as const)('shows the modal and returns without opening for %s', async (dismissal) => {
        mocks.showInformationMessage.mockImplementation(
            (
                _title: string,
                _options: vscode.MessageOptions,
                _learnMore: vscode.MessageItem,
                back: vscode.MessageItem,
            ) => Promise.resolve(dismissal === 'back' ? back : undefined),
        );

        await expect(showEntraUnavailableDetails()).resolves.toBeUndefined();

        expect(mocks.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            'Using Microsoft Entra ID with this server',
            {
                modal: true,
                detail: 'This is a server-address check, not a sign-in failure.\n\nTo protect your sign-in tokens, the extension enables Microsoft Entra ID only for recognized Azure DocumentDB addresses or explicitly configured trusted servers.\n\nConnecting to Azure DocumentDB? Compare your connection string with the one in the Azure portal. If that address is still unrecognized, or you use a custom address, select Learn More for endpoint verification and trusted-server setup guidance.\n\nConnecting to another service? Choose an authentication method supported by that service.',
            },
            { title: 'Learn More' },
            { title: 'Back', isCloseAffordance: true },
        );
        expect(mocks.openUrl).not.toHaveBeenCalled();
        expect(mocks.showWarningMessage).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.getSession).not.toHaveBeenCalled();
    });

    it('opens only after Learn More and waits for the browser open', async () => {
        let select!: (action: vscode.MessageItem) => void;
        let finishOpen!: (opened: boolean) => void;
        let startedOpen!: () => void;
        const openStarted = new Promise<void>((resolve) => {
            startedOpen = resolve;
        });
        mocks.showInformationMessage.mockImplementation(
            () =>
                new Promise<vscode.MessageItem>((resolve) => {
                    select = resolve;
                }),
        );
        mocks.openUrl.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    finishOpen = resolve;
                    startedOpen();
                }),
        );

        let settled = false;
        const pending = showEntraUnavailableDetails().then(() => {
            settled = true;
        });
        expect(mocks.openUrl).not.toHaveBeenCalled();
        const learnMore = mocks.showInformationMessage.mock.calls[0][2] as vscode.MessageItem;
        select(learnMore);
        await openStarted;
        expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith(Links.EntraTrustedServers);
        expect(settled).toBe(false);
        finishOpen(true);
        await pending;
        expect(settled).toBe(true);
        expect(mocks.showWarningMessage).not.toHaveBeenCalled();
    });

    it('warns without waiting for dismissal when the browser refuses to open', async () => {
        mocks.showInformationMessage.mockImplementation(
            (_title: string, _options: vscode.MessageOptions, learnMore: vscode.MessageItem) =>
                Promise.resolve(learnMore),
        );
        mocks.openUrl.mockResolvedValue(false);
        mocks.showWarningMessage.mockReturnValue(new Promise(() => {}));

        await expect(showEntraUnavailableDetails()).resolves.toBeUndefined();

        expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith(Links.EntraTrustedServers);
        expect(mocks.showWarningMessage).toHaveBeenCalledExactlyOnceWith("We couldn't open this link.");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.getSession).not.toHaveBeenCalled();
    });

    it('warns without waiting for dismissal when the browser open rejects', async () => {
        const error = new Error('open failed');
        mocks.showInformationMessage.mockImplementation(
            (_title: string, _options: vscode.MessageOptions, learnMore: vscode.MessageItem) =>
                Promise.resolve(learnMore),
        );
        mocks.openUrl.mockRejectedValue(error);
        mocks.showWarningMessage.mockReturnValue(new Promise(() => {}));

        await expect(showEntraUnavailableDetails()).resolves.toBeUndefined();
        expect(mocks.openUrl).toHaveBeenCalledExactlyOnceWith(Links.EntraTrustedServers);
        expect(mocks.showWarningMessage).toHaveBeenCalledExactlyOnceWith("We couldn't open this link.");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.getSession).not.toHaveBeenCalled();
    });
});
