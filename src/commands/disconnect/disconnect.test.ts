/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { teardownConnection } from '../../documentdb/connectionTeardown';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';
import { connectDisconnected, disconnect } from './disconnect';

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { exists: vi.fn(), getLatchReason: vi.fn(), unlatch: vi.fn() },
}));
vi.mock('../../documentdb/connectionTeardown', () => ({ teardownConnection: vi.fn() }));
vi.mock('../../extensionVariables', () => ({ ext: { state: { notifyChildrenChanged: vi.fn() } } }));
vi.mock('../../tree/documentdb/ClusterItemBase', () => ({ ClusterItemBase: class {} }));
vi.mock('../retryAuthentication/retryAuthentication', () => ({ refreshAuthenticationNode: vi.fn() }));

function actionContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} }, errorHandling: {} } as IActionContext;
}

function clusterNode(viewId: Views = Views.ConnectionsView): ClusterItemBase {
    return Object.assign(Object.create(ClusterItemBase.prototype) as ClusterItemBase, {
        id: `${viewId}/folder/cluster`,
        contextValue: `${viewId};treeItem_documentdbcluster`,
        cluster: { clusterId: 'stable-cluster', treeId: `${viewId}/folder/cluster`, viewId },
    });
}

describe('tree disconnect recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.exists).mockReturnValue(true);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
    });

    it.each([disconnect, connectDisconnected])(
        '%s rejects removed or changed stale actions after refreshing once',
        async (command): Promise<void> => {
            for (const reason of ['connectionRemoved', 'credentialsChanged', 'identityChanged'] as const) {
                vi.clearAllMocks();
                vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);
                const context = actionContext();
                const node = clusterNode();

                await command(context, node);

                expect(ClustersClient.getLatchReason).toHaveBeenCalledWith('stable-cluster');
                expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
                expect(refreshAuthenticationNode).toHaveBeenCalledBefore(vi.mocked(vscode.window.showErrorMessage));
                expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                    reason === 'connectionRemoved'
                        ? 'This connection was removed. Choose another connection.'
                        : 'This connection changed. Refresh the tree and try again.',
                    { modal: true },
                );
                expect(context.errorHandling.suppressDisplay).toBe(true);
                expect(teardownConnection).not.toHaveBeenCalled();
                expect(ClustersClient.unlatch).not.toHaveBeenCalled();
                expect(ext.state.notifyChildrenChanged).not.toHaveBeenCalled();
            }
        },
    );

    it.each([undefined, 'credentialsRejected', 'userDisconnected'] as const)(
        'refreshes an obsolete Disconnect quietly for %s',
        async (reason): Promise<void> => {
            const node = clusterNode();
            vi.mocked(ClustersClient.exists).mockReturnValue(false);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);

            await disconnect(actionContext(), node);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(teardownConnection).not.toHaveBeenCalled();
            expect(ClustersClient.unlatch).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, 'credentialsRejected'] as const)(
        'refreshes an already completed or superseded Reconnect quietly for %s',
        (reason): void => {
            const node = clusterNode();
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);

            connectDisconnected(actionContext(), node);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(ClustersClient.unlatch).not.toHaveBeenCalled();
            expect(ext.state.notifyChildrenChanged).not.toHaveBeenCalled();
        },
    );

    it('disconnects the stable identity and delegates its single refresh to teardown', async (): Promise<void> => {
        const node = clusterNode();
        vi.mocked(teardownConnection).mockImplementationOnce(async (_clusterId, _reason, refresh): Promise<void> => {
            await refresh?.();
        });

        await disconnect(actionContext(), node);

        expect(teardownConnection).toHaveBeenCalledExactlyOnceWith(
            'stable-cluster',
            'userDisconnected',
            expect.any(Function),
        );
        expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('only clears the current user-disconnected latch when reconnecting', (): void => {
        const node = clusterNode();
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue('userDisconnected');

        connectDisconnected(actionContext(), node);

        expect(ClustersClient.unlatch).toHaveBeenCalledExactlyOnceWith('stable-cluster');
        expect(ext.state.notifyChildrenChanged).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(refreshAuthenticationNode).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it.each([disconnect, connectDisconnected])(
        '%s leaves unsupported stale Workspace nodes untouched',
        async (command): Promise<void> => {
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');

            if (command === disconnect) {
                await expect(command(actionContext(), clusterNode(Views.AzureWorkspaceView))).rejects.toBeInstanceOf(
                    UserCancelledError,
                );
            } else {
                await command(actionContext(), clusterNode(Views.AzureWorkspaceView));
            }

            expect(refreshAuthenticationNode).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(teardownConnection).not.toHaveBeenCalled();
            expect(ClustersClient.unlatch).not.toHaveBeenCalled();
        },
    );

    it('keeps an absent Disconnect selection cancelled without UI', async (): Promise<void> => {
        await expect(disconnect(actionContext())).rejects.toBeInstanceOf(UserCancelledError);
        expect(refreshAuthenticationNode).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
});
