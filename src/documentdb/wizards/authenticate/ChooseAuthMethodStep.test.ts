/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
}));

const mockOutputChannel = { info: jest.fn(), error: jest.fn() };
jest.mock('../../../extensionVariables', () => ({
    ext: { get outputChannel(): typeof mockOutputChannel { return mockOutputChannel; } },
}));
beforeEach(() => { jest.clearAllMocks(); });

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

import { AuthMethodId } from '../../auth/AuthMethod';
import { PromptAuthMethodStep as NewConnectionAuthStep } from '../../../commands/newConnection/PromptAuthMethodStep';
import { PromptAuthMethodStep as UpdateCredentialsAuthStep } from '../../../commands/updateCredentials/PromptAuthMethodStep';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { ChooseAuthMethodStep } from './ChooseAuthMethodStep';

describe('ChooseAuthMethodStep authentication families', () => {
    it('auto-selects the Entra family when account and managed identity are the only methods', async () => {
        const showQuickPick = jest.fn();
        const context = {
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        } as unknown as AuthenticateWizardContext;

        await new ChooseAuthMethodStep().prompt(context);

        expect(context.selectedAuthMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.authenticationMethodPrompted).toBe(false);
        expect(showQuickPick).not.toHaveBeenCalled();
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).toContain('singleSupportedFamily');
    });

    it.each([['newConnection', new NewConnectionAuthStep()], ['updateCredentials', new UpdateCredentialsAuthStep()]])(
        'traces %s picker options and selection', async (source, step) => {
            const context = {
                availableAuthenticationMethods: [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
                ui: { showQuickPick: jest.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID }) },
            };

            await step.prompt(context as never);

            const output = JSON.stringify(mockOutputChannel.info.mock.calls);
            expect(output).toContain(`${source}.authMethodPicker`);
            expect(output).toContain('NativeAuth,MicrosoftEntraID,NoAuth');
            expect(output).toContain(`${source}.authMethodSelected`);
        },
    );

    it('traces a family picker skipped because inference already chose the method', () => {
        expect(new NewConnectionAuthStep().shouldPrompt({ selectedAuthenticationMethod: AuthMethodId.ManagedIdentity } as never)).toBe(false);
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).toContain('methodAlreadySelectedOrInferred');
    });
});
