/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { PromptAuthMethodStep } from './PromptAuthMethodStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

function createContext(
    previousAuthMethod: AuthMethodId | undefined,
    selectedAuthMethod: AuthMethodId,
): UpdateCredentialsWizardContext {
    return {
        selectedAuthenticationMethod: previousAuthMethod,
        availableAuthenticationMethods: Object.values(AuthMethodId),
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: jest.fn().mockResolvedValue({ authMethod: selectedAuthMethod }),
        },
    } as unknown as UpdateCredentialsWizardContext;
}

describe('PromptAuthMethodStep telemetry', () => {
    it('records an authentication method change', async () => {
        const context = createContext(AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID);

        await new PromptAuthMethodStep().prompt(context);

        expect(context.telemetry.properties).toMatchObject({
            previousAuthMethod: AuthMethodId.NativeAuth,
            authMethod: AuthMethodId.MicrosoftEntraID,
            authMethodChanged: 'true',
        });
    });

    it('records when the authentication method is retained', async () => {
        const context = createContext(AuthMethodId.NoAuth, AuthMethodId.NoAuth);

        await new PromptAuthMethodStep().prompt(context);

        expect(context.telemetry.properties).toMatchObject({
            previousAuthMethod: AuthMethodId.NoAuth,
            authMethod: AuthMethodId.NoAuth,
            authMethodChanged: 'false',
        });
    });

    it('uses a bounded value when no previous authentication method exists', async () => {
        const context = createContext(undefined, AuthMethodId.NativeAuth);

        await new PromptAuthMethodStep().prompt(context);

        expect(context.telemetry.properties.previousAuthMethod).toBe('unknown');
    });
});
