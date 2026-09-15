/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES } from '../../documentdb/auth/managedIdentityConnectionString';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionStringStep } from './PromptConnectionStringStep';

function makeContext(connectionString: string): NewConnectionWizardContext {
    return {
        parentId: '',
        properties: {},
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        ui: {
            showInputBox: jest.fn().mockResolvedValue(connectionString),
        },
    } as unknown as NewConnectionWizardContext;
}

describe('PromptConnectionStringStep', () => {
    it('keeps managed identity available when an explicit hint uses a custom host', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const context = makeContext(
            `mongodb://${clientId}@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.ManagedIdentity);
        expect(context.availableAuthenticationMethods).toContain(AuthMethodId.ManagedIdentity);
        expect(context.managedIdentityAuthConfig).toEqual({ clientId });
    });
});
