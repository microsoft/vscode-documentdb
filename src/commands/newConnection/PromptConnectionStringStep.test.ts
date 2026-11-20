/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DOCUMENTDB_TOKEN_RESOURCE } from '../../documentdb/auth/entraScopes';
import { getManagedIdentityAuthMechanismProperties } from '../../documentdb/auth/managedIdentityConnectionString';
import { SelectEntraTokenSourceStep } from '../../documentdb/wizards/authenticate/SelectEntraTokenSourceStep';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionStringStep } from './PromptConnectionStringStep';

const mockInfo = vi.fn();
const publicAuthMechanismProperties = getManagedIdentityAuthMechanismProperties(DOCUMENTDB_TOKEN_RESOURCE);
vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            info: (...args: unknown[]): void => {
                mockInfo(...args);
            },
        },
    },
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        inspect: vi.fn().mockReturnValue(undefined),
    } as unknown as vscode.WorkspaceConfiguration);
});
function expectPrivateInferenceOutput(): void {
    const output = JSON.stringify(mockInfo.mock.calls);
    expect(output).toContain('connectionStringAuthInference');
    for (const secret of ['11111111-2222-3333-4444-555555555555', 'private.documentdb.internal', 'display-name']) {
        expect(output).not.toContain(secret);
    }
}

afterEach(expectPrivateInferenceOutput);

function makeContext(connectionString: string): NewConnectionWizardContext {
    return {
        parentId: '',
        properties: {},
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        ui: {
            showInputBox: vi.fn().mockResolvedValue(connectionString),
        },
    } as unknown as NewConnectionWizardContext;
}

describe('PromptConnectionStringStep', () => {
    it.each(['com', 'us', 'cn'])('offers Entra ID and managed identity for azure.%s DocumentDB hosts', async (tld) => {
        const context = makeContext(`mongodb+srv://cluster.global.mongocluster.cosmos.azure.${tld}/`);
        await new PromptConnectionStringStep().prompt(context);
        expect(context.availableAuthenticationMethods).toEqual([
            AuthMethodId.NativeAuth,
            AuthMethodId.MicrosoftEntraID,
            AuthMethodId.ManagedIdentity,
            AuthMethodId.NoAuth,
        ]);
        expect(mockInfo.mock.calls.map((call) => String(call[0])).join('\n')).toContain('"entraHostRecognized":true');
        context.selectedAuthenticationMethod = AuthMethodId.MicrosoftEntraID;
        const sourceStep = new SelectEntraTokenSourceStep<NewConnectionWizardContext>(
            (wizardContext) => wizardContext.selectedAuthenticationMethod,
            (wizardContext, method) => {
                wizardContext.selectedAuthenticationMethod = method;
            },
        );
        expect(sourceStep.shouldPrompt(context)).toBe(true);
    });

    it.each([
        ['cluster.database.example.com', '.database.example.com', true],
        ['notdatabase.example.com', '.database.example.com', false],
        ['cluster.database.example.com.evil.com', '.database.example.com', false],
        ['attacker.com.cn', '.com.cn', false],
        ['cluster.mongocluster.cosmos.azure.us.evil.com', undefined, false],
        ['xmongocluster.cosmos.azure.com', undefined, false],
        ['cluster.mongo.cosmos.azure.com', undefined, false],
    ])('classifies configured, lookalike, and RU host %s', async (host, suffix, recognized) => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn().mockReturnValue({ globalValue: { hostnameSuffix: suffix } }),
        } as unknown as vscode.WorkspaceConfiguration);
        const context = makeContext(`mongodb://${host}:10255/`);
        await new PromptConnectionStringStep().prompt(context);
        expect(context.availableAuthenticationMethods).toEqual(
            recognized
                ? [
                      AuthMethodId.NativeAuth,
                      AuthMethodId.MicrosoftEntraID,
                      AuthMethodId.ManagedIdentity,
                      AuthMethodId.NoAuth,
                  ]
                : [AuthMethodId.NativeAuth, AuthMethodId.NoAuth],
        );
    });

    it('does not preselect or offer managed identity for an unapproved host despite an explicit hint', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const context = makeContext(
            `mongodb://${clientId}@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${publicAuthMechanismProperties}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
        expect(context.managedIdentityAuthConfig).toBeUndefined();
        expect(context.connectionStringAuthFacts).toMatchObject({
            usesOidc: true,
            declaresAzureMachineWorkflow: true,
            username: clientId,
            usernameIsGuid: true,
        });
    });

    it('does not preselect the Entra family for an unapproved host from OIDC plus a GUID', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const context = makeContext(
            `mongodb://${clientId}@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.managedIdentityAuthConfig).toBeUndefined();
        expect(context.connectionStringAuthFacts?.declaresAzureMachineWorkflow).toBe(false);
    });

    it('does not infer managed identity from ENVIRONMENT:azure without OIDC', async () => {
        const context = makeContext(
            `mongodb://private.documentdb.internal:10260/?authMechanismProperties=${publicAuthMechanismProperties}`,
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

    it('keeps rejected OIDC facts for explanation without selecting Entra or storing machine-flow markers', async () => {
        const context = makeContext(
            `mongodb://display-name@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${publicAuthMechanismProperties}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.connectionStringAuthFacts).toMatchObject({
            declaresAzureMachineWorkflow: true,
            username: 'display-name',
            usernameIsGuid: false,
        });
        expect(context.connectionString).not.toContain('authMechanism');
        expect(context.connectionString).not.toContain('display-name');
    });

    it.each([
        'cluster.eastus.cloudapp.azure.com',
        'cluster.mongo.cosmos.azure.com',
        'cluster.mongocluster.cosmos.azure.com,other.example.com',
        'cluster.mongocluster.cosmos.azure.com.',
    ])('suppresses both Entra options for rejected destination %s', async (hosts) => {
        const context = makeContext(`mongodb://${hosts}/?authMechanism=MONGODB-OIDC`);

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
    });

    it('still preselects managed identity from an explicit hint for an approved destination', async () => {
        const context = makeContext(
            `mongodb://11111111-2222-3333-4444-555555555555@cluster.mongocluster.cosmos.azure.com/?authMechanism=MONGODB-OIDC&authMechanismProperties=${publicAuthMechanismProperties}`,
        );

        await new PromptConnectionStringStep().prompt(context);

        expect(context.selectedAuthenticationMethod).toBe(AuthMethodId.ManagedIdentity);
        expect(context.managedIdentityAuthConfig).toEqual({ clientId: '11111111-2222-3333-4444-555555555555' });
    });

    it('preserves pasted native credentials on a rejected Entra destination', async () => {
        const context = makeContext('mongodb://native-user:native-password@other.example.com/');

        await new PromptConnectionStringStep().prompt(context);

        expect(context.nativeAuthConfig).toEqual({
            connectionUser: 'native-user',
            connectionPassword: 'native-password',
        });
        expect(context.connectionString).not.toContain('native-password');
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
    });
});
