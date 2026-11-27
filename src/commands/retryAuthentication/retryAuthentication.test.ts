/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { window } from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DEFAULT_ALIAS, clusterId as quickStartClusterId } from '../../services/localQuickStart/quickStartTypes';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { retryAuthentication } from './retryAuthentication';

vi.mock('../../extensionVariables', () => ({
    ext: {
        connectionsBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        discoveryBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        azureResourcesRUBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        azureResourcesVCoreBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    addEstablishedConnectionContext: vi.fn(),
    ClustersClient: {
        getEpoch: vi.fn(() => 0),
        getLatchReason: vi.fn(),
        hasReusableClient: vi.fn(),
        clearCredentialRejection: vi.fn(),
        deleteClient: vi.fn(),
        getLastFailedStartupCorrelationId: vi.fn((clusterId: string) =>
            clusterId === 'failed-cluster' ? 'failed-attempt' : undefined,
        ),
    },
}));

vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { getCredentials: vi.fn(), deleteCredentials: vi.fn(), setAuthCredentials: vi.fn() },
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    l10n: {
        t: vi.fn((value: string) => value),
    },
    window: { showErrorMessage: vi.fn() },
}));

describe('retryAuthentication', () => {
    const actionContext = {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
    };
    const getTreeItem = vi.fn();

    function withRetryCapability<T extends { cluster: { clusterId: string } }>(
        node: T,
        viewId: Views,
    ): T & { cluster: { clusterId: string; viewId: Views }; canRetryRejectedCredentials(): boolean } {
        return {
            ...node,
            cluster: { ...node.cluster, viewId },
            canRetryRejectedCredentials: ClusterItemBase.prototype.canRetryRejectedCredentials,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.getEpoch).mockReturnValue(0);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        vi.mocked(CredentialCache.getCredentials).mockReset();
    });

    // The next connect.startup names the same attempt in previousFailedStartupCorrelationId.
    it('records the failed connection attempt a retry follows up on', async () => {
        const context = { telemetry: { properties: {} as Record<string, string>, measurements: {} } };
        const node = {
            id: 'connectionsView/failed-cluster',
            contextValue: 'connectionsView;treeItem_documentdbcluster',
            cluster: { clusterId: 'failed-cluster' },
            getTreeItem,
        };

        await retryAuthentication(context as never, node);

        expect(context.telemetry.properties.failedStartupCorrelationId).toBe('failed-attempt');
    });

    it('retries discovery nodes based on tree id when the context value lacks the view token', async () => {
        const node = {
            id: 'discoveryView/kubernetes-discovery/kind-documentdb-dev',
            contextValue: 'enableRefreshCommand;discoveryKubernetesContext',
            getTreeItem,
        };

        await retryAuthentication(actionContext as never, node);

        expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledWith(node);
        expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
    });

    it('continues to route Azure Resources retries by branch token', async () => {
        const node = {
            id: 'azureResourcesView/some-provider/resource',
            contextValue: 'azureResourcesView;documentDbBranch',
            getTreeItem,
        };

        await retryAuthentication(actionContext as never, node);

        expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(ext.azureResourcesVCoreBranchDataProvider.refresh).toHaveBeenCalledWith(node);
        expect(ext.azureResourcesRUBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
    });

    it('marks a Discovery node for an explicit reload before resetting or refreshing it', async () => {
        const node = {
            id: 'discoveryView/azure',
            getTreeItem,
            prepareExplicitReload: vi.fn(),
        };

        await retryAuthentication(actionContext as never, node);

        const { resetNodeErrorState, refresh } = ext.discoveryBranchDataProvider;
        expect(node.prepareExplicitReload).toHaveBeenCalledTimes(1);
        expect(node.prepareExplicitReload).toHaveBeenCalledBefore(vi.mocked(resetNodeErrorState));
        expect(resetNodeErrorState).toHaveBeenCalledBefore(vi.mocked(refresh));
        expect(resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(refresh).toHaveBeenCalledExactlyOnceWith(node);
    });

    it('throws for unsupported retry nodes', async () => {
        await expect(
            retryAuthentication(actionContext as never, {
                id: 'unknown/id',
                contextValue: 'enableRefreshCommand;unknown',
                getTreeItem,
            }),
        ).rejects.toThrow('Unsupported view for an authentication retry.');
    });

    function ruNode(): Parameters<typeof retryAuthentication>[1] & {
        readReplacementKey: ReturnType<typeof vi.fn<NonNullable<ClusterItemBase['readReplacementKey']>>>;
    } {
        return {
            id: 'discoveryView/azure/ru',
            cluster: { clusterId: 'ru' },
            getTreeItem,
            readReplacementKey: vi.fn<NonNullable<ClusterItemBase['readReplacementKey']>>(),
        };
    }

    it('discards the old RU key and installs the single replacement read', async (): Promise<void> => {
        const node = ruNode();
        const nativeAuthConfig = { connectionUser: 'test', connectionPassword: 'new-key' };
        node.readReplacementKey.mockResolvedValue({
            connectionString: 'mongodb://test',
            availableAuthMethods: [AuthMethodId.NativeAuth],
            nativeAuthConfig,
        });
        vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
        vi.mocked(ClustersClient.clearCredentialRejection).mockReturnValueOnce(true);

        await retryAuthentication(actionContext as never, node);

        expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith('ru');
        expect(CredentialCache.getCredentials).not.toHaveBeenCalled();
        expect(node.readReplacementKey).toHaveBeenCalledTimes(1);
        expect(CredentialCache.deleteCredentials).toHaveBeenCalledBefore(node.readReplacementKey);
        expect(node.readReplacementKey).toHaveBeenCalledBefore(vi.mocked(ClustersClient.clearCredentialRejection));
        expect(ClustersClient.clearCredentialRejection).toHaveBeenCalledExactlyOnceWith('ru', 0);
        expect(ClustersClient.clearCredentialRejection).toHaveBeenCalledBefore(
            vi.mocked(CredentialCache.setAuthCredentials),
        );
        expect(CredentialCache.setAuthCredentials).toHaveBeenCalledExactlyOnceWith(
            'ru',
            AuthMethodId.NativeAuth,
            'mongodb://test',
            nativeAuthConfig,
        );
        expect(CredentialCache.setAuthCredentials).toHaveBeenCalledBefore(
            vi.mocked(ext.discoveryBranchDataProvider.refresh),
        );
        expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledBefore(
            vi.mocked(ext.discoveryBranchDataProvider.refresh),
        );
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
    });

    it.each([
        [Views.DiscoveryView, AuthMethodId.NativeAuth, true],
        [Views.DiscoveryView, AuthMethodId.MicrosoftEntraID, false],
        [Views.ConnectionsView, AuthMethodId.NativeAuth, false],
    ] as const)(
        'allows the existing discovery credential setup only for Native auth (%s, %s)',
        async (view, authMechanism, shouldRefresh): Promise<void> => {
            const node = withRetryCapability({ id: `${view}/test`, cluster: { clusterId: 'test' }, getTreeItem }, view);
            vi.mocked(CredentialCache.getCredentials).mockReturnValueOnce({
                clusterId: 'test',
                connectionString: 'mongodb://test',
                authMechanism,
            });
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            if (shouldRefresh) {
                vi.mocked(ClustersClient.clearCredentialRejection).mockReturnValueOnce(true);
            }

            await retryAuthentication(actionContext as never, node);

            if (shouldRefresh) {
                expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith('test');
                expect(CredentialCache.deleteCredentials).toHaveBeenCalledBefore(
                    vi.mocked(ext.discoveryBranchDataProvider.refresh),
                );
                expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            } else {
                expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
                expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
                expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
                expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
            }
        },
    );

    it.each([
        [
            'native Azure Resources credentials',
            {
                id: '_subscriptions_test_resourceGroups_test_providers_Microsoft.DocumentDB_mongoClusters_native',
                contextValue: 'treeItem_documentdbcluster;documentDbBranch;azureResourcesView',
                cluster: { clusterId: 'native-resources' },
                getTreeItem,
            },
            {
                clusterId: 'native-resources',
                connectionString: 'mongodb://native-resources',
                authMechanism: AuthMethodId.NativeAuth,
            },
            'azureResources',
            Views.AzureResourcesView,
        ],
        [
            'implicit Native auth in Discovery',
            {
                id: 'discoveryView/azure/implicit-native',
                contextValue: 'treeItem_documentdbcluster;discoveryView',
                cluster: { clusterId: 'implicit-native' },
                getTreeItem,
            },
            {
                clusterId: 'implicit-native',
                connectionString: 'mongodb://implicit-native',
            },
            'discovery',
            Views.DiscoveryView,
        ],
        [
            'missing credentials in Discovery',
            {
                id: 'discoveryView/azure/missing-credentials',
                contextValue: 'treeItem_documentdbcluster;discoveryView',
                cluster: { clusterId: 'missing-credentials' },
                getTreeItem,
            },
            undefined,
            undefined,
            Views.DiscoveryView,
        ],
        [
            'native credentials in Azure Workspace',
            {
                id: 'azureWorkspaceView/native-resource',
                contextValue: 'treeItem_documentdbcluster;azureWorkspaceView',
                cluster: { clusterId: 'workspace-native' },
                getTreeItem,
            },
            {
                clusterId: 'workspace-native',
                connectionString: 'mongodb://workspace-native',
                authMechanism: AuthMethodId.NativeAuth,
            },
            undefined,
            Views.AzureWorkspaceView,
        ],
    ] as const)(
        'characterizes rejected credential recovery for %s',
        async (_description, nodeDefinition, credentials, refreshTarget, viewId): Promise<void> => {
            const node = withRetryCapability(nodeDefinition, viewId);
            vi.mocked(CredentialCache.getCredentials).mockReturnValueOnce(credentials);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            if (refreshTarget) {
                vi.mocked(ClustersClient.clearCredentialRejection).mockReturnValueOnce(true);
            }

            await retryAuthentication(actionContext as never, node);

            if (!refreshTarget) {
                expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
                expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
                expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
                expect(ClustersClient.deleteClient).not.toHaveBeenCalled();
                expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
                expect(ext.discoveryBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
                expect(ext.azureResourcesRUBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.azureResourcesRUBranchDataProvider.refresh).not.toHaveBeenCalled();
                expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.azureResourcesVCoreBranchDataProvider.refresh).not.toHaveBeenCalled();
                expect(window.showErrorMessage).not.toHaveBeenCalled();
                return;
            }

            expect(ClustersClient.clearCredentialRejection).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId, 0);
            expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith(node.cluster.clusterId);
            expect(ClustersClient.clearCredentialRejection).toHaveBeenCalledBefore(
                vi.mocked(CredentialCache.deleteCredentials),
            );

            if (refreshTarget === 'discovery') {
                expect(CredentialCache.deleteCredentials).toHaveBeenCalledBefore(
                    vi.mocked(ext.discoveryBranchDataProvider.resetNodeErrorState),
                );
                expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
                expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledBefore(
                    vi.mocked(ext.discoveryBranchDataProvider.refresh),
                );
                expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
                expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.azureResourcesVCoreBranchDataProvider.refresh).not.toHaveBeenCalled();
            } else {
                expect(CredentialCache.deleteCredentials).toHaveBeenCalledBefore(
                    vi.mocked(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState),
                );
                expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(
                    node.id,
                );
                expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).toHaveBeenCalledBefore(
                    vi.mocked(ext.azureResourcesVCoreBranchDataProvider.refresh),
                );
                expect(ext.azureResourcesVCoreBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
                expect(ext.discoveryBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
                expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
            }

            expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
            expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
            expect(ext.azureResourcesRUBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
            expect(ext.azureResourcesRUBranchDataProvider.refresh).not.toHaveBeenCalled();
            expect(window.showErrorMessage).not.toHaveBeenCalled();
        },
    );

    it.each([true, false])(
        'reloads Quick Start with an empty cache only if the rejection can be cleared (%s)',
        async (cleared): Promise<void> => {
            const clusterId = quickStartClusterId(DEFAULT_ALIAS);
            const node = withRetryCapability(
                { id: 'connectionsView/localQuickStart/instance', cluster: { clusterId }, getTreeItem },
                Views.ConnectionsView,
            );
            vi.mocked(ClustersClient.getEpoch).mockReturnValueOnce(7);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            vi.mocked(CredentialCache.getCredentials).mockReturnValueOnce(undefined);
            vi.mocked(ClustersClient.clearCredentialRejection).mockReturnValueOnce(cleared);

            await retryAuthentication(actionContext as never, node);

            expect(ClustersClient.clearCredentialRejection).toHaveBeenCalledExactlyOnceWith(clusterId, 7);
            if (cleared) {
                expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith(clusterId);
                expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            } else {
                expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
                expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
            }
        },
    );

    it('abandons a successful key read if the epoch changed', async (): Promise<void> => {
        const node = ruNode();
        node.readReplacementKey.mockResolvedValue({ connectionString: 'mongodb://test', availableAuthMethods: [] });
        vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
        vi.mocked(ClustersClient.getEpoch).mockReturnValueOnce(1).mockReturnValueOnce(2);
        await retryAuthentication(actionContext as never, node);
        expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
        expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
        expect(window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('refreshes without closing a healthy client that replaced the one that failed', async (): Promise<void> => {
        const node = {
            id: 'connectionsView/stale',
            cluster: { clusterId: 'stale' },
            getTreeItem,
            lastConnectionFailureKind: 'clientClosed' as const,
        };
        vi.mocked(ClustersClient.hasReusableClient).mockReturnValueOnce(true);

        await retryAuthentication(actionContext as never, node);

        expect(ClustersClient.deleteClient).not.toHaveBeenCalled();
        expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
    });

    it('refreshes an old Retry quietly after the client was replaced while its close was pending', async (): Promise<void> => {
        const node = {
            id: 'connectionsView/stale',
            cluster: { clusterId: 'stale' },
            getTreeItem,
            lastConnectionFailureKind: 'clientClosed' as const,
        };
        vi.mocked(ClustersClient.getEpoch).mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(2);
        vi.mocked(ClustersClient.deleteClient).mockResolvedValueOnce(undefined);

        await retryAuthentication(actionContext as never, node);

        expect(ClustersClient.deleteClient).toHaveBeenCalledExactlyOnceWith('stale');
        expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
        expect(window.showErrorMessage).not.toHaveBeenCalled();
    });

    it.each([new UserCancelledError(), Object.assign(new Error('ARM rejected access'), { statusCode: 401 })])(
        'distinguishes ARM sign-in failure from dismissal and keeps the rejection latch',
        async (error): Promise<void> => {
            const node = ruNode();
            node.readReplacementKey.mockRejectedValue(error);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            await expect(retryAuthentication(actionContext as never, node)).rejects.toBe(error);
            if (error instanceof UserCancelledError) {
                expect(window.showErrorMessage).not.toHaveBeenCalled();
            } else {
                expect(window.showErrorMessage).toHaveBeenCalledWith('Azure sign-in needed', expect.anything());
            }
            expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
            expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
        },
    );

    it.each(['connectionRemoved', 'credentialsChanged', 'identityChanged', 'userDisconnected'] as const)(
        'refreshes a stale Retry for %s without clearing another latch or doing auth work',
        async (reason): Promise<void> => {
            const node = ruNode();
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { suppressDisplay: false },
            };
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);

            await retryAuthentication(context as never, node);

            expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            if (reason === 'userDisconnected') {
                expect(window.showErrorMessage).not.toHaveBeenCalled();
            } else {
                expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledBefore(
                    vi.mocked(window.showErrorMessage),
                );
                expect(window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                    reason === 'connectionRemoved'
                        ? 'This connection was removed. Choose another connection.'
                        : 'This connection changed. Refresh the tree and try again.',
                    { modal: true },
                );
                expect(context.errorHandling.suppressDisplay).toBe(true);
            }
            expect(node.readReplacementKey).not.toHaveBeenCalled();
            expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
            expect(ClustersClient.deleteClient).not.toHaveBeenCalled();
            expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
            expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        },
    );

    it.each(['connectionRemoved', 'credentialsChanged', 'identityChanged', undefined] as const)(
        'discards a replacement key when %s supersedes the read',
        async (reason): Promise<void> => {
            const node = ruNode();
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            node.readReplacementKey.mockImplementationOnce(async () => {
                vi.mocked(ClustersClient.getEpoch).mockReturnValue(1);
                vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);
                return {
                    connectionString: 'mongodb://test',
                    availableAuthMethods: [AuthMethodId.NativeAuth],
                    nativeAuthConfig: { connectionUser: 'test', connectionPassword: 'replacement' },
                };
            });

            await retryAuthentication(actionContext as never, node);

            expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            if (reason) {
                expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledBefore(
                    vi.mocked(window.showErrorMessage),
                );
                expect(window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                    reason === 'connectionRemoved'
                        ? 'This connection was removed. Choose another connection.'
                        : 'This connection changed. Refresh the tree and try again.',
                    { modal: true },
                );
            } else {
                expect(window.showErrorMessage).not.toHaveBeenCalled();
            }
            expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
            expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
            expect(CredentialCache.deleteCredentials).toHaveBeenCalledExactlyOnceWith('ru');
            expect(node.readReplacementKey).toHaveBeenCalledTimes(1);
        },
    );

    it.each([false, true])(
        'refreshes a superseded failed key read with cancellation kept quiet (%s)',
        async (cancelled): Promise<void> => {
            const node = ruNode();
            vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
            node.readReplacementKey.mockImplementationOnce(async () => {
                vi.mocked(ClustersClient.getEpoch).mockReturnValue(1);
                vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');
                throw cancelled ? new UserCancelledError() : new Error('obsolete ARM failure');
            });

            await retryAuthentication(actionContext as never, node);

            expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            if (cancelled) {
                expect(window.showErrorMessage).not.toHaveBeenCalled();
            } else {
                expect(window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                    'This connection was removed. Choose another connection.',
                    { modal: true },
                );
            }
            expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
            expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        },
    );

    it.each(['connectionRemoved', 'credentialsChanged', 'identityChanged'] as const)(
        'refreshes and explains %s after an obsolete client close without closing again',
        async (reason): Promise<void> => {
            const node = {
                id: 'connectionsView/folder/stale',
                cluster: { clusterId: 'stale' },
                getTreeItem,
                lastConnectionFailureKind: 'clientClosed' as const,
            };
            vi.mocked(ClustersClient.hasReusableClient).mockReturnValueOnce(false);
            vi.mocked(ClustersClient.deleteClient).mockImplementationOnce(async () => {
                vi.mocked(ClustersClient.getEpoch).mockReturnValueOnce(0).mockReturnValueOnce(1);
                vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);
            });

            await retryAuthentication(actionContext as never, node);

            expect(ClustersClient.deleteClient).toHaveBeenCalledExactlyOnceWith('stale');
            expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
            expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledBefore(vi.mocked(window.showErrorMessage));
            expect(window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                reason === 'connectionRemoved'
                    ? 'This connection was removed. Choose another connection.'
                    : 'This connection changed. Refresh the tree and try again.',
                { modal: true },
            );
            expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
            expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
            expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        },
    );
});
