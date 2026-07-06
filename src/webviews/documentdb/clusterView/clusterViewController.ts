/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './clusterViewRouter';

/**
 * Initial configuration passed to the cluster dashboard webview. Read in the
 * React layer via `useConfiguration<ClusterViewWebviewConfigurationType>()`.
 */
export type ClusterViewWebviewConfigurationType = {
    /** Stable cluster identifier used for client/cache lookups. */
    clusterId: string;
    /** Human-readable cluster name for the dashboard header. */
    clusterDisplayName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * @see Views enum
     */
    viewId: string;
    /** The cluster's VS Code TreeView element id (used to refresh the tree). */
    clusterTreeId: string;
};

/**
 * Opens the cluster dashboard / home page webview. Hosts the database overview
 * and the per-database collection drill-in.
 */
export function openClusterWebview(
    initialData: ClusterViewWebviewConfigurationType,
): AppWebviewController<ClusterViewWebviewConfigurationType> {
    const title: string = initialData.clusterDisplayName;

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'clusterView',
        clusterId: initialData.clusterId,
        clusterDisplayName: initialData.clusterDisplayName,
        viewId: initialData.viewId,
        clusterTreeId: initialData.clusterTreeId,
    };

    return openAppWebview({
        title,
        webviewName: 'clusterView',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.One,
        icon: {
            light: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'resources',
                'icons',
                'vscode-documentdb-icon-light-themes.svg',
            ),
            dark: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'resources',
                'icons',
                'vscode-documentdb-icon-dark-themes.svg',
            ),
        },
    });
}
