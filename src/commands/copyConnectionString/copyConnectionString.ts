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
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
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

export async function copyAzureConnectionString(context: IActionContext, node: ClusterItemBase) {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(context: IActionContext, node: ClusterItemBase): Promise<void> {
    const connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;

        const credentials = await node.getCredentials();

        if (!credentials) {
            return;
        }

        const parsedConnectionString = new DocumentDBConnectionString(credentials.connectionString);
        parsedConnectionString.username = credentials.nativeAuthConfig?.connectionUser ?? '';

        // Check if we're in the connections view and using native auth
        const isConnectionsView = containsDelimited(node.contextValue, Views.ConnectionsView);

        // Ask if user wants to include password (only in connections view with native auth)
        if (isConnectionsView) {
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
                }
            }
        }

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
        void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
    }
}
