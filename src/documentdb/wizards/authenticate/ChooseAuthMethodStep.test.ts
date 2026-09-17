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
    t: (message: string): string => message,
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

import { AuthMethodId } from '../../auth/AuthMethod';
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
    });
});
