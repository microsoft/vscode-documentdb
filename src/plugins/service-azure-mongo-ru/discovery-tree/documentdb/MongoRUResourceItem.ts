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
import { DISCOVERY_PROVIDER_ID, RESOURCE_TYPE } from '../../config';
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
        'AzureCosmosDb.svg',
    );

    constructor(
        /**
         * Correlation ID for telemetry funnel analysis.
         * For statistics only - does not influence functionality.
         */
        journeyCorrelationId: string,
        readonly subscription: AzureSubscription,
        cluster: ClusterModel,
    ) {
        super(cluster);
        this.journeyCorrelationId = journeyCorrelationId;
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.resourceType = RESOURCE_TYPE;
            if (this.journeyCorrelationId) {
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
            }

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
            const connectionStartTime = Date.now();
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.connectionInitiatedFrom = 'discoveryView';
            context.telemetry.properties.resourceType = RESOURCE_TYPE;
            if (this.journeyCorrelationId) {
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
            }

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

                // Cache the credentials for this cluster using clusterId for stable caching
                CredentialCache.setAuthCredentials(
                    this.cluster.clusterId,
                    credentials.selectedAuthMethod ?? credentials.availableAuthMethods[0],
                    credentials.connectionString,
                    credentials.nativeAuthConfig,
                );

                // Connect using the cached credentials
                const clustersClient = await ClustersClient.getClient(this.cluster.clusterId);

                ext.outputChannel.appendLine(
                    l10n.t('Connected to the cluster "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );

                // Add success telemetry
                context.telemetry.measurements.connectionEstablishmentTimeMs = Date.now() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'success';

                return clustersClient;
            } catch (error) {
                // Add error telemetry
                context.telemetry.measurements.connectionEstablishmentTimeMs = Date.now() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'failed';
                context.telemetry.properties.connectionErrorType = error instanceof Error ? error.name : 'UnknownError';

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
                await ClustersClient.deleteClient(this.cluster.clusterId);
                CredentialCache.deleteCredentials(this.cluster.clusterId);

                return null;
            }
        });

        return result ?? null;
    }
}
