/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { SelectEntraTokenSourceStep } from '../../documentdb/wizards/authenticate/SelectEntraTokenSourceStep';
import { API } from '../../DocumentDBExperiences';
import type * as storageModule from '../../services/connectionStorageService';
import { ItemType } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { updateCredentials } from './updateCredentials';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

const capturedContexts: UpdateCredentialsWizardContext[] = [];
const mockGet = vi.fn();
const mockDeleteClient = vi.fn();
const mockDeleteCredentials = vi.spyOn(CredentialCache, 'deleteCredentials');
const mockShutdownEvaluator = vi.fn();
const mockGetRegisteredShellTerminals = vi.fn();

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ AzureWizard: typeof AzureWizard }>()),
    AzureWizard: class {
        constructor(context: UpdateCredentialsWizardContext) {
            capturedContexts.push(context);
        }
        public prompt(): Promise<void> {
            return Promise.resolve();
        }
        public execute(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: (...args: unknown[]): unknown => mockGet(...args) },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { deleteClient: (...args: unknown[]): unknown => mockDeleteClient(...args) },
}));
vi.mock('../playground/executePlaygroundCode', () => ({
    shutdownEvaluator: (...args: unknown[]): unknown => mockShutdownEvaluator(...args),
}));
vi.mock('../../documentdb/shell/ShellTerminalLinkProvider', () => ({
    getRegisteredShellTerminals: (): unknown => mockGetRegisteredShellTerminals(),
}));
vi.mock('../refreshView/refreshView', () => ({ refreshView: vi.fn() }));
vi.mock('../../extensionVariables', () => ({
    ext: { connectionsBranchDataProvider: { hasNodeErrorState: vi.fn(() => false) } },
}));

beforeEach(() => {
    CredentialCache.deleteCredentials('stable-cluster-id');
    vi.clearAllMocks();
    mockGetRegisteredShellTerminals.mockReturnValue([]);
    capturedContexts.length = 0;
});

async function inferMethods(
    host: string,
    suffix?: string,
    storedMethods: AuthMethodId[] = [AuthMethodId.NativeAuth, AuthMethodId.NoAuth],
): Promise<UpdateCredentialsWizardContext> {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue({ hostnameSuffix: suffix }),
    } as unknown as vscode.WorkspaceConfiguration);
    mockGet.mockResolvedValue({
        id: 'stable-cluster-id',
        name: 'cluster',
        properties: {
            type: ItemType.Connection,
            api: API.DocumentDB,
            availableAuthMethods: storedMethods,
            selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
        },
        secrets: { connectionString: `mongodb://${host}:10255/` },
    });
    const context = {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
    } as unknown as IActionContext;
    const node = {
        id: 'folder/current-tree-path',
        storageId: 'stable-cluster-id',
        cluster: { clusterId: 'stable-cluster-id', treeId: 'folder/current-tree-path' },
    } as unknown as DocumentDBClusterItem;
    await updateCredentials(context, node);
    expect(mockDeleteClient).toHaveBeenCalledWith('stable-cluster-id');
    expect(mockDeleteCredentials).not.toHaveBeenCalled();
    const captured = capturedContexts[0];
    if (!captured) {
        throw new Error('Update Credentials did not construct its wizard');
    }
    return captured;
}

describe('updateCredentials host inference', () => {
    it.each(['com', 'us', 'cn'])('offers managed identity for azure.%s DocumentDB hosts', async (tld) => {
        const context = await inferMethods(`CLUSTER.global.mongocluster.cosmos.azure.${tld}`);
        expect(context.availableAuthenticationMethods).toEqual([
            AuthMethodId.NativeAuth,
            AuthMethodId.NoAuth,
            AuthMethodId.MicrosoftEntraID,
            AuthMethodId.ManagedIdentity,
        ]);
        const sourceStep = new SelectEntraTokenSourceStep<UpdateCredentialsWizardContext>(
            (wizardContext) => wizardContext.selectedAuthenticationMethod,
            (wizardContext, method) => {
                wizardContext.selectedAuthenticationMethod = method;
            },
        );
        expect(sourceStep.shouldPrompt(context)).toBe(true);
    });

    it('recognizes a configured service suffix without duplicating existing methods', async () => {
        const methods = [
            AuthMethodId.NativeAuth,
            AuthMethodId.NoAuth,
            AuthMethodId.MicrosoftEntraID,
            AuthMethodId.ManagedIdentity,
        ];
        const context = await inferMethods('cluster.database.example.com', ' .DATABASE.EXAMPLE.COM ', methods);
        expect(context.availableAuthenticationMethods).toEqual(methods);
    });

    it.each([
        ['cluster.mongocluster.cosmos.azure.us.evil.com', undefined],
        ['xmongocluster.cosmos.azure.com', undefined],
        ['cluster.mongo.cosmos.azure.com', undefined],
        ['notdatabase.example.com', '.database.example.com'],
        ['cluster.database.example.com.evil.com', '.database.example.com'],
        ['attacker.com.cn', '.com.cn'],
    ])('does not add Entra methods for lookalike, RU, or rejected custom host %s', async (host, suffix) => {
        const context = await inferMethods(host, suffix);
        expect(context.availableAuthenticationMethods).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
    });
});

