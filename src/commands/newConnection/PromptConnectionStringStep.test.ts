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
        get: vi.fn().mockReturnValue(undefined),
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
            get: vi.fn().mockReturnValue({ mongoClusterHostnameSuffix: suffix }),
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

    it('keeps managed identity available when an explicit hint uses a custom host', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const context = makeContext(
            `mongodb://${clientId}@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${publicAuthMechanismProperties}`,
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

    it('keeps an unusable machine identity visible for correction without storing machine-flow markers', async () => {
        const context = makeContext(
            `mongodb://display-name@private.documentdb.internal:10260/?authMechanism=MONGODB-OIDC&authMechanismProperties=${publicAuthMechanismProperties}`,
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
