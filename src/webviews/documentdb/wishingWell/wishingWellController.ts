/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { getWishingWell } from '../../../services/wishingWell/wishingWell';
import { type WishCluster } from '../../../services/wishingWell/wishScope';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './wishingWellRouter';
import { type WishingWellWebviewConfig } from './wishingWellTypes';

export interface WishingWellOpenScope extends WishCluster {
    readonly databaseName?: string;
    readonly collectionName?: string;
}

/** One well per scope: opening it again on the same cluster and database reveals the open one. */
const openPanels = new Map<string, AppWebviewController<WishingWellWebviewConfig>>();

export function openWishingWellWebview(cluster?: WishingWellOpenScope): void {
    const key = cluster
        ? [cluster.clusterId, cluster.databaseName ?? '', cluster.collectionName ?? ''].join('\u0000')
        : '';
    const existing = openPanels.get(key);
    if (existing && !existing.isDisposed) {
        existing.revealToForeground();
        return;
    }

    const context: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'wishingWell',
        scope: cluster
            ? {
                  cluster: {
                      clusterId: cluster.clusterId,
                      clusterDisplayName: cluster.clusterDisplayName,
                      viewId: cluster.viewId,
                  },
                  databaseName: cluster.databaseName,
                  collectionName: cluster.collectionName,
              }
            : {},
        well: getWishingWell(),
    };

    const title = cluster
        ? vscode.l10n.t(
              'Wishing Well: {0}',
              cluster.collectionName ?? cluster.databaseName ?? cluster.clusterDisplayName,
          )
        : vscode.l10n.t('Wishing Well');

    const controller = openAppWebview<WishingWellWebviewConfig>({
        title,
        webviewName: 'wishingWell',
        panelViewType: 'vscode-documentdb-wishing-well',
        config: {
            clusterDisplayName: cluster?.clusterDisplayName,
            databaseName: cluster?.databaseName,
            collectionName: cluster?.collectionName,
        },
        context,
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

    openPanels.set(key, controller);
    controller.onDisposed(() => {
        if (openPanels.get(key) === controller) {
            openPanels.delete(key);
        }
    });
}
