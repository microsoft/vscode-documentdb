/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type ClusterItemBase } from '../documentdb/ClusterItemBase';
import { type DatabaseItem } from '../documentdb/DatabaseItem';

export interface DiscoveryRevealRequest {
    readonly providerId: string;
    readonly subscriptionId: string;
    readonly azureResourceId: string;
    readonly displayName: string;
    readonly database?: string;
    readonly collection?: string;
}

export interface DiscoveryRevealResult {
    /** The cluster tree node. */
    readonly clusterNode: ClusterItemBase<AzureClusterModel>;
    /** The stable cluster id (cache key). */
    readonly clusterId: string;
    /** The database node when a database was requested, otherwise undefined. */
    readonly databaseNode?: DatabaseItem;
}

export async function waitForDiscoveryViewReady(context: IActionContext, maxAttempts: number = 5): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;
    let delay = 500;

    while (attempt < maxAttempts) {
        try {
            // The provider accepts an undefined root at runtime despite its required parameter type.
            const rootElements = await ext.discoveryBranchDataProvider.getChildren(undefined as never);
            if (rootElements !== undefined) {
                context.telemetry.measurements.discoveryViewActivationTimeMs = Date.now() - startTime;
                context.telemetry.measurements.discoveryViewActivationAttempts = attempt + 1;
                context.telemetry.properties.discoveryViewActivationResult = 'success';
                return;
            }
        } catch {
            // The view is not ready yet.
        }

        await new Promise<void>((resolve): void => {
            setTimeout(resolve, delay);
        });
        attempt++;
        delay = Math.min(delay * 1.5, 2000);
    }

    context.telemetry.measurements.discoveryViewActivationTimeMs = Date.now() - startTime;
    context.telemetry.measurements.discoveryViewActivationAttempts = maxAttempts;
    context.telemetry.properties.discoveryViewActivationResult = 'timeout';
}

/** Returns undefined when the cluster did not connect (the node already explained why). */
export async function revealInDiscoveryView(
    context: IActionContext,
    request: DiscoveryRevealRequest,
): Promise<DiscoveryRevealResult | undefined> {
    await vscode.commands.executeCommand(`${Views.DiscoveryView}.focus`);
    await waitForDiscoveryViewReady(context);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Opening {0}…', request.displayName),
            cancellable: false,
        },
        async (): Promise<DiscoveryRevealResult | undefined> => {
            return vscode.window.withProgress(
                { location: { viewId: Views.DiscoveryView }, cancellable: false },
                async (): Promise<DiscoveryRevealResult | undefined> => {
                    const provider = ext.discoveryBranchDataProvider;
                    const roots = await provider.getChildren(undefined as never);
                    const providerRoot = roots?.find((node): boolean => node.id.endsWith(`/${request.providerId}`));
                    const subscriptions = providerRoot ? await provider.getChildren(providerRoot) : undefined;
                    const subscriptionNode = subscriptions?.find((node): boolean =>
                        node.id.toLowerCase().endsWith(`/${request.subscriptionId.toLowerCase()}`),
                    );
                    const clusters = subscriptionNode ? await provider.getChildren(subscriptionNode) : undefined;
                    const clusterNode = clusters?.find(
                        (node): node is ClusterItemBase<AzureClusterModel> =>
                            'cluster' in node &&
                            typeof node.cluster === 'object' &&
                            node.cluster !== null &&
                            'azureResourceId' in node.cluster &&
                            typeof node.cluster.azureResourceId === 'string' &&
                            node.cluster.azureResourceId.toLowerCase() === request.azureResourceId.toLowerCase(),
                    );

                    if (!clusterNode) {
                        throw new Error(
                            vscode.l10n.t(
                                'Could not find {0} in the Discovery view. It may have been deleted, or a filter may still hide it.',
                                request.displayName,
                            ),
                        );
                    }

                    // Keep the node collapsed until the normal connect flow succeeds, so a cancel cannot be retried by expansion.
                    await ext.discoveryTreeView.reveal(clusterNode, { select: true, focus: false, expand: false });
                    const databases = await provider.getChildren(clusterNode);
                    const clusterId = clusterNode.cluster.clusterId;
                    if (!ClustersClient.exists(clusterId)) {
                        return undefined;
                    }

                    await ext.discoveryTreeView.reveal(clusterNode, {
                        select: true,
                        focus: !request.database,
                        expand: true,
                    });

                    let databaseNode: DatabaseItem | undefined;
                    if (request.database) {
                        databaseNode = databases?.find(
                            (node): node is DatabaseItem =>
                                'databaseInfo' in node &&
                                typeof node.databaseInfo === 'object' &&
                                node.databaseInfo !== null &&
                                'name' in node.databaseInfo &&
                                node.databaseInfo.name === request.database,
                        );
                        if (!databaseNode) {
                            throw new Error(
                                vscode.l10n.t(
                                    'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
                                ),
                            );
                        }

                        await ext.discoveryTreeView.reveal(databaseNode, {
                            select: true,
                            focus: !request.collection,
                            expand: true,
                        });

                        if (request.collection) {
                            const collections = await provider.getChildren(databaseNode);
                            const collectionNode = collections?.find(
                                (node): boolean =>
                                    'collectionInfo' in node &&
                                    typeof node.collectionInfo === 'object' &&
                                    node.collectionInfo !== null &&
                                    'name' in node.collectionInfo &&
                                    node.collectionInfo.name === request.collection,
                            );
                            if (!collectionNode) {
                                throw new Error(
                                    vscode.l10n.t(
                                        'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
                                    ),
                                );
                            }

                            await ext.discoveryTreeView.reveal(collectionNode, {
                                select: true,
                                focus: true,
                                expand: true,
                            });
                        }
                    }

                    return { clusterNode, clusterId, databaseNode };
                },
            );
        },
    );
}
