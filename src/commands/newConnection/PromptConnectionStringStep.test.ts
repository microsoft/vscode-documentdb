/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES } from '../../documentdb/auth/managedIdentityConnectionString';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionStringStep } from './PromptConnectionStringStep';

const mockInfo = jest.fn();
jest.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { info: (...args: unknown[]): void => { mockInfo(...args); } } },
}));

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => {
    const output = JSON.stringify(mockInfo.mock.calls);
    expect(output).toContain('connectionStringAuthInference');
    for (const secret of ['11111111-2222-3333-4444-555555555555', 'private.documentdb.internal', 'display-name']) {
        expect(output).not.toContain(secret);
    }
});

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
        expect(context.connectionStringAuthFacts).toMatchObject({
            usesOidc: true,
            declaresAzureMachineWorkflow: true,
            username: clientId,
            usernameIsGuid: true,
        });
    });

    it('deduces the Entra family but not the token source from OIDC plus a GUID', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const context = makeContext(
            `mongodb://${clientId}@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.managedIdentityAuthConfig).toEqual({ clientId });
        expect(context.connectionStringAuthFacts?.declaresAzureMachineWorkflow).toBe(false);
    });

    it('does not infer managed identity from ENVIRONMENT:azure without OIDC', async () => {
        const context = makeContext(
            `mongodb://private.documentdb.internal:10260/?authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.managedIdentityAuthConfig).toBeUndefined();
        expect(context.availableAuthenticationMethods).not.toContain(AuthMethodId.ManagedIdentity);
        expect(context.connectionStringAuthFacts).toMatchObject({
            usesOidc: false,
            declaresAzureMachineWorkflow: true,
        });
    });

    it('keeps an unusable machine identity visible for correction without storing machine-flow markers', async () => {
        const context = makeContext(
            `mongodb://display-name@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.connectionStringAuthFacts).toMatchObject({
            declaresAzureMachineWorkflow: true,
            username: 'display-name',
            usernameIsGuid: false,
        });
        expect(context.connectionString).not.toContain('authMechanism');
        expect(context.connectionString).not.toContain('display-name');
    });
});
