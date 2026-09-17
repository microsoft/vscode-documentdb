/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { ChooseAuthMethodStep } from './ChooseAuthMethodStep';
import { SaveCredentialsStep } from './SaveCredentialsStep';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((value: string) => value),
}));

function createContext(showQuickPick: jest.Mock): AuthenticateWizardContext {
    return {
        adminUserName: undefined,
        resourceName: 'test-resource',
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: { showQuickPick },
    } as unknown as AuthenticateWizardContext;
}

describe('authentication prompt telemetry', () => {
    it('records an automatically selected authentication method', async () => {
        const showQuickPick = jest.fn();
        const context = createContext(showQuickPick);
        context.availableAuthMethods = [AuthMethodId.NoAuth];

        await new ChooseAuthMethodStep().prompt(context);

        expect(showQuickPick).not.toHaveBeenCalled();
        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.NoAuth,
            authMethodSelection: 'automatic',
        });
    });

    it('records a user-selected authentication method', async () => {
        const showQuickPick = jest.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID });
        const context = createContext(showQuickPick);
        context.availableAuthMethods = [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID];

        await new ChooseAuthMethodStep().prompt(context);

        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.MicrosoftEntraID,
            authMethodSelection: 'user',
        });
    });

    it.each([
        ['saveCredentials', 'true'],
        ['doNotSaveCredentials', 'false'],
    ])('records the save-credentials choice: %s', async (id, expected) => {
        const context = createContext(jest.fn().mockResolvedValue({ id }));

        await new SaveCredentialsStep().prompt(context);

        expect(context.telemetry.properties.saveCredentials).toBe(expected);
    });
});
