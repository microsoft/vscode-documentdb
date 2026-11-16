/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API } from '../../DocumentDBExperiences';
import { appRouter, type BaseRouterContext } from './appRouter';
import { showModalConfirmation } from './commonDialogs';
import { createCallerFactory } from './trpc';

const context: BaseRouterContext = { dbExperience: API.DocumentDB, webviewName: 'connectionDiagnostics' };
const caller = createCallerFactory(appRouter)(context);

const input = {
    message: 'This report includes host and identity details.',
    detail: 'Host names, addresses and user names are not hidden.',
    confirmLabel: 'Copy report',
};

describe('common.confirm', () => {
    beforeEach(() => {
        vi.mocked(vscode.window.showWarningMessage).mockReset();
        vi.mocked(vscode.window.showInformationMessage).mockReset();
    });

    it('shows a modal warning with the detail and one confirm button, and reports the choice', async () => {
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Copy report' as never);

        await expect(caller.common.confirm(input)).resolves.toEqual({ confirmed: true });

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            input.message,
            { modal: true, detail: input.detail },
            'Copy report',
        );
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('treats Cancel, Escape and a closed dialog as not confirmed', async () => {
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

        await expect(caller.common.confirm(input)).resolves.toEqual({ confirmed: false });
    });

    it('uses an information dialog when asked', async () => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Copy report' as never);

        await expect(caller.common.confirm({ ...input, severity: 'information' })).resolves.toEqual({
            confirmed: true,
        });
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            input.message,
            { modal: true, detail: input.detail },
            'Copy report',
        );
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('rejects an empty message or confirm label before showing anything', async () => {
        await expect(caller.common.confirm({ ...input, message: '' })).rejects.toThrow();
        await expect(caller.common.confirm({ ...input, confirmLabel: '' })).rejects.toThrow();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('works without a detail', async () => {
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

        await expect(showModalConfirmation({ message: 'Continue?', confirmLabel: 'Continue' })).resolves.toEqual({
            confirmed: false,
        });
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Continue?',
            { modal: true, detail: undefined },
            'Continue',
        );
    });
});
