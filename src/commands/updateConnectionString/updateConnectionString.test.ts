/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    UserCancelledError,
    type AzureWizard,
    type IActionContext,
    type callWithTelemetryAndErrorHandling,
} from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API, DocumentDBExperience } from '../../DocumentDBExperiences';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { EntraDestinationRejectedError } from '../../documentdb/auth/oidcAllowedHosts';
import { type AuthenticateWizardContext } from '../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ChooseAuthMethodStep } from '../../documentdb/wizards/authenticate/ChooseAuthMethodStep';
import { ext } from '../../extensionVariables';
import type * as storageModule from '../../services/connectionStorageService';
import {
    ConnectionStorageService,
    ConnectionType,
    ItemType,
    type ConnectionItem,
} from '../../services/connectionStorageService';
import { type TreeElement } from '../../tree/TreeElement';
import { ConnectionsBranchDataProvider } from '../../tree/connections-view/ConnectionsBranchDataProvider';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { type ConnectionClusterModel } from '../../tree/connections-view/models/ConnectionClusterModel';
import { type TreeCluster } from '../../tree/models/BaseClusterModel';
import { ConnectionStringStep } from './ConnectionStringStep';
import { ExecuteStep } from './ExecuteStep';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';
import { updateConnectionString } from './updateConnectionString';

const { capturedContexts, showInputBox, showQuickPick } = vi.hoisted(() => ({
    capturedContexts: [] as UpdateCSWizardContext[],
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{
        AzureWizard: typeof AzureWizard;
        callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling;
    }>()),
    AzureWizard: class {
        constructor(private readonly context: UpdateCSWizardContext | AuthenticateWizardContext) {
            if ('storageId' in context) {
                capturedContexts.push(context);
            }
        }
        public async prompt(): Promise<void> {
            if ('storageId' in this.context) {
                await new ConnectionStringStep().prompt(this.context);
            } else {
                await new ChooseAuthMethodStep().prompt(this.context);
            }
        }
        public async execute(): Promise<void> {
            if ('storageId' in this.context) {
                const step = new ExecuteStep();
                if (step.shouldExecute(this.context)) {
                    await step.execute(this.context);
                }
            }
        }
    },
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        try {
            return await callback(makeContext());
        } catch {
            return undefined;
        }
    },
}));
vi.mock('../../services/connectionStorageService', async (importOriginal) => ({
    ...(await importOriginal<typeof storageModule>()),
    ConnectionStorageService: { get: vi.fn(), save: vi.fn() },
}));
vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn(), deleteClient: vi.fn(), exists: vi.fn() },
}));
vi.mock('../../services/connectionReachabilityService', () => ({
    ConnectionReachabilityService: { ensureReachable: vi.fn() },
}));
vi.mock('../../services/SettingsService', () => ({
    SettingsService: { getSetting: vi.fn(() => false) },
}));
vi.mock('../../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: vi.fn() }));
vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { appendLine: vi.fn(), append: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
        state: { wrapItemInStateHandling: (item: TreeElement): TreeElement => item },
    },
}));
vi.mock('../../tree/connections-view/LocalEmulators/LocalEmulatorsItem', () => ({ LocalEmulatorsItem: class {} }));
vi.mock('../../tree/connections-view/LocalQuickStart/LocalQuickStartItem', () => ({ LocalQuickStartItem: class {} }));

const originalUri = 'mongodb://old.example.com/';
const approvedUri = 'mongodb://new.mongocluster.cosmos.azure.com/';
const deleteCredentials = vi.spyOn(CredentialCache, 'deleteCredentials');

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
        ui: { showInputBox, showQuickPick },
    } as unknown as IActionContext;
}

function makeConnection(): ConnectionItem {
    return {
        id: 'stable-id',
        name: 'Saved connection',
        properties: {
            type: ItemType.Connection,
            api: API.DocumentDB,
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            selectedAuthMethod: AuthMethodId.ManagedIdentity,
        },
        secrets: { connectionString: originalUri, managedIdentityAuthConfig: {} },
    };
}

