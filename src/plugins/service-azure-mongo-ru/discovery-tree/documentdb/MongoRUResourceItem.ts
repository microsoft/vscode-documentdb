/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { Views } from '../../../../documentdb/Views';
import { ext } from '../../../../extensionVariables';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../../../tree/documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../../tree/documentdb/ClusterModel';
import { extractCredentialsFromRUAccount } from '../../utils/ruClusterHelpers';

export class MongoRUResourceItem extends ClusterItemBase {
    iconPath = vscode.Uri.joinPath(
        ext.context.extensionUri,
        'resources',
        'from_node_modules',
        '@microsoft',
        'vscode-azext-azureutils',
        'resources',
        'azureIcons',
        'MongoClusters.svg',
    );

    constructor(
        readonly subscription: AzureSubscription,
        cluster: ClusterModel,
    ) {
        super(cluster);
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-mongo-ru-discovery';

            const credentials = await extractCredentialsFromRUAccount(
                context,
                this.subscription,
                this.cluster.resourceGroup!,
                this.cluster.name,
            );

            return credentials;
        });
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-mongo-ru-discovery';

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            try {
                // Get credentials for this cluster
                const credentials = await this.getCredentials();
                if (!credentials) {
                    throw new Error(
                        l10n.t('Unable to retrieve credentials for cluster "{cluster}".', {
                            cluster: this.cluster.name,
                        }),
                    );
                }

                // Cache the credentials for this cluster
                CredentialCache.setAuthCredentials(
                    this.id,
                    credentials.selectedAuthMethod ?? credentials.availableAuthMethods[0],
                    credentials.connectionString,
                    credentials.nativeAuthConfig?.connectionUser ?? '',
                    credentials.nativeAuthConfig?.connectionPassword ?? '',
                );

                // Connect using the cached credentials
                const clustersClient = await ClustersClient.getClient(this.id);

                ext.outputChannel.appendLine(
                    l10n.t('Connected to the cluster "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );

                return clustersClient;
            } catch (error) {
                ext.outputChannel.appendLine(l10n.t('Error: {error}', { error: (error as Error).message }));

                void vscode.window.showErrorMessage(
                    l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                    {
                        modal: true,
                        detail:
                            l10n.t('Revisit connection details and try again.') +
                            '\n\n' +
                            l10n.t('Error: {error}', { error: (error as Error).message }),
                    },
                );

                // Clean up failed connection
                await ClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);

                return null;
            }
        });

        return result ?? null;
    }
}
