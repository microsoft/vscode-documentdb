/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum Views {
    ConnectionsView = 'connectionsView', // do not change this value
    DiscoveryView = 'discoveryView', // do not change this value
    AzureResourcesView = 'azureResourcesView',
    AzureWorkspaceView = 'azureWorkspaceView',
    HelpAndFeedbackView = 'helpAndFeedbackView', // do not change this value

    /**
     * Note to future maintainers: do not modify these string constants.
     * They're used in the `package.json` file to register these views.
     *
     * The strings used in the `package.json` file must match the strings used here.
     * Otherwise views will not be registered correctly.
     */
}

/**
 * Infers the viewId from the treeId prefix.
 * This is a fallback for cases where viewId is not explicitly set on the cluster model.
 *
 * The treeId is prefixed with the view it belongs to (e.g., "connectionsView/..." or "discoveryView/...").
 * This function extracts the view prefix to determine which branch data provider owns the node.
 *
 * @param treeId - The tree item ID (e.g., "connectionsView/cluster-123/db/collection")
 * @returns The viewId corresponding to the treeId prefix
 */
export function inferViewIdFromTreeId(treeId: string): Views {
    if (treeId.startsWith(Views.ConnectionsView)) {
        return Views.ConnectionsView;
    } else if (treeId.startsWith(Views.DiscoveryView)) {
        return Views.DiscoveryView;
    } else if (treeId.startsWith(Views.AzureResourcesView)) {
        return Views.AzureResourcesView;
    } else if (treeId.startsWith(Views.AzureWorkspaceView)) {
        return Views.AzureWorkspaceView;
    }
    // Default fallback - this shouldn't happen in practice
    return Views.ConnectionsView;
}
