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
import { ext } from '../../extensionVariables';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
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

    beforeEach(() => {
        vi.clearAllMocks();
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
        expect(node.readReplacementKey).toHaveBeenCalledTimes(1);
        expect(CredentialCache.setAuthCredentials).toHaveBeenCalledExactlyOnceWith(
            'ru',
            AuthMethodId.NativeAuth,
            'mongodb://test',
            nativeAuthConfig,
        );
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
    });

    it.each([
        ['discoveryView', AuthMethodId.NativeAuth, true],
        ['discoveryView', AuthMethodId.MicrosoftEntraID, false],
        ['connectionsView', AuthMethodId.NativeAuth, false],
    ] as const)(
        'allows the existing discovery credential setup only for Native auth (%s, %s)',
        async (view, authMechanism, shouldRefresh): Promise<void> => {
            const node = { id: `${view}/test`, cluster: { clusterId: 'test' }, getTreeItem };
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

    it('abandons a successful key read if the epoch changed', async (): Promise<void> => {
        const node = ruNode();
        node.readReplacementKey.mockResolvedValue({ connectionString: 'mongodb://test', availableAuthMethods: [] });
        vi.mocked(ClustersClient.getLatchReason).mockReturnValueOnce('credentialsRejected');
        vi.mocked(ClustersClient.getEpoch).mockReturnValueOnce(1).mockReturnValueOnce(2);
        await retryAuthentication(actionContext as never, node);
        expect(ClustersClient.clearCredentialRejection).not.toHaveBeenCalled();
        expect(CredentialCache.setAuthCredentials).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
    });

    it('does not refresh an old Retry after the client was replaced while its close was pending', async (): Promise<void> => {
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
        expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
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
});
