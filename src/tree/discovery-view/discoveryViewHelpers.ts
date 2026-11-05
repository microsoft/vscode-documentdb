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
                ext.outputChannel.trace(`[DeepLink] Discovery view ready: attempts=${attempt + 1}`);
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
    ext.outputChannel.trace(`[DeepLink] Discovery view timed out: attempts=${maxAttempts}`);
}

/** Returns undefined when the cluster did not connect (the node already explained why). */
export async function revealInDiscoveryView(
    context: IActionContext,
    request: DiscoveryRevealRequest,
    report?: (message: string) => void,
): Promise<DiscoveryRevealResult | undefined> {
    report?.(vscode.l10n.t('Finding the cluster in the Discovery view…'));
    ext.outputChannel.trace('[DeepLink] Focusing the Discovery view');
    await vscode.commands.executeCommand(`${Views.DiscoveryView}.focus`);
    await waitForDiscoveryViewReady(context);

    return vscode.window.withProgress(
        { location: { viewId: Views.DiscoveryView }, cancellable: false },
        async (): Promise<DiscoveryRevealResult | undefined> => {
            const provider = ext.discoveryBranchDataProvider;
            ext.outputChannel.trace('[DeepLink] Looking up the Discovery provider root');
            const roots = await provider.getChildren(undefined as never);
            const providerRoot = roots?.find((node): boolean => node.id.endsWith(`/${request.providerId}`));
            ext.outputChannel.trace('[DeepLink] Looking up the subscription node');
            const subscriptions = providerRoot ? await provider.getChildren(providerRoot) : undefined;
            const subscriptionNode = subscriptions?.find((node): boolean =>
                node.id.toLowerCase().endsWith(`/${request.subscriptionId.toLowerCase()}`),
            );
            ext.outputChannel.trace('[DeepLink] Looking up the cluster node');
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

            ext.outputChannel.trace(`[DeepLink] Cluster node ${clusterNode ? 'found' : 'not found'}`);
            if (!clusterNode) {
                throw new Error(
                    vscode.l10n.t(
                        'Could not find {0} in the Discovery view. It may have been deleted, or a filter may still hide it.',
                        request.displayName,
                    ),
                );
            }

            ext.outputChannel.trace('[DeepLink] Revealing and expanding the cluster');
            // Reveal with expand awaits the node's children, so the connect flow runs once through expansion.
            report?.(vscode.l10n.t('Connecting…'));
            await ext.discoveryTreeView.reveal(clusterNode, {
                select: true,
                focus: !request.database,
                expand: true,
            });
            const clusterId = clusterNode.cluster.clusterId;
            const connected = ClustersClient.exists(clusterId);
            ext.outputChannel.trace(`[DeepLink] Cluster ${connected ? 'connected' : 'not connected'}`);
            if (!connected) {
                return undefined;
            }

            let databaseNode: DatabaseItem | undefined;
            if (request.database) {
                report?.(vscode.l10n.t('Opening the database…'));
                ext.outputChannel.trace(`[DeepLink] Looking up database ${request.database}`);
                const node = await provider.findNodeById(`${clusterNode.id}/${request.database}`);
                if (
                    !node ||
                    !('databaseInfo' in node) ||
                    typeof node.databaseInfo !== 'object' ||
                    node.databaseInfo === null ||
                    !('name' in node.databaseInfo) ||
                    node.databaseInfo.name !== request.database
                ) {
                    ext.outputChannel.trace('[DeepLink] Database not found');
                    throw new Error(
                        vscode.l10n.t(
                            'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
                        ),
                    );
                }

                databaseNode = node as DatabaseItem;
                ext.outputChannel.trace(`[DeepLink] Revealing database ${request.database}`);
                await ext.discoveryTreeView.reveal(databaseNode, {
                    select: true,
                    focus: !request.collection,
                    expand: true,
                });

                if (request.collection) {
                    report?.(vscode.l10n.t('Opening the collection…'));
                    ext.outputChannel.trace(`[DeepLink] Looking up collection ${request.collection}`);
                    const collectionNode = await provider.findNodeById(
                        `${databaseNode.id}/${request.collection}`,
                    );
                    if (!collectionNode) {
                        ext.outputChannel.trace('[DeepLink] Collection not found');
                        throw new Error(
                            vscode.l10n.t(
                                'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
                            ),
                        );
                    }

                    ext.outputChannel.trace(`[DeepLink] Revealing collection ${request.collection}`);
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
}
