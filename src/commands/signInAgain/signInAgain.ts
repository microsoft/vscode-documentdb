/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type VerifiedEntraIdentity } from '../../documentdb/auth/AuthHandler';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
} from '../../documentdb/auth/entraErrors/entraCallbackErrors';
import { getEntraSession } from '../../documentdb/auth/entraSession';
import { MicrosoftEntraIDAuthHandler } from '../../documentdb/auth/MicrosoftEntraIDAuthHandler';
import { sameEntraIdentity } from '../../documentdb/auth/WorkerTokenRelay';
import { addEstablishedConnectionContext, ClustersClient } from '../../documentdb/ClustersClient';
import { classifyConnectionFailure } from '../../documentdb/connectionFailures';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { showClusterConnectFailure } from '../../documentdb/showClusterConnectFailure';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';

interface WorkerSignInResult {
    readonly identity: VerifiedEntraIdentity;
    readonly epoch: number;
}

export function canSignInAgainForWorker(clusterId: string, expectedIdentity: VerifiedEntraIdentity): boolean {
    const credentials = CredentialCache.getCredentials(clusterId);
    const hostIdentity = ClustersClient.getLastVerifiedIdentity(clusterId);
    return (
        ClustersClient.getLatchReason(clusterId) === undefined &&
        credentials?.authMechanism === AuthMethodId.MicrosoftEntraID &&
        credentials.entraIdConfig?.tenantId === expectedIdentity.tenantId &&
        (hostIdentity === undefined ||
            (hostIdentity.kind === 'entra' && sameEntraIdentity(hostIdentity, expectedIdentity)))
    );
}

function isSignInDismissal(error: unknown): boolean {
    return (
        error instanceof UserCancelledError ||
        (error instanceof Error &&
            (error.name === 'Canceled' ||
                error.message === 'User did not consent to login.' ||
                ('errorCode' in error && error.errorCode === 'user_cancelled')))
    );
}

export async function signInAgain(
    context: IActionContext,
    target: ClusterItemBase | { readonly clusterId: string },
): Promise<void> {
    await signInAgainInternal(context, target);
}

/**
 * Recover only the exact identity pinned by a shell or playground worker.
 *
 * Unlike the tree command, this path never accepts a different account selected
 * by VS Code, even when its label differs.
 */
export async function signInAgainForWorker(
    context: IActionContext,
    clusterId: string,
    expectedIdentity: VerifiedEntraIdentity,
): Promise<WorkerSignInResult | undefined> {
    if (!canSignInAgainForWorker(clusterId, expectedIdentity)) {
        return undefined;
    }
    return signInAgainInternal(context, { clusterId }, expectedIdentity);
}

async function signInAgainInternal(
    context: IActionContext,
    target: ClusterItemBase | { readonly clusterId: string },
    expectedIdentity?: VerifiedEntraIdentity,
): Promise<WorkerSignInResult | undefined> {
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
    const storedIdentity = ClustersClient.getLastVerifiedIdentity(clusterId);
    const identity = expectedIdentity ?? storedIdentity;
    const credentials = CredentialCache.getCredentials(clusterId);
    if (
        identity?.kind !== 'entra' ||
        credentials?.authMechanism !== AuthMethodId.MicrosoftEntraID ||
        identity.tenantId !== credentials.entraIdConfig?.tenantId
    ) {
        throw new Error(vscode.l10n.t('No verified Microsoft Entra ID connection is available to sign in again.'));
    }

    context.telemetry.maskEntireErrorMessage = true;
    context.errorHandling.suppressDisplay = true;
    addEstablishedConnectionContext(context.telemetry, clusterId);
    const isCurrent = (): boolean => {
        if (ClustersClient.getEpoch(clusterId) !== epoch || CredentialCache.getCredentials(clusterId) !== credentials) {
            return false;
        }
        if (!expectedIdentity) {
            return true;
        }
        const currentIdentity = ClustersClient.getLastVerifiedIdentity(clusterId);
        return (
            currentIdentity === undefined ||
            (currentIdentity.kind === 'entra' && sameEntraIdentity(currentIdentity, expectedIdentity))
        );
    };
    const reportClosed = (): void => {
        if (!expectedIdentity) {
            void vscode.window.showErrorMessage(vscode.l10n.t('The connection was closed while you were signing in.'), {
                modal: true,
            });
        }
    };

    let starting = false;
    try {
        const handler = new MicrosoftEntraIDAuthHandler(credentials, {
            interactive: false,
            pinnedEntraIdentity: identity,
        });
        const auth = await handler.configureAuth(undefined, undefined, async (request) => {
            if (!isCurrent()) {
                throw new UserCancelledError('signInAgain');
            }
            const session = await getEntraSession(request);
            if (!session || !isCurrent()) {
                throw new UserCancelledError('signInAgain');
            }
            if (session.account.id !== identity.accountId) {
                if (expectedIdentity) {
                    throw new EntraIdentityMismatchError();
                }
                // VS Code only confirms account changes when the account *label* is different.
                // A same-label/different-ID session is not an explicit user choice.
                if (
                    session.account.label === identity.accountLabel ||
                    (identity.providerId !== 'microsoft' && identity.providerId !== 'microsoft-sovereign-cloud')
                ) {
                    throw new EntraIdentityMismatchError();
                }
            }
            return session;
        });
        if (
            expectedIdentity &&
            (auth.verifiedIdentity?.kind !== 'entra' || !sameEntraIdentity(auth.verifiedIdentity, expectedIdentity))
        ) {
            throw new EntraIdentityMismatchError();
        }
        if (!isCurrent()) {
            reportClosed();
            return undefined;
        }
        starting = true;
        const startup = ClustersClient.startAfterSignIn(clusterId, epoch, credentials, auth);
        const startupEpoch = ClustersClient.getEpoch(clusterId);
        const client = await startup;
        if (!client || ClustersClient.getEpoch(clusterId) !== startupEpoch) {
            reportClosed();
            return undefined;
        }
        if (
            ClustersClient.getExistingClient(clusterId) === client &&
            !ClustersClient.getLatchReason(clusterId) &&
            node
        ) {
            refreshAuthenticationNode(node);
        }
        return auth.verifiedIdentity ? { identity: auth.verifiedIdentity, epoch: startupEpoch } : undefined;
    } catch (error) {
        if (!starting && !isCurrent()) {
            reportClosed();
            return undefined;
        }
        if (isSignInDismissal(error)) {
            throw new UserCancelledError('signInAgain');
        }
        context.telemetry.properties.connectionFailureKind = classifyConnectionFailure(
            error,
            AuthMethodId.MicrosoftEntraID,
        ).kind;
        if (error instanceof EntraSignInRequiredError && error.reason === 'providerChanged') {
            if (!expectedIdentity) {
                await vscode.window.showErrorMessage(vscode.l10n.t('The Azure cloud or sign-in provider changed.'), {
                    modal: true,
                    detail: vscode.l10n.t(
                        'Restore "microsoft-sovereign-cloud.environment" to the setting used when this connection was established, then choose Retry sign-in. If it used the Azure public cloud, reset the setting.',
                    ),
                });
            }
            throw error;
        }
        if (!expectedIdentity) {
            await showClusterConnectFailure({
                clusterId,
                clusterName: node?.cluster.name ?? vscode.l10n.t('connection'),
                fallbackHeading: vscode.l10n.t('Could not sign in again.'),
                error,
                context,
            });
        }
        throw error;
    }
}
