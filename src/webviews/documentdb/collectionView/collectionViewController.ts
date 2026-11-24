/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type DeepLinkTelemetry } from '../../../deepLinks/deepLinkTelemetry';

import { AuthMethodId } from '../../../documentdb/auth/AuthMethodId';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { ClusterSession } from '../../../documentdb/ClusterSession';
import { ConnectionUnavailableError, type ConnectionUnavailableReason } from '../../../documentdb/ConnectionUnavailableError';
import { registerConnectionSurface } from '../../../documentdb/connectionSurfaces';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { SettingsService } from '../../../services/SettingsService';
import { settingsKeys } from '../../../settingsKeys';
import {
    type ConnectionRecoveryRequest,
    type ConnectionRecoveryResponse,
    type ConnectionUnavailableMessage,
    type ConnectionUnavailableResponse,
} from '../../_integration/connectionUnavailable';
import { describeUnavailableConnection } from '../../_integration/describeUnavailableConnection';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
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

function canRetrySignIn(clusterId: string): boolean {
    const credentials = CredentialCache.getCredentials(clusterId);
    const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
    return (
        credentials?.authMechanism === AuthMethodId.MicrosoftEntraID &&
        identity?.kind === 'entra' &&
        identity.tenantId === credentials.entraIdConfig?.tenantId
    );
}

function identityLabel(clusterId: string): string {
    const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
    switch (identity?.kind) {
        case 'entra':
            return identity.accountLabel;
        case 'native':
            return identity.username;
        case 'managedIdentity':
            return identity.clientId ?? vscode.l10n.t('managed identity');
        case 'none':
            return vscode.l10n.t('no authentication');
        default:
            return vscode.l10n.t('connection');
    }
}

export function openCollectionWebview(
    initialData: Omit<CollectionViewWebviewConfigurationType, 'defaultPageSize' | 'enableAIQueryGeneration'>,
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
        defaultPageSize,
        enableAIQueryGeneration,
    };

    const session = ClusterSession.getSession(initialData.sessionId);
    const describeUnavailable = (reason: ConnectionUnavailableReason): ConnectionUnavailableResponse => {
        const original = session.getBinding();
        const current = ClustersClient.getBinding(initialData.clusterId);
        const canReconnect =
            reason === 'identityChanged' || reason === 'credentialsChanged'
                ? current !== undefined && current.fingerprint !== original.fingerprint
                : reason === 'userDisconnected' || reason === 'unreachable';
        activeUnavailable = describeUnavailableConnection(reason, {
            canRetrySignIn: canRetrySignIn(initialData.clusterId),
            canUpdateCredentials: false,
            canReconnect,
        });
        return activeUnavailable;
    };

    let controller: AppWebviewController<CollectionViewWebviewConfigurationType>;
    let activeUnavailable: ConnectionUnavailableResponse | undefined;

    const postUnavailable = (reason: ConnectionUnavailableReason): void => {
        const described = describeUnavailable(reason);
        const message: ConnectionUnavailableMessage = {
            type: 'collectionView.connectionUnavailable',
            unavailable: described.unavailable,
        };
        if (!controller.isDisposed) {
            void controller.panel.webview.postMessage(message);
        }
    };

    const recoverUnavailable = async (
        request: ConnectionRecoveryRequest,
    ): Promise<ConnectionUnavailableResponse | ConnectionRecoveryResponse> => {
        if (request.action === 'close') {
            controller.dispose();
            return { recovered: { text: '' } };
        }

        if (
            activeUnavailable === undefined ||
            activeUnavailable.unavailable.reason !== request.reason ||
            activeUnavailable.unavailable.action !== request.action
        ) {
            return activeUnavailable ?? describeUnavailable(request.reason);
        }

        const latchReason = ClustersClient.getLatchReason(initialData.clusterId);
        if (latchReason && latchReason !== request.reason) {
            return describeUnavailable(latchReason);
        }

        if (request.action === 'signInAgain') {
            if (!canRetrySignIn(initialData.clusterId)) {
                return describeUnavailable(request.reason);
            }
            const before = ClustersClient.getBinding(initialData.clusterId);
            try {
                await vscode.commands.executeCommand('vscode-documentdb.command.signInAgain', {
                    clusterId: initialData.clusterId,
                });
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    return describeUnavailable(request.reason);
                }
                throw error;
            }

            const recovered = ClustersClient.getBinding(initialData.clusterId);
            const reasonAfterSignIn = ClustersClient.getLatchReason(initialData.clusterId);
            if (reasonAfterSignIn || !recovered || recovered.generation === before?.generation) {
                return describeUnavailable(reasonAfterSignIn ?? request.reason);
            }
            if (recovered.fingerprint !== session.getBinding().fingerprint) {
                return describeUnavailable('identityChanged');
            }
            session.rebind(recovered);
            activeUnavailable = undefined;
            return { recovered: { text: vscode.l10n.t('Reconnected') } };
        }

        if (request.action !== 'reconnect') {
            return describeUnavailable(request.reason);
        }

        const original = session.getBinding();
        const current = ClustersClient.getBinding(initialData.clusterId);
        const isExplicitRebind =
            request.reason === 'identityChanged' || request.reason === 'credentialsChanged';
        if (isExplicitRebind && (!current || current.fingerprint === original.fingerprint)) {
            return describeUnavailable(request.reason);
        }
        const target = isExplicitRebind ? current : current?.fingerprint === original.fingerprint ? current : original;
        if (!target) {
            return describeUnavailable(request.reason);
        }

        if (latchReason) {
            if (latchReason !== 'userDisconnected' && latchReason !== 'credentialsChanged') {
                return describeUnavailable(latchReason);
            }
            ClustersClient.unlatch(initialData.clusterId);
        }

        try {
            const resolved = await ClustersClient.resolveBoundClient(target, { trigger: 'collectionView' });
            const reasonAfterReconnect = ClustersClient.getLatchReason(initialData.clusterId);
            if (
                reasonAfterReconnect ||
                ClustersClient.getBinding(initialData.clusterId)?.fingerprint !== target.fingerprint
            ) {
                return describeUnavailable(reasonAfterReconnect ?? request.reason);
            }
            session.rebind(resolved.binding);
            activeUnavailable = undefined;
            return {
                recovered: {
                    text: isExplicitRebind
                        ? vscode.l10n.t('Now connected as {0}', identityLabel(initialData.clusterId))
                        : vscode.l10n.t('Reconnected'),
                },
            };
        } catch (error) {
            if (error instanceof ConnectionUnavailableError) {
                return describeUnavailable(error.reason);
            }
            throw error;
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
        describeUnavailable,
        recoverUnavailable,
    };

    controller = openAppWebview({
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
    controller.onDisposed(() => registration.dispose());

    return controller;
}
