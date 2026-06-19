/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { WebviewControllerBase } from '../../_integration/WebviewControllerBase';
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
 * Webview controller for the cluster dashboard / home page. Hosts the database
 * overview and the per-database collection drill-in.
 */
export class ClusterViewController extends WebviewControllerBase<ClusterViewWebviewConfigurationType> {
    constructor(initialData: ClusterViewWebviewConfigurationType) {
        const title: string = initialData.clusterDisplayName;

        super(ext.context, title, 'clusterView', initialData, vscode.ViewColumn.One, {
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
        });

        const trpcContext: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'clusterView',
            clusterId: initialData.clusterId,
            clusterDisplayName: initialData.clusterDisplayName,
            viewId: initialData.viewId,
            clusterTreeId: initialData.clusterTreeId,
        };

        this.setupTrpc(trpcContext);
    }
}
