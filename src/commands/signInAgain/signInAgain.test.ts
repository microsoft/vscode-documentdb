/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AuthCallerPolicy } from '../../documentdb/auth/authCallerPolicy';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
} from '../../documentdb/auth/entraErrors/entraCallbackErrors';
import { getEntraSession } from '../../documentdb/auth/entraSession';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { showClusterConnectFailure } from '../../documentdb/showClusterConnectFailure';
import { Views } from '../../documentdb/Views';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';
import { signInAgain, signInAgainForWorker } from './signInAgain';

const pin = {
    kind: 'entra',
    providerId: 'microsoft',
    accountId: 'pinned',
    accountLabel: 'Pinned',
    tenantId: 'tenant',
} as const;
const clusterId = 'cluster';
const mocks = vi.hoisted(() => ({
    configureAuth: vi.fn(),
    capturePolicy: vi.fn<(policy: AuthCallerPolicy) => void>(),
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    addEstablishedConnectionContext: vi.fn(),
    ClustersClient: {
        getEpoch: vi.fn(() => 1),
        getLatchReason: vi.fn(() => 'credentialsRejected'),
        getLastVerifiedIdentity: vi.fn(() => pin),
        startAfterSignIn: vi.fn(),
        getExistingClient: vi.fn(),
    },
}));
vi.mock('../../documentdb/auth/entraSession', () => ({ getEntraSession: vi.fn() }));
vi.mock('../../documentdb/auth/MicrosoftEntraIDAuthHandler', () => ({
    MicrosoftEntraIDAuthHandler: class {
        constructor(_credentials: unknown, policy: AuthCallerPolicy) {
            mocks.capturePolicy(policy);
        }

        public async configureAuth(
            _timings: undefined,
            _trace: undefined,
            acquire: typeof getEntraSession,
        ): Promise<unknown> {
            return await mocks.configureAuth(_timings, _trace, acquire);
        }
    },
}));
vi.mock('../retryAuthentication/retryAuthentication', () => ({ refreshAuthenticationNode: vi.fn() }));
vi.mock('../../documentdb/showClusterConnectFailure', () => ({ showClusterConnectFailure: vi.fn() }));

function actionContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} }, errorHandling: {} } as IActionContext;
}