function makeItem(): DocumentDBClusterItem {
    return new DocumentDBClusterItem({
        treeId: 'connectionsView/folder/stable-id',
        clusterId: 'stable-id',
        storageId: 'stable-id',
        storageZone: ConnectionType.Clusters,
        name: 'Saved connection',
        dbExperience: DocumentDBExperience,
    } as TreeCluster<ConnectionClusterModel>);
}

describe('updateConnectionString rejected-destination recovery', () => {
    let provider: ConnectionsBranchDataProvider;
    let storedConnection: ConnectionItem;
    let item: DocumentDBClusterItem;

    beforeEach((): void => {
        CredentialCache.deleteCredentials('stable-id');
        vi.resetAllMocks();
        capturedContexts.length = 0;
        provider = new ConnectionsBranchDataProvider();
        ext.connectionsBranchDataProvider = provider;
        storedConnection = makeConnection();
        item = makeItem();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration);
        vi.mocked(ConnectionStorageService.get).mockImplementation(async () => structuredClone(storedConnection));
        vi.mocked(ConnectionStorageService.save).mockImplementation(async (_zone, connection): Promise<void> => {
            storedConnection = structuredClone(connection);
        });
        showInputBox.mockResolvedValue(approvedUri);
        showQuickPick.mockImplementation(async (items: Array<{ authMethod?: AuthMethodId }>) =>
            items.find((entry) => entry.authMethod === AuthMethodId.NoAuth),
        );
        CredentialCache.setAuthCredentials('stable-id', AuthMethodId.ManagedIdentity, originalUri);
        vi.mocked(ClustersClient.getClient).mockRejectedValue(
            new EntraDestinationRejectedError({ firstHost: 'old.example.com', hostCount: 1 }),
        );
    });

    it.each([
        [approvedUri, AuthMethodId.ManagedIdentity],
        ['mongodb://new.example.com/', AuthMethodId.NoAuth],
    ] as const)(
        'evicts rejected caches and failed children so retry uses edited %s and %s',
        async (newUri, expectedMethod): Promise<void> => {
            const failedChildren = await provider.getChildren(item);
            expect(provider.hasNodeErrorState(item.id)).toBe(true);
            expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
            const resetError = vi.spyOn(provider, 'resetNodeErrorState');
            const refresh = vi.spyOn(provider, 'refresh');
            showInputBox.mockResolvedValue(newUri);
            vi.mocked(ClustersClient.deleteClient).mockImplementation(async (): Promise<void> => {
                expect(storedConnection.secrets.connectionString).toBe(newUri);
                expect(provider.hasNodeErrorState(item.id)).toBe(true);
                expect(CredentialCache.hasCredentials('stable-id')).toBe(true);
            });

            await updateConnectionString(makeContext(), item);

            expect(capturedContexts[0].connectionStringSaved).toBe(true);
            expect(ClustersClient.deleteClient).toHaveBeenCalledExactlyOnceWith('stable-id');
            expect(deleteCredentials).toHaveBeenCalledExactlyOnceWith('stable-id');
            expect(resetError).toHaveBeenCalledExactlyOnceWith(item.id);
            expect(provider.hasNodeErrorState(item.id)).toBe(false);
            expect(CredentialCache.hasCredentials('stable-id')).toBe(false);
            expect(item.lastConnectionFailureReason).toBeUndefined();
            expect(item.lastConnectionOutcome).toBeUndefined();
            expect(vi.mocked(ConnectionStorageService.save).mock.invocationCallOrder[0]).toBeLessThan(
                vi.mocked(ClustersClient.deleteClient).mock.invocationCallOrder[0],
            );
            expect(deleteCredentials.mock.invocationCallOrder[0]).toBeLessThan(resetError.mock.invocationCallOrder[0]);
            expect(resetError.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
            const client = { listDatabases: vi.fn().mockResolvedValue([]), connectionCorrelationId: 'retry' };
            vi.mocked(ClustersClient.getClient).mockImplementation(async (clusterId): Promise<ClustersClient> => {
                expect(clusterId).toBe('stable-id');
                expect(CredentialCache.getCredentials(clusterId)).toMatchObject({
                    connectionString: newUri,
                    authMechanism: expectedMethod,
                });
                return client as unknown as ClustersClient;
            });

            const retriedChildren = await provider.getChildren(item);

            expect(retriedChildren).not.toEqual(failedChildren);
            expect(retriedChildren?.[0].id).toBe(`${item.id}/no-databases`);
            expect(item.lastConnectionOutcome).toBe('connected');
            expect(client.listDatabases).toHaveBeenCalledOnce();
            expect(showQuickPick).toHaveBeenCalledTimes(expectedMethod === AuthMethodId.NoAuth ? 1 : 0);
        },
    );

    it.each(['cancel', 'unchanged', 'missing storage', 'failed save'] as const)(
        'preserves caches and failed children after %s',
        async (outcome): Promise<void> => {
            const children = await provider.getChildren(item);
            const cachedCredentials = CredentialCache.getCredentials('stable-id');
            const resetError = vi.spyOn(provider, 'resetNodeErrorState');
            const refresh = vi.spyOn(provider, 'refresh');
            if (outcome === 'cancel') {
                showInputBox.mockRejectedValue(new UserCancelledError());
            } else if (outcome === 'unchanged') {
                showInputBox.mockResolvedValue(originalUri);
            } else if (outcome === 'missing storage') {
                vi.mocked(ConnectionStorageService.get)
                    .mockResolvedValueOnce(structuredClone(storedConnection))
                    .mockResolvedValueOnce(undefined);
            } else {
                vi.mocked(ConnectionStorageService.save).mockRejectedValue(new Error('save failed'));
            }

            const pending = updateConnectionString(makeContext(), item);
            if (outcome === 'cancel') {
                await expect(pending).rejects.toBeInstanceOf(UserCancelledError);
            } else {
                await expect(pending).resolves.toBeUndefined();
            }

            expect(capturedContexts[0].connectionStringSaved).toBe(false);
            expect(ClustersClient.deleteClient).not.toHaveBeenCalled();
            expect(deleteCredentials).not.toHaveBeenCalled();
            expect(resetError).not.toHaveBeenCalled();
            expect(refresh).toHaveBeenCalledTimes(outcome === 'cancel' ? 0 : 1);
            expect(CredentialCache.getCredentials('stable-id')).toBe(cachedCredentials);
            expect(provider.hasNodeErrorState(item.id)).toBe(true);
            expect(await provider.getChildren(item)).toEqual(children);
            expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
            expect(storedConnection.secrets.connectionString).toBe(originalUri);
        },
    );

    it('leaves the existing connected-edit lifecycle unchanged after a successful ordinary edit', async (): Promise<void> => {
        const resetError = vi.spyOn(provider, 'resetNodeErrorState');
        const refresh = vi.spyOn(provider, 'refresh');
        item.lastConnectionOutcome = 'connected';
        const cachedCredentials = CredentialCache.getCredentials('stable-id');

        await updateConnectionString(makeContext(), item);

        expect(capturedContexts[0].connectionStringSaved).toBe(true);
        expect(storedConnection.secrets.connectionString).toBe(approvedUri);
        expect(ClustersClient.deleteClient).not.toHaveBeenCalled();
        expect(deleteCredentials).not.toHaveBeenCalled();
        expect(resetError).not.toHaveBeenCalled();
        expect(CredentialCache.getCredentials('stable-id')).toBe(cachedCredentials);
        expect(item.lastConnectionOutcome).toBe('connected');
        expect(refresh).toHaveBeenCalledOnce();
    });
});
