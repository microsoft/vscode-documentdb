/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { AuthMethodId, type createAuthMethodQuickPickItems } from '../../documentdb/auth/AuthMethod';
import { PromptAuthMethodStep } from './PromptAuthMethodStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

const mocks = vi.hoisted(() => ({
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    openUrl: vi.fn(),
    update: vi.fn(),
    getSession: vi.fn(),
    output: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    ThemeColor: class ThemeColor {
        constructor(public readonly id: string) {}
    },
    window: { showInformationMessage: mocks.showInformationMessage, showWarningMessage: mocks.showWarningMessage },
    workspace: { getConfiguration: () => ({ inspect: vi.fn(), update: mocks.update }) },
    authentication: { getSession: mocks.getSession },
}));
vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));
vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{
        AzureWizardPromptStep: typeof AzureWizardPromptStep;
        UserCancelledError: typeof UserCancelledError;
    }>()),
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));
vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: mocks.output } }));
vi.mock('../../utils/openUrl', () => ({ openUrl: mocks.openUrl }));

function createContext(showQuickPick: ReturnType<typeof vi.fn>): UpdateCredentialsWizardContext {
    return {
        isEmulator: false,
        storageId: 'connection',
        isErrorState: false,
        reconnectAfterError: false,
        connectionString: 'mongodb://other.example.com/',
        availableAuthenticationMethods: [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID],
        selectedAuthenticationMethod: AuthMethodId.NoAuth,
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: { showQuickPick } as unknown as IActionContext['ui'],
        entraIdAuthConfig: { tenantId: 'existing-tenant' },
        managedIdentityAuthConfig: {},
    };
}

describe('update credentials authentication picker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.showInformationMessage.mockReset();
    });

    it.each(['back', 'escape'] as const)('returns to the picker after modal %s', async (dismissal) => {
        const showQuickPick = vi
            .fn()
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockResolvedValueOnce({ authMethod: AuthMethodId.NativeAuth });
        const context = createContext(showQuickPick);
        mocks.showInformationMessage.mockImplementation(
            (
                _title: string,
                _options: vscode.MessageOptions,
                _learnMore: vscode.MessageItem,
                back: vscode.MessageItem,
            ) => {
                expect(showQuickPick).toHaveBeenCalledOnce();
                expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.NoAuth);
                return Promise.resolve(dismissal === 'back' ? back : undefined);
            },
        );

        await new PromptAuthMethodStep().prompt(context);

        const items = showQuickPick.mock.calls[0][0] as ReturnType<typeof createAuthMethodQuickPickItems>;
        expect(items[0].authMethod).toBe(AuthMethodId.NoAuth);
        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.NativeAuth);
        expect(context.authenticationMethodPrompted).toBe(true);
        expect(context.entraIdAuthConfig).toEqual({ tenantId: 'existing-tenant' });
        expect(context.managedIdentityAuthConfig).toEqual({});
        expect(mocks.openUrl).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.getSession).not.toHaveBeenCalled();
    });

    it('propagates actual picker cancellation after modal dismissal without changing the existing method', async () => {
        const cancellation = new UserCancelledError();
        const showQuickPick = vi
            .fn()
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockRejectedValueOnce(cancellation);
        mocks.showInformationMessage.mockResolvedValue(undefined);
        const context = createContext(showQuickPick);

        await expect(new PromptAuthMethodStep().prompt(context)).rejects.toBe(cancellation);
        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.NoAuth);
        expect(context.authenticationMethodPrompted).toBeUndefined();
        expect(mocks.openUrl).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('preserves the approved Entra choice without showing details', async () => {
        const showQuickPick = vi.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID });
        const context = createContext(showQuickPick);
        context.connectionString = 'mongodb://cluster.mongocluster.cosmos.azure.com/';
        context.selectedAuthenticationMethod = AuthMethodId.MicrosoftEntraID;

        await new PromptAuthMethodStep().prompt(context);

        const items = showQuickPick.mock.calls[0][0] as ReturnType<typeof createAuthMethodQuickPickItems>;
        expect(items[0].authMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(items.some((item) => item.entraUnavailable)).toBe(false);
        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    });
});
