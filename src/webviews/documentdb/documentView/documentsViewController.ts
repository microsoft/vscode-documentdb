/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethodId';
import { ClustersClient, type ConnectionBinding } from '../../../documentdb/ClustersClient';
import { ConnectionUnavailableError, type ConnectionUnavailableReason } from '../../../documentdb/ConnectionUnavailableError';
import { registerConnectionSurface } from '../../../documentdb/connectionSurfaces';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import {
    type ConnectionRecoveryRequest,
    type ConnectionRecoveryResponse,
    type ConnectionUnavailableMessage,
    type ConnectionUnavailableResponse,
} from '../../_integration/connectionUnavailable';
import { describeUnavailableConnection } from '../../_integration/describeUnavailableConnection';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './documentsViewRouter';

export type DocumentsViewWebviewConfigurationType = {
    id: string; // move to base type

    clusterId: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * Required for finding the tree node if needed.
     * @see Views enum
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
    documentId?: string;

    mode: string; // 'add', 'view', 'edit'
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

export function openDocumentWebview(
    initialData: DocumentsViewWebviewConfigurationType,
    binding: ConnectionBinding,
): AppWebviewController<DocumentsViewWebviewConfigurationType> {
    let title: string = `${initialData.databaseName}/${initialData.collectionName}/*new*`;
    switch (initialData.mode) {
        case 'view':
        case 'edit': {
            title = `${initialData.databaseName}/${initialData.collectionName}/${initialData.documentId}`;
            break;
        }
    }

    // The router context's title setter needs the controller handle, which only
    // exists after openAppWebview returns. The setter is only invoked at runtime
    // (in response to a tRPC call), well after the handle is assigned below.
    const handle: { controller?: AppWebviewController<DocumentsViewWebviewConfigurationType> } = {};

    const bindingRef = { current: binding };
    let controller: AppWebviewController<DocumentsViewWebviewConfigurationType>;
    let activeUnavailable: ConnectionUnavailableResponse | undefined;

    const describeUnavailable = (reason: ConnectionUnavailableReason): ConnectionUnavailableResponse => {
        const current = ClustersClient.getBinding(initialData.clusterId);
        const canReconnect =
            reason === 'identityChanged' || reason === 'credentialsChanged'
                ? current !== undefined && current.fingerprint !== bindingRef.current.fingerprint
                : reason === 'userDisconnected' || reason === 'unreachable';
        activeUnavailable = describeUnavailableConnection(reason, {
            canRetrySignIn: canRetrySignIn(initialData.clusterId),
            canUpdateCredentials: false,
            canReconnect,
        });
        return activeUnavailable;
    };

    const postUnavailable = (reason: ConnectionUnavailableReason): void => {
        const described = describeUnavailable(reason);
        const message: ConnectionUnavailableMessage = {
            type: 'documentView.connectionUnavailable',
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
            if (recovered.fingerprint !== bindingRef.current.fingerprint) {
                return describeUnavailable('identityChanged');
            }
            bindingRef.current = recovered;
            activeUnavailable = undefined;
            return { recovered: { text: vscode.l10n.t('Reconnected') } };
        }

        if (request.action !== 'reconnect') {
            return describeUnavailable(request.reason);
        }

        const original = bindingRef.current;
        const current = ClustersClient.getBinding(initialData.clusterId);
        const isExplicitRebind =
            request.reason === 'identityChanged' || request.reason === 'credentialsChanged';
        if (isExplicitRebind && (!current || current.fingerprint === original.fingerprint)) {
            return describeUnavailable(request.reason);
        }
        const target = isExplicitRebind ? current : (current?.fingerprint === original.fingerprint ? current : original);
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
            const resolved = await ClustersClient.resolveBoundClient(target, { trigger: 'documentView' });
            if (
                ClustersClient.getBinding(initialData.clusterId)?.fingerprint !== target.fingerprint ||
                ClustersClient.getLatchReason(initialData.clusterId)
            ) {
                return describeUnavailable(request.reason);
            }
            bindingRef.current = resolved.binding;
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
        dbExperience: API.DocumentDB,
        webviewName: 'documentView',
        clusterId: initialData.clusterId,
        viewId: initialData.viewId,
        databaseName: initialData.databaseName,
        collectionName: initialData.collectionName,
        documentId: initialData.documentId,
        binding: bindingRef,
        describeUnavailable,
        recoverUnavailable,
        viewPanelTitleSetter: (title: string) => {
            if (handle.controller && !handle.controller.isDisposed) {
                handle.controller.panel.title = title;
            }
        },
    };

    controller = openAppWebview({
        title,
        webviewName: 'documentView',
        panelViewType: 'vscode-documentdb-document-view',
        config: initialData,
        context: trpcContext,
        // A new document has nothing to load, so only opened documents report their load time.
        viewLoad:
            initialData.mode === 'add'
                ? undefined
                : {
                      kind: 'documentView',
                      correlation: {
                          viewId: initialData.viewId,
                          documentMode: initialData.mode === 'edit' ? 'edit' : 'view',
                      },
                  },
        viewColumn: vscode.ViewColumn.Active,
        icon: {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-dark.svg'),
        },
    });

    // Assign into the deferred handle so the title-setter closure above can reach
    // the controller, then return the local `const` (never the optional
    // `handle.controller`), so the return path is obviously non-nullable.
    handle.controller = controller;

    const registration = registerConnectionSurface({
        clusterId: initialData.clusterId,
        kind: 'documentView',
        disable: postUnavailable,
        dispose: () => controller.dispose(),
    });
    controller.onDisposed(() => registration.dispose());

    return controller;
}
