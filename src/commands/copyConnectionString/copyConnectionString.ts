/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { getKubernetesPortForwardMetadata } from '../../plugins/service-kubernetes/portForwardMetadata';
import { type ClusterItemBase, type EphemeralClusterCredentials } from '../../tree/documentdb/ClusterItemBase';
import { nonNullProp, nonNullValue } from '../../utils/nonNull';

/**
 * Helper function to check if a specific value exists in a delimited context string.
 * Context values are separated by word boundaries (e.g., 'connectionsView;treeitem_documentdbcluster').
 *
 * @param fullContext - The full context string to search in
 * @param value - The value to search for
 * @returns true if the value exists in the context string, false otherwise
 */
const containsDelimited = (fullContext: string | undefined, value: string): boolean => {
    if (!fullContext) {
        return false;
    }
    return new RegExp(`\\b${value}\\b`, 'i').test(fullContext);
};

interface ReadOnlyCopyCredentialsProvider {
    getCredentialsForCopy(): Promise<EphemeralClusterCredentials | undefined>;
}

function hasReadOnlyCopyCredentialsProvider(node: unknown): node is ReadOnlyCopyCredentialsProvider {
    return (
        typeof node === 'object' &&
        node !== null &&
        'getCredentialsForCopy' in node &&
        typeof (node as { getCredentialsForCopy?: unknown }).getCredentialsForCopy === 'function'
    );
}

export async function copyAzureConnectionString(context: IActionContext, node: ClusterItemBase) {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(context: IActionContext, node: ClusterItemBase): Promise<void> {
    let usesKubernetesPortForward = false;
    const connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;
        // KubernetesServiceItem.contextValue contains "discovery.kubernetesService"; the
        // \b boundary inside containsDelimited treats "." as a non-word boundary so this matches.
        const isKubernetesDiscoveryItem = containsDelimited(node.contextValue, 'kubernetesService');

        const credentials =
            isKubernetesDiscoveryItem && hasReadOnlyCopyCredentialsProvider(node)
                ? await node.getCredentialsForCopy()
                : await node.getCredentials();

        if (!credentials) {
            return;
        }

        usesKubernetesPortForward = !!getKubernetesPortForwardMetadata(credentials.connectionProperties);
        if (usesKubernetesPortForward) {
            context.telemetry.properties.kubernetesPortForwardCopy = 'true';
        }

        const parsedConnectionString = new DocumentDBConnectionString(credentials.connectionString);
        parsedConnectionString.username = credentials.nativeAuthConfig?.connectionUser ?? '';

        // Determine origin so we can decide whether to offer the with/without-password choice.
        // Today the prompt fires for saved connections and for Kubernetes-discovered targets,
        // both of which routinely have a real native-auth password attached to credentials.
        const isConnectionsView = containsDelimited(node.contextValue, Views.ConnectionsView);
        const shouldOfferPasswordPrompt = isConnectionsView || isKubernetesDiscoveryItem;

        context.telemetry.properties.copyOrigin = isConnectionsView
            ? 'connectionsView'
            : isKubernetesDiscoveryItem
              ? 'kubernetesDiscovery'
              : 'other';

        let passwordIncluded: 'true' | 'false' | 'notPrompted' = 'notPrompted';

        // Ask whether to include the password when the resolved credentials use native
        // auth and we actually have a password to offer.
        if (shouldOfferPasswordPrompt) {
            // Note: selectedAuthMethod is undefined when it's the only auth method available in legacy connections
            // that haven't been explicitly authenticated yet. In such cases, NativeAuth is assumed.
            const isNativeAuth =
                credentials.selectedAuthMethod === AuthMethodId.NativeAuth ||
                credentials.selectedAuthMethod === undefined;
            const hasPassword = !!credentials.nativeAuthConfig?.connectionPassword;

            if (isNativeAuth && hasPassword) {
                const includePassword = await context.ui.showQuickPick(
                    [
                        {
                            label: l10n.t('Copy without password'),
                            detail: l10n.t('The connection string will not include the password'),
                            includePassword: false,
                        },
                        {
                            label: l10n.t('Copy with password'),
                            detail: l10n.t('The connection string will include the password'),
                            includePassword: true,
                        },
                    ],
                    {
                        placeHolder: l10n.t('Do you want to include the password in the connection string?'),
                        suppressPersistence: true,
                    },
                );

                if (includePassword.includePassword) {
                    const nativeAuthConfig = nonNullValue(
                        credentials.nativeAuthConfig,
                        'credentials.nativeAuthConfig',
                        'copyConnectionString.ts',
                    );
                    const password = nonNullProp(
                        nativeAuthConfig,
                        'connectionPassword',
                        'nativeAuthConfig.connectionPassword',
                        'copyConnectionString.ts',
                    );
                    context.valuesToMask.push(password);
                    parsedConnectionString.password = password;
                    passwordIncluded = 'true';
                } else {
                    passwordIncluded = 'false';
                }
            }
        }

        context.telemetry.properties.passwordIncluded = passwordIncluded;

        if (credentials.selectedAuthMethod === AuthMethodId.MicrosoftEntraID) {
            parsedConnectionString.searchParams.set('authMechanism', 'MONGODB-OIDC');
        }

        return parsedConnectionString.toString();
    });

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to extract the connection string from the selected account.'),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        if (usesKubernetesPortForward) {
            void vscode.window.showWarningMessage(
                l10n.t(
                    'The connection string has been copied. This Kubernetes connection uses port-forwarding and only works on this machine while the tunnel is active.',
                ),
            );
        } else {
            void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
        }
    }
}
