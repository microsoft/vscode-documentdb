/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { classifyResolutionFailure } from '../../connectionDiagnostics/checks/resolveTarget';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { addEstablishedConnectionContext, ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { inferViewIdFromTreeId, Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { isQuickStartClusterId } from '../../services/localQuickStart/quickStartTypes';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { ConnectionSourceUnavailableError } from '../../tree/documentdb/diagnosticCredentialRead';
import { type TreeElement } from '../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExplicitReload } from '../../tree/TreeElementWithExplicitReload';

const containsDelimited = (fullContext: string | undefined, value: string): boolean => {
    if (!fullContext) {
        return false;
    }
    return new RegExp(`\\b${value}\\b`, 'i').test(fullContext);
};

type RetryableTreeNode = TreeElement &
    Partial<TreeElementWithContextValue & Pick<ClusterItemBase, 'lastConnectionFailureKind' | 'readReplacementKey'>> & {
        readonly cluster?: { readonly clusterId: string };
    };

function getViewId(node: RetryableTreeNode): Views | undefined {
    if (containsDelimited(node.contextValue, Views.ConnectionsView)) {
        return Views.ConnectionsView;
    }

    if (containsDelimited(node.contextValue, Views.DiscoveryView)) {
        return Views.DiscoveryView;
    }

    if (containsDelimited(node.contextValue, Views.AzureResourcesView)) {
        return Views.AzureResourcesView;
    }

    if (
        typeof node.id === 'string' &&
        (node.id.startsWith(Views.ConnectionsView) ||
            node.id.startsWith(Views.DiscoveryView) ||
            node.id.startsWith(Views.AzureResourcesView) ||
            node.id.startsWith(Views.AzureWorkspaceView))
    ) {
        return inferViewIdFromTreeId(node.id);
    }

    return undefined;
}

/**
 * The failed connection attempt this retry follows up on. The next `connect.startup` for the cluster
 * names the same attempt in `previousFailedStartupCorrelationId`, which shows whether the retry worked.
 */
function failedStartupCorrelationIdOf(node: RetryableTreeNode): string | undefined {
    const clusterId = (node as { cluster?: { clusterId?: unknown } }).cluster?.clusterId;
    return typeof clusterId === 'string' ? ClustersClient.getLastFailedStartupCorrelationId(clusterId) : undefined;
}

export async function retryAuthentication(context: IActionContext, node: RetryableTreeNode): Promise<void> {
    if (!node?.id) {
        throw new Error(l10n.t('No node selected.'));
    }

    const failedStartupCorrelationId = failedStartupCorrelationIdOf(node);
    if (failedStartupCorrelationId) {
        context.telemetry.properties.failedStartupCorrelationId = failedStartupCorrelationId;
    }

    const clusterId = node.cluster?.clusterId;
    if (clusterId) {
        let epoch = ClustersClient.getEpoch(clusterId);
        const latch = ClustersClient.getLatchReason(clusterId);
        const kind = latch === 'credentialsRejected' ? latch : node.lastConnectionFailureKind;
        if (latch && latch !== 'credentialsRejected') {
            return;
        }
        addEstablishedConnectionContext(context.telemetry, clusterId);
        if (kind) {
            context.telemetry.properties.connectionFailureKind = kind;
        }
        if (latch === 'credentialsRejected') {
            if (!node.readReplacementKey) {
                const view = getViewId(node);
                const credentials = CredentialCache.getCredentials(clusterId);
                const quickStart = view === Views.ConnectionsView && isQuickStartClusterId(clusterId);
                const nativeDiscovery =
                    (view === Views.DiscoveryView || view === Views.AzureResourcesView) &&
                    credentials !== undefined &&
                    (credentials.authMechanism ?? AuthMethodId.NativeAuth) === AuthMethodId.NativeAuth;
                if ((!quickStart && !nativeDiscovery) || !ClustersClient.clearCredentialRejection(clusterId, epoch)) {
                    return;
                }
                CredentialCache.deleteCredentials(clusterId);
                refreshAuthenticationNode(node);
                return;
            }
            context.telemetry.maskEntireErrorMessage = true;
            CredentialCache.deleteCredentials(clusterId);
            let credentials: Awaited<ReturnType<NonNullable<ClusterItemBase['readReplacementKey']>>>;
            try {
                credentials = await node.readReplacementKey(context);
            } catch (error) {
                if (ClustersClient.getEpoch(clusterId) !== epoch) {
                    return;
                }
                if (error instanceof UserCancelledError) {
                    throw error;
                }
                const finding = classifyResolutionFailure(new ConnectionSourceUnavailableError('azure', error));
                const signInNeeded =
                    finding.code === 'target.sourceInaccessible' && finding.data?.reason === 'signInRequired';
                context.telemetry.properties.azureKeyReadFailure = signInNeeded ? 'signInRequired' : 'other';
                context.errorHandling.suppressDisplay = true;
                void window.showErrorMessage(
                    signInNeeded
                        ? l10n.t('Azure sign-in needed')
                        : l10n.t('Could not read the database key from Azure.'),
                    {
                        modal: true,
                        detail: signInNeeded
                            ? l10n.t('Sign in to Azure and try Retry again.')
                            : l10n.t('Check access to the Azure resource and try again.'),
                    },
                );
                throw error;
            }
            if (ClustersClient.getEpoch(clusterId) !== epoch) {
                return;
            }
            // One fresh ARM read per explicit click. A subsequent database rejection re-latches in
            // the tree; it cannot start another ARM read.
            if (
                credentials.nativeAuthConfig?.connectionPassword &&
                ClustersClient.clearCredentialRejection(clusterId, epoch)
            ) {
                CredentialCache.setAuthCredentials(
                    clusterId,
                    AuthMethodId.NativeAuth,
                    credentials.connectionString,
                    credentials.nativeAuthConfig,
                );
            } else {
                return;
            }
        } else if (
            (kind === 'signInRequired' || kind === 'credentialsRejected' || kind === 'clientClosed') &&
            !ClustersClient.hasReusableClient(clusterId)
        ) {
            const closing = ClustersClient.deleteClient(clusterId);
            epoch = ClustersClient.getEpoch(clusterId);
            await closing;
            if (ClustersClient.getEpoch(clusterId) !== epoch) {
                return;
            }
        }
    }

    refreshAuthenticationNode(node);
}

export function refreshAuthenticationNode(node: RetryableTreeNode): void {
    const contextValue = node.contextValue;
    const viewId = getViewId(node);

    switch (viewId) {
        case Views.ConnectionsView:
            ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
            return ext.connectionsBranchDataProvider.refresh(node);

        case Views.DiscoveryView:
            if (isTreeElementWithExplicitReload(node)) {
                node.prepareExplicitReload();
            }
            ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
            return ext.discoveryBranchDataProvider.refresh(node);

        case Views.AzureResourcesView: {
            if (containsDelimited(contextValue, 'ruBranch')) {
                ext.azureResourcesRUBranchDataProvider.resetNodeErrorState(node.id);
                return ext.azureResourcesRUBranchDataProvider.refresh(node);
            }
            if (containsDelimited(contextValue, 'documentDbBranch')) {
                ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState(node.id);
                return ext.azureResourcesVCoreBranchDataProvider.refresh(node);
            }
            break;
        }
    }

    throw new Error(l10n.t('Unsupported view for an authentication retry.'));
}
