/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
import { type RouterContext } from './clusterDashboardRouter';

export type ClusterDashboardWebviewConfigurationType = {
    /**
     * Stable cluster identifier used for client/credential lookups.
     * @see RouterContext.clusterId
     */
    clusterId: string;
    /** Human-readable cluster display name shown in the dashboard header. */
    clusterDisplayName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * @see Views enum
     */
    viewId: string;
    /** Polling cadence of the live health tiles, in milliseconds. */
    refreshIntervalMs: number;
};

/**
 * Open dashboard panels keyed by `clusterId`, so a second invocation reveals the
 * existing panel instead of opening a duplicate that would double the polling load.
 */
const openPanels = new Map<string, AppWebviewController<ClusterDashboardWebviewConfigurationType>>();

export function openClusterDashboardWebview(
    initialData: ClusterDashboardWebviewConfigurationType,
): AppWebviewController<ClusterDashboardWebviewConfigurationType> {
    const existingPanel = openPanels.get(initialData.clusterId);
    if (existingPanel && !existingPanel.isDisposed) {
        return existingPanel;
    }

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'clusterDashboard',
        clusterId: initialData.clusterId,
        clusterDisplayName: initialData.clusterDisplayName,
        viewId: initialData.viewId,
    };

    const controller = openAppWebview<ClusterDashboardWebviewConfigurationType>({
        title: l10n.t('Dashboard: {clusterDisplayName}', { clusterDisplayName: initialData.clusterDisplayName }),
        webviewName: 'clusterDashboard',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.One,
    });

    openPanels.set(initialData.clusterId, controller);
    controller.onDisposed(() => {
        if (openPanels.get(initialData.clusterId) === controller) {
            openPanels.delete(initialData.clusterId);
        }
    });

    return controller;
}
