/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { type ExtendedTreeDataProvider } from '../../../tree/ExtendedTreeDataProvider';
import { type TreeElement } from '../../../tree/TreeElement';

/**
 * The branch providers that can own a cluster shown by the dashboard.
 *
 * The Azure Resources view has two, and which one holds a given cluster is not knowable from
 * the `viewId` alone, so the caller tries them in order.
 */
function providersFor(viewId: string, clusterId: string): ExtendedTreeDataProvider<TreeElement>[] {
    if (viewId === (Views.ConnectionsView as string)) {
        return [ext.connectionsBranchDataProvider];
    }
    if (viewId === (Views.DiscoveryView as string)) {
        return [ext.discoveryBranchDataProvider];
    }
    if (viewId === (Views.AzureResourcesView as string)) {
        return [ext.azureResourcesVCoreBranchDataProvider, ext.azureResourcesRUBranchDataProvider];
    }

    // Same fallback the Collection View's import/export path uses: an Azure resource id is
    // sanitized and keeps its `_providers_` / `_subscriptions_` segments, so a cluster whose
    // `viewId` did not survive serialization can still be placed.
    const isAzureResource = clusterId.includes('_providers_') || clusterId.includes('_subscriptions_');

    return isAzureResource ? [ext.discoveryBranchDataProvider] : [ext.connectionsBranchDataProvider];
}

/** The tree node for the cluster identified by the dashboard's stable cluster id. */
export async function resolveClusterNode(viewId: string, clusterId: string): Promise<TreeElement | undefined> {
    for (const provider of providersFor(viewId, clusterId)) {
        const clusterNode = await provider.findClusterNodeByClusterId?.(clusterId);
        if (clusterNode) {
            return clusterNode;
        }
    }

    return undefined;
}

/**
 * The tree node for a database or a collection on the cluster this dashboard is pointed at.
 *
 * The dashboard reads its inventory straight from the server, so a row on screen is not
 * backed by a tree node the way a Collection View tab is. Every action offered on those rows
 * is an existing tree command, and those commands take a node — so the node has to be found
 * again from the stable `clusterId`, exactly as the Collection View does for import/export.
 *
 * Returns `undefined` when the branch has never been expanded, the connection has been
 * removed, or the database no longer exists. The caller reports that; it must not be
 * mistaken for the command having run.
 *
 * @param collectionName - Omit to resolve the database node itself.
 */
export async function resolveNamespaceNode(
    viewId: string,
    clusterId: string,
    databaseName: string,
    collectionName?: string,
): Promise<TreeElement | undefined> {
    for (const provider of providersFor(viewId, clusterId)) {
        if (collectionName !== undefined) {
            const collection = await provider.findCollectionByClusterId?.(clusterId, databaseName, collectionName);
            if (collection) {
                return collection;
            }
            continue;
        }

        // There is no `findDatabaseByClusterId`. The cluster node is resolvable, and a
        // database is its direct child under `<clusterTreeId>/<databaseName>` — the same path
        // shape every provider's collection lookup builds on.
        const clusterNode = await provider.findClusterNodeByClusterId?.(clusterId);
        if (!clusterNode?.id) {
            continue;
        }

        const database = await provider.findNodeById(`${clusterNode.id}/${databaseName}`, true);
        if (database) {
            return database;
        }
    }

    return undefined;
}

/**
 * The one sentence every unresolvable-node failure is reported with.
 *
 * The dashboard reads its inventory from the server, so it can prove a namespace exists,
 * render it, and offer commands for it while the tree — which those commands still take
 * their target from — has never materialized it. That is invisible from the row, so the
 * message has to name what is missing *and* which node to expand to supply it, rather than
 * saying only that something was not found.
 *
 * Shared by the row context-menu commands and by the create procedures so the same
 * precondition never gets two different explanations.
 *
 * @param databaseName - Omit when the cluster node itself is what could not be resolved.
 */
export function describeMissingNamespace(
    clusterDisplayName: string,
    databaseName?: string,
    collectionName?: string,
): string {
    if (databaseName === undefined) {
        return l10n.t(
            'This action works through the tree view, and the cluster "{cluster}" could not be found there. Make sure the connection is still listed in the tree view, then try again.',
            { cluster: clusterDisplayName },
        );
    }

    if (collectionName === undefined) {
        return l10n.t(
            'This action works through the tree view, and the database "{database}" is not loaded there yet. Expand the cluster "{cluster}" in the tree view, then try again.',
            { database: databaseName, cluster: clusterDisplayName },
        );
    }

    return l10n.t(
        'This action works through the tree view, and the collection "{collection}" is not loaded there yet. Expand "{cluster}" and then "{database}" in the tree view, then try again.',
        { collection: collectionName, cluster: clusterDisplayName, database: databaseName },
    );
}
