/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { EntraIdentityMismatchError } from '../../documentdb/auth/entraErrors/entraCallbackErrors';
import { getEntraSession } from '../../documentdb/auth/entraSession';
import { MicrosoftEntraIDAuthHandler } from '../../documentdb/auth/MicrosoftEntraIDAuthHandler';
import { classifyConnectionFailure } from '../../documentdb/connectionFailures';
import { addEstablishedConnectionContext, ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { showClusterConnectFailure } from '../../documentdb/showClusterConnectFailure';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';

function isSignInDismissal(error: unknown): boolean {
    return error instanceof UserCancelledError ||
        (error instanceof Error &&
            (error.name === 'Canceled' ||
                error.message === 'User did not consent to login.' ||
                ('errorCode' in error && error.errorCode === 'user_cancelled')));
}

export async function signInAgain(
    context: IActionContext,
    target: ClusterItemBase | { readonly clusterId: string },
): Promise<void> {
    const node = target && 'cluster' in target ? target : undefined;
    const clusterId = target && ('cluster' in target ? target.cluster.clusterId : target.clusterId);
    if (!clusterId) {
        throw new Error(vscode.l10n.t('No node selected.'));
    }
    const epoch = ClustersClient.getEpoch(clusterId);
    const reason = ClustersClient.getLatchReason(clusterId);
    if (reason && reason !== 'credentialsRejected') {
        return;
    }
    const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
    const credentials = CredentialCache.getCredentials(clusterId);
    if (identity?.kind !== 'entra' ||
        credentials?.authMechanism !== AuthMethodId.MicrosoftEntraID ||
        identity.tenantId !== credentials.entraIdConfig?.tenantId) {
        throw new Error(vscode.l10n.t('No verified Microsoft Entra ID connection is available to sign in again.'));
    }

    context.telemetry.maskEntireErrorMessage = true;
    context.errorHandling.suppressDisplay = true;
    addEstablishedConnectionContext(context.telemetry, clusterId);
    const isCurrent = (): boolean =>
        ClustersClient.getEpoch(clusterId) === epoch && CredentialCache.getCredentials(clusterId) === credentials;
    const reportClosed = (): void => {
        void vscode.window.showErrorMessage(vscode.l10n.t('The connection was closed while you were signing in.'), {
            modal: true,
        });
    };

    let starting = false;
    try {
        const handler = new MicrosoftEntraIDAuthHandler(credentials, { interactive: false, pinnedEntraIdentity: identity });
        const auth = await handler.configureAuth(undefined, undefined, async (request) => {
            if (!isCurrent()) {
                throw new UserCancelledError('signInAgain');
            }
            const session = await getEntraSession(request);
            if (!session || !isCurrent()) {
                throw new UserCancelledError('signInAgain');
            }
            if (session.account.id !== identity.accountId) {
                // VS Code only confirms account changes when the account *label* is different.
                // A same-label/different-ID session is not an explicit user choice.
                if (session.account.label === identity.accountLabel ||
                    (identity.providerId !== 'microsoft' && identity.providerId !== 'microsoft-sovereign-cloud')) {
                    throw new EntraIdentityMismatchError();
                }
            }
            return session;
        });
        if (!isCurrent()) {
            reportClosed();
            return;
        }
        starting = true;
        const startup = ClustersClient.startAfterSignIn(clusterId, epoch, credentials, auth);
        const startupEpoch = ClustersClient.getEpoch(clusterId);
        const client = await startup;
        if (!client || ClustersClient.getEpoch(clusterId) !== startupEpoch) {
            reportClosed();
            return;
        }
        if (ClustersClient.getExistingClient(clusterId) === client && !ClustersClient.getLatchReason(clusterId) && node) {
            refreshAuthenticationNode(node);
        }
    } catch (error) {
        if (!starting && !isCurrent()) {
            reportClosed();
            return;
        }
        if (isSignInDismissal(error)) {
            throw new UserCancelledError('signInAgain');
        }
        context.telemetry.properties.connectionFailureKind = classifyConnectionFailure(error, AuthMethodId.MicrosoftEntraID).kind;
        await showClusterConnectFailure({
            clusterId,
            clusterName: node?.cluster.name ?? vscode.l10n.t('connection'),
            fallbackHeading: vscode.l10n.t('Could not sign in again.'),
            error,
            context,
        });
        throw error;
    }
}
