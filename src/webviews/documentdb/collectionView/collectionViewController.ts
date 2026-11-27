/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DeepLinkTelemetry } from '../../../deepLinks/deepLinkTelemetry';

import { ClusterSession } from '../../../documentdb/ClusterSession';
import { registerConnectionSurface } from '../../../documentdb/connectionSurfaces';
import { type ConnectionUnavailableReason } from '../../../documentdb/ConnectionUnavailableError';
import { type DocumentViewMode } from '../../../documentdb/DocumentViewMode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { LiveConfigService } from '../../../services/LiveConfigService';
import { SettingsService } from '../../../services/SettingsService';
import { settingsKeys } from '../../../settingsKeys';
import { type ConnectionUnavailableMessage } from '../../_integration/connectionUnavailable';
import { describeUnavailableConnection } from '../../_integration/describeUnavailableConnection';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { recoverBoundView } from '../boundViewOperations';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    sessionId: string;
    clusterId: string;
    /**
     * Human-readable cluster display name for Playground headers and Shell titles.
     */
    clusterDisplayName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * Required for finding the tree node during import/export operations.
     * @see Views enum
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
    initialDocumentView: DocumentViewMode;
    defaultPageSize: number;
    enableAIQueryGeneration: boolean;
    feedbackPermitted?: boolean;
    /** Pre-populated query from cross-feature navigation (e.g., Playground → Collection View). */
    initialQuery?: {
        filter?: string;
        project?: string;
        sort?: string;
        skip?: number;
        limit?: number;
    };
    /**
     * Optional tab to land on when the view opens. Defaults to `tab_result`
     * (the Documents tab). Used when the user double-clicks the "Indexes"
     * node in the tree so the Index Management tab is the first thing
     * they see.
     */
    initialTab?: 'tab_result' | 'tab_indexes' | 'tab_queryInsights';
};

export function openCollectionWebview(
    initialData: Omit<
        CollectionViewWebviewConfigurationType,
        'defaultPageSize' | 'enableAIQueryGeneration' | 'initialDocumentView'
    >,
    deepLink?: DeepLinkTelemetry,
    journeyCorrelationId?: string,
): AppWebviewController<CollectionViewWebviewConfigurationType> {
    const title: string = `${initialData.databaseName}/${initialData.collectionName}`;

    // Get the default page size from settings
    const defaultPageSize = SettingsService.getSetting<number>(settingsKeys.collectionViewDefaultPageSize) ?? 50;

    // Get the experimental AI query generation setting
    const enableAIQueryGeneration = SettingsService.getSetting<boolean>(settingsKeys.enableAIQueryGeneration) ?? false;

    const fullInitialData: CollectionViewWebviewConfigurationType = {
        ...initialData,
        initialDocumentView: LiveConfigService.getCollectionDocumentView(),
        defaultPageSize,
        enableAIQueryGeneration,
    };

    const binding = ClusterSession.getSession(initialData.sessionId).getBinding();

    const postUnavailable = (reason: ConnectionUnavailableReason): void => {
        const message: ConnectionUnavailableMessage = {
            type: 'collectionView.connectionUnavailable',
            unavailable: describeUnavailableConnection(reason).unavailable,
        };
        if (!controller.isDisposed) {
            void controller.panel.webview.postMessage(message);
        }
    };

    const trpcContext: RouterContext = {
        ...deepLink,
        dbExperience: API.DocumentDB,
        webviewName: 'collectionView',
        sessionId: initialData.sessionId,
        clusterId: initialData.clusterId,
        clusterDisplayName: initialData.clusterDisplayName,
        viewId: initialData.viewId,
        databaseName: initialData.databaseName,
        collectionName: initialData.collectionName,
        describeUnavailable: describeUnavailableConnection,
        recoverUnavailable: (request) =>
            recoverBoundView(binding, 'collectionView', () => controller.dispose(), request),
    };

    const controller: AppWebviewController<CollectionViewWebviewConfigurationType> = openAppWebview({
        title,
        webviewName: 'collectionView',
        panelViewType: 'vscode-documentdb-collection-view',
        config: fullInitialData,
        context: trpcContext,
        viewLoad: {
            kind: 'collectionView',
            correlation: {
                collectionSessionId: initialData.sessionId,
                viewId: initialData.viewId,
                initialTab: initialData.initialTab ?? 'tab_result',
                ...(journeyCorrelationId ? { journeyCorrelationId } : {}),
            },
        },
        viewColumn: vscode.ViewColumn.One,
        icon: {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-dark.svg'),
        },
    });

    const registration = registerConnectionSurface({
        clusterId: initialData.clusterId,
        kind: 'collectionView',
        disable: postUnavailable,
        dispose: () => controller.dispose(),
    });
    controller.onDisposed((): void => {
        registration.dispose();
    });

    return controller;
}
