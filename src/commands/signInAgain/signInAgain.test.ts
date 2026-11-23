/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { getEntraSession } from '../../documentdb/auth/entraSession';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { signInAgain } from './signInAgain';

const pin = {
    kind: 'entra',
    providerId: 'microsoft',
    accountId: 'pinned',
    accountLabel: 'Pinned',
    tenantId: 'tenant',
} as const;
const clusterId = 'cluster';

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
        public async configureAuth(
            _timings: undefined,
            _trace: undefined,
            acquire: typeof getEntraSession,
        ): Promise<unknown> {
            const session = await acquire({
                mode: 'forceNew',
                providerId: pin.providerId,
                resource: 'scope',
                tenantId: pin.tenantId,
                account: { id: pin.accountId, label: pin.accountLabel },
            });
            return { verifiedIdentity: { ...pin, accountId: session?.account.id } };
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
});