describe('updateCredentials post-wizard updates', () => {
    const emulatorConfiguration = { isEmulator: true, disableEmulatorSecurity: false };
    const node = {
        id: 'folder/current-tree-path',
        storageId: 'stable-cluster-id',
        cluster: {
            clusterId: 'stable-cluster-id',
            treeId: 'folder/current-tree-path',
            name: 'cluster',
            emulatorConfiguration,
        },
    } as unknown as DocumentDBClusterItem;
    const originalConnection: storageModule.ConnectionItemInput = {
        id: 'stable-cluster-id',
        name: 'cluster',
        properties: {
            type: ItemType.Connection,
            api: API.DocumentDB,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
        },
        secrets: {
            connectionString: 'mongodb://old.example.com:27017/',
            nativeAuthConfig: { connectionUser: 'old-user', connectionPassword: 'old-password' },
        },
    };
    let context: IActionContext;

    beforeEach(() => {
        context = {
            valuesToMask: [],
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as unknown as IActionContext;
        mockGet.mockResolvedValue(originalConnection);
        CredentialCache.setAuthCredentials(
            node.cluster.clusterId,
            AuthMethodId.NativeAuth,
            originalConnection.secrets.connectionString,
            originalConnection.secrets.nativeAuthConfig,
        );
    });

    it.each<{ authMethod: AuthMethodId; secrets: Partial<storageModule.ConnectionSecrets> }>([
        {
            authMethod: AuthMethodId.NativeAuth,
            secrets: { nativeAuthConfig: { connectionUser: 'new-user', connectionPassword: 'new-password' } },
        },
        {
            authMethod: AuthMethodId.MicrosoftEntraID,
            secrets: { entraIdAuthConfig: { tenantId: 'new-tenant', subscriptionId: 'new-subscription' } },
        },
        { authMethod: AuthMethodId.ManagedIdentity, secrets: { managedIdentityAuthConfig: {} } },
        {
            authMethod: AuthMethodId.ManagedIdentity,
            secrets: { managedIdentityAuthConfig: { clientId: 'new-client', tenantId: 'new-tenant' } },
        },
        { authMethod: AuthMethodId.NoAuth, secrets: {} },
    ])(
        'caches the saved $authMethod credentials and shuts down the old client and playground',
        async ({ authMethod, secrets }) => {
            const savedConnection: storageModule.ConnectionItemInput = {
                ...originalConnection,
                properties: { ...originalConnection.properties, selectedAuthMethod: authMethod },
                secrets: { connectionString: 'mongodb://new.example.com:27017/', ...secrets },
            };
            mockGet.mockResolvedValueOnce(originalConnection).mockResolvedValueOnce(savedConnection);

            await updateCredentials(context, node);

            expect(mockGet).toHaveBeenCalledTimes(2);
            expect(mockGet.mock.calls[1]).toEqual(mockGet.mock.calls[0]);
            expect(CredentialCache.getCredentials(node.cluster.clusterId)).toEqual({
                clusterId: node.cluster.clusterId,
                authMechanism: authMethod,
                connectionString: savedConnection.secrets.connectionString,
                connectionStringWithPassword:
                    authMethod === AuthMethodId.NativeAuth
                        ? 'mongodb://new-user:new-password@new.example.com:27017/'
                        : savedConnection.secrets.connectionString,
                nativeAuthConfig: secrets.nativeAuthConfig,
                emulatorConfiguration,
                entraIdConfig: secrets.entraIdAuthConfig,
                managedIdentityConfig: secrets.managedIdentityAuthConfig,
            });
            expect(CredentialCache.hasCredentials(node.cluster.treeId)).toBe(false);
            expect(mockDeleteCredentials).not.toHaveBeenCalled();
            expect(mockDeleteClient).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId);
            expect(mockShutdownEvaluator).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId);
        },
    );

    it('deletes cached credentials when stored native authentication has no password', async () => {
        mockGet.mockResolvedValue({
            ...originalConnection,
            secrets: {
                ...originalConnection.secrets,
                nativeAuthConfig: { connectionUser: 'new-user' },
            },
        });

        await updateCredentials(context, node);

        expect(mockDeleteCredentials).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId);
        expect(CredentialCache.getCredentials(node.cluster.clusterId)).toBeUndefined();
    });

    it('deletes cached credentials when the stored authentication method is missing', async () => {
        mockGet.mockResolvedValue({
            ...originalConnection,
            properties: { ...originalConnection.properties, selectedAuthMethod: undefined },
        });

        await updateCredentials(context, node);

        expect(mockDeleteCredentials).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId);
        expect(CredentialCache.getCredentials(node.cluster.clusterId)).toBeUndefined();
    });

    it('shows a modal without action items when a shell for the cluster is open', async () => {
        mockGetRegisteredShellTerminals.mockReturnValue([
            { info: { clusterId: 'another-cluster-id' } },
            { info: { clusterId: node.cluster.clusterId } },
        ]);

        await updateCredentials(context, node);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            "Credentials updated. New connections will use them. Open shells for 'cluster' keep their current connection until you close them.",
            { modal: true },
        );
        const modalCallOrder = vi.mocked(vscode.window.showInformationMessage).mock.invocationCallOrder[0];
        expect(mockDeleteClient.mock.invocationCallOrder[0]).toBeLessThan(modalCallOrder);
        expect(mockShutdownEvaluator.mock.invocationCallOrder[0]).toBeLessThan(modalCallOrder);
    });

    it.each([
        { name: 'no shells are open', shells: [] },
        { name: 'only another cluster has a shell', shells: [{ info: { clusterId: 'another-cluster-id' } }] },
        {
            name: 'a shell cluster ID matches only the tree path',
            shells: [{ info: { clusterId: node.cluster.treeId } }],
        },
    ])('does not show a modal when $name', async ({ shells }) => {
        mockGetRegisteredShellTerminals.mockReturnValue(shells);

        await updateCredentials(context, node);

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });
});