describe('signInAgain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.getEpoch).mockReturnValue(1);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue('credentialsRejected');
        vi.mocked(ClustersClient.getLastVerifiedIdentity).mockReturnValue(pin);
        mocks.configureAuth.mockImplementation(
            async (_timings: undefined, _trace: undefined, acquire: typeof getEntraSession): Promise<unknown> => {
                const session = await acquire({
                    mode: 'forceNew',
                    providerId: pin.providerId,
                    resource: 'scope',
                    tenantId: pin.tenantId,
                    account: { id: pin.accountId, label: pin.accountLabel },
                });
                return { verifiedIdentity: { ...pin, accountId: session?.account.id } };
            },
        );
        CredentialCache.setAuthCredentials(
            clusterId,
            AuthMethodId.MicrosoftEntraID,
            'mongodb://test',
            undefined,
            undefined,
            { tenantId: pin.tenantId },
        );
    });

    it.each([
        { id: pin.accountId, label: pin.accountLabel },
        { id: 'different-account', label: 'Explicitly selected in VS Code' },
    ])('requests one pinned forced session and forwards the accepted account', async (account): Promise<void> => {
        vi.mocked(getEntraSession).mockResolvedValueOnce({ account } as vscode.AuthenticationSession);
        vi.mocked(ClustersClient.startAfterSignIn).mockResolvedValueOnce({} as ClustersClient);

        await signInAgain(actionContext(), { clusterId });

        expect(getEntraSession).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                mode: 'forceNew',
                tenantId: pin.tenantId,
                providerId: pin.providerId,
                account: { id: pin.accountId, label: pin.accountLabel },
            }),
        );
        expect(ClustersClient.startAfterSignIn).toHaveBeenCalledExactlyOnceWith(
            clusterId,
            1,
            CredentialCache.getCredentials(clusterId),
            { verifiedIdentity: expect.objectContaining({ accountId: account.id }) },
        );
    });

    it('observes renewal only for the client established by this sign-in', async (): Promise<void> => {
        vi.mocked(getEntraSession).mockResolvedValueOnce({
            account: { id: pin.accountId, label: pin.accountLabel },
        } as vscode.AuthenticationSession);
        const getTokenLookupEpoch = vi.fn<() => number | undefined>(() => 1);
        vi.mocked(ClustersClient.startAfterSignIn).mockImplementationOnce(async () => {
            const [policy] = mocks.capturePolicy.mock.lastCall!;
            expect(policy.getTokenLookupEpoch?.()).toBeUndefined();
            return { getTokenLookupEpoch } as unknown as ClustersClient;
        });

        await signInAgain(actionContext(), { clusterId });

        const [policy] = mocks.capturePolicy.mock.lastCall!;
        expect(policy.onTokenLookup).toBeTypeOf('function');
        expect(policy.getTokenLookupEpoch?.()).toBe(1);
        getTokenLookupEpoch.mockReturnValue(2);
        expect(policy.getTokenLookupEpoch?.()).toBe(2);
        getTokenLookupEpoch.mockReturnValue(undefined);
        expect(policy.getTokenLookupEpoch?.()).toBeUndefined();
    });

    it.each([undefined, new Error('User did not consent to login.')])(
        'dismisses without reconnecting or retrying session acquisition',
        async (error): Promise<void> => {
            if (error) {
                vi.mocked(getEntraSession).mockRejectedValueOnce(error);
            } else {
                vi.mocked(getEntraSession).mockResolvedValueOnce(undefined);
            }
            await expect(signInAgain(actionContext(), { clusterId })).rejects.toBeInstanceOf(UserCancelledError);
            expect(getEntraSession).toHaveBeenCalledTimes(1);
            expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        },
    );

    it('does not reconnect when the epoch changes during sign-in', async (): Promise<void> => {
        vi.mocked(getEntraSession).mockImplementationOnce(async () => {
            vi.mocked(ClustersClient.getEpoch).mockReturnValue(2);
            return { account: { id: pin.accountId, label: pin.accountLabel } } as vscode.AuthenticationSession;
        });
        await signInAgain(actionContext(), { clusterId });
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        vi.mocked(ClustersClient.getEpoch).mockReturnValue(1);
    });

    it('explains how to restore the pinned provider before opening an authorization prompt', async (): Promise<void> => {
        const error = new EntraSignInRequiredError('providerChanged');
        mocks.configureAuth.mockRejectedValueOnce(error);

        await expect(signInAgain(actionContext(), { clusterId })).rejects.toBe(error);

        expect(getEntraSession).not.toHaveBeenCalled();
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
        expect(showClusterConnectFailure).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            'The Azure cloud or sign-in provider changed.',
            {
                modal: true,
                detail: 'Restore "microsoft-sovereign-cloud.environment" to the setting used when this connection was established, then choose Retry sign-in. If it used the Azure public cloud, reset the setting.',
            },
        );
    });

    it('never installs a different-label account during worker recovery', async (): Promise<void> => {
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        vi.mocked(getEntraSession).mockResolvedValueOnce({
            account: { id: 'different-account', label: 'Different label' },
        } as vscode.AuthenticationSession);

        await expect(signInAgainForWorker(actionContext(), clusterId, pin)).rejects.toBeInstanceOf(
            EntraIdentityMismatchError,
        );

        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
        expect(showClusterConnectFailure).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('does not prompt when only the worker retains the identity pin', async (): Promise<void> => {
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        vi.mocked(ClustersClient.getLastVerifiedIdentity).mockReturnValue(undefined);
        await expect(signInAgainForWorker(actionContext(), clusterId, pin)).resolves.toBeUndefined();
        expect(getEntraSession).not.toHaveBeenCalled();
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
    });

    function treeNode(viewId: Views = Views.ConnectionsView): ClusterItemBase {
        return {
            id: `${viewId}/folder/cluster`,
            contextValue: `${viewId};treeItem_documentdbcluster`,
            cluster: { clusterId, treeId: `${viewId}/folder/cluster`, viewId, name: 'test' },
        } as ClusterItemBase;
    }

    it.each(['connectionRemoved', 'credentialsChanged', 'identityChanged'] as const)(
        'refreshes and explains an explicit stale tree sign-in for %s without auth work',
        async (reason): Promise<void> => {
            const context = actionContext();
            const node = treeNode();
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);

            await signInAgain(context, node);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expect(refreshAuthenticationNode).toHaveBeenCalledBefore(vi.mocked(vscode.window.showErrorMessage));
            expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                reason === 'connectionRemoved'
                    ? 'This connection was removed. Choose another connection.'
                    : 'This connection changed. Refresh the tree and try again.',
                { modal: true },
            );
            expect(context.errorHandling.suppressDisplay).toBe(true);
            expect(getEntraSession).not.toHaveBeenCalled();
            expect(mocks.configureAuth).not.toHaveBeenCalled();
            expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
            expect(showClusterConnectFailure).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['connectionRemoved', 'This connection was removed. Choose another connection.'],
        ['credentialsChanged', 'This connection changed. Refresh the tree and try again.'],
        ['identityChanged', 'This connection changed. Refresh the tree and try again.'],
        ['userDisconnected', 'The connection was closed while you were signing in.'],
    ] as const)(
        'refreshes before the accurate modal when %s supersedes a pending tree sign-in',
        async (reason, message): Promise<void> => {
            const node = treeNode();
            vi.mocked(getEntraSession).mockImplementationOnce(async () => {
                vi.mocked(ClustersClient.getEpoch).mockReturnValue(2);
                vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);
                return { account: { id: pin.accountId, label: pin.accountLabel } } as vscode.AuthenticationSession;
            });

            await signInAgain(actionContext(), node);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expect(refreshAuthenticationNode).toHaveBeenCalledBefore(vi.mocked(vscode.window.showErrorMessage));
            expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(message, { modal: true });
            expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
            expect(showClusterConnectFailure).not.toHaveBeenCalled();
        },
    );

    it('refreshes an epoch-only stale tree sign-in quietly', async (): Promise<void> => {
        const node = treeNode();
        vi.mocked(getEntraSession).mockImplementationOnce(async () => {
            vi.mocked(ClustersClient.getEpoch).mockReturnValue(2);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
            return { account: { id: pin.accountId, label: pin.accountLabel } } as vscode.AuthenticationSession;
        });

        await signInAgain(actionContext(), node);

        expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
    });

    it('refreshes an already disconnected tree sign-in quietly', async (): Promise<void> => {
        const node = treeNode();
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue('userDisconnected');

        await signInAgain(actionContext(), node);

        expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(getEntraSession).not.toHaveBeenCalled();
    });

    it('does not refresh or show a stale modal for an unsupported Workspace node', async (): Promise<void> => {
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');

        await signInAgain(actionContext(), treeNode(Views.AzureWorkspaceView));

        expect(refreshAuthenticationNode).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(getEntraSession).not.toHaveBeenCalled();
    });

    it.each([
        [Views.DiscoveryView, 'discoveryView;treeItem_documentdbcluster'],
        [Views.AzureResourcesView, 'azureResourcesView;ruBranch;treeItem_documentdbcluster'],
        [Views.AzureResourcesView, 'azureResourcesView;documentDbBranch;treeItem_documentdbcluster'],
    ] as const)(
        'refreshes eligible stale nodes using their existing %s routing tags (%s)',
        async (viewId, contextValue): Promise<void> => {
            const node = Object.assign(treeNode(viewId), { contextValue });
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');

            await signInAgain(actionContext(), node);

            expect(refreshAuthenticationNode).toHaveBeenCalledExactlyOnceWith(node);
            expect(refreshAuthenticationNode).toHaveBeenCalledBefore(vi.mocked(vscode.window.showErrorMessage));
            expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                'This connection was removed. Choose another connection.',
                { modal: true },
            );
            expect(getEntraSession).not.toHaveBeenCalled();
            expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
        },
    );

    it('propagates an unexpected stale refresh failure without a second refresh or modal', async (): Promise<void> => {
        const error = new Error('refresh failed');
        vi.mocked(refreshAuthenticationNode).mockImplementationOnce(() => {
            throw error;
        });
        vi.mocked(getEntraSession).mockImplementationOnce(async () => {
            vi.mocked(ClustersClient.getEpoch).mockReturnValue(2);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');
            return { account: { id: pin.accountId, label: pin.accountLabel } } as vscode.AuthenticationSession;
        });

        await expect(signInAgain(actionContext(), treeNode())).rejects.toBe(error);

        expect(refreshAuthenticationNode).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(showClusterConnectFailure).not.toHaveBeenCalled();
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
    });

    it.each(['connectionRemoved', 'credentialsChanged', 'identityChanged', 'userDisconnected'] as const)(
        'keeps stale worker recovery quiet for %s',
        async (reason): Promise<void> => {
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(reason);

            await expect(signInAgainForWorker(actionContext(), clusterId, pin)).resolves.toBeUndefined();

            expect(refreshAuthenticationNode).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(getEntraSession).not.toHaveBeenCalled();
            expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
        },
    );

    it('keeps an obsolete pending worker sign-in quiet without restarting', async (): Promise<void> => {
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        vi.mocked(getEntraSession).mockImplementationOnce(async () => {
            vi.mocked(ClustersClient.getEpoch).mockReturnValue(2);
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue('connectionRemoved');
            return { account: { id: pin.accountId, label: pin.accountLabel } } as vscode.AuthenticationSession;
        });

        await expect(signInAgainForWorker(actionContext(), clusterId, pin)).resolves.toBeUndefined();

        expect(refreshAuthenticationNode).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(showClusterConnectFailure).not.toHaveBeenCalled();
        expect(ClustersClient.startAfterSignIn).not.toHaveBeenCalled();
    });
});
