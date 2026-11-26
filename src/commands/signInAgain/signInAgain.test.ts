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
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'The connection was closed while you were signing in.',
            { modal: true },
        );
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
});
