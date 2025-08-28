/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { maskSensitiveValuesInTelemetry } from '../../../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../../documentdb/Views';
import { ext } from '../../../../extensionVariables';
import { createCosmosDBManagementClient } from '../../../../utils/azureClients';
import { nonNullValue } from '../../../../utils/nonNull';
import { ClusterItemBase, type ClusterCredentials } from '../../../documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../documentdb/ClusterModel';

export class RUResourceItem extends ClusterItemBase {
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

    public async getCredentials(): Promise<ClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'ru';

            const credentials = await this.getRUClusterCredentialsFromAzure(
                context,
                this.subscription,
                this.cluster.resourceGroup!,
                this.cluster.name,
            );

            return credentials;
        });
    }

    /**
     * Authenticates and connects to the Azure Cosmos DB for MongoDB (RU) cluster.
     * No authentication prompt as we're accessing the cluster with the default credentials.
     *
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'ru';

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            const credentials = await this.getRUClusterCredentialsFromAzure(
                context,
                this.subscription,
                this.cluster.resourceGroup!,
                this.cluster.name,
            );

            // Cache credentials and attempt connection
            CredentialCache.setAuthCredentials(
                this.id,
                credentials.selectedAuthMethod!,
                nonNullValue(credentials.connectionString, 'credentials.connectionString', 'VCoreResourceItem.ts'),
                credentials.connectionUser,
                credentials.connectionPassword,
            );

            ext.outputChannel.append(
                l10n.t('Connecting to the cluster as "{username}"…', {
                    username: credentials.connectionUser ?? '',
                }),
            );

            try {
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

    async getRUClusterCredentialsFromAzure(
        context: IActionContext,
        subscription: AzureSubscription,
        resourceGroup: string,
        clusterName: string,
    ): Promise<ClusterCredentials> {
        // subscription comes from different azure packages in callers; cast here intentionally
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        const managementClient = await createCosmosDBManagementClient(context, subscription as any);

        // Leaving this for future maintainers in case cluster information is needed
        // (becomes relevant once/when/if new authentication methods are added)
        // const clusterInformation = await managementClient.databaseAccounts.get(resourceGroup, clusterName);

        const connectionStringsList = await managementClient.databaseAccounts.listConnectionStrings(
            resourceGroup as string,
            clusterName,
        );

        /**
         * databaseAccounts.listConnectionStrings returns an array of (typically 4) connection string objects:
         *
         * interface DatabaseAccountConnectionString {
         *    readonly connectionString?: string;
         *    readonly description?: string;
         *    readonly keyKind?: Kind;
         *    readonly type?: Type;
         * }
         *
         * Today we're interested in the one where "keyKind" is "Primary", but this might change in the future.
         * Other known values:
         *  - Primary
         *  - Secondary
         *  - PrimaryReadonly
         *  - SecondaryReadonly
         */

        // More efficient approach
        const primaryConnectionString = connectionStringsList?.connectionStrings?.find(
            (cs) => cs.keyKind?.toLowerCase() === 'primary',
        )?.connectionString;

        // Validate connection string's presence
        if (!primaryConnectionString) {
            context.telemetry.properties.error = 'missing-connection-string';
            throw new Error(
                l10n.t('Authentication data (primary connection string) is missing for "{cluster}".', {
                    cluster: clusterName,
                }),
            );
        }

        context.valuesToMask.push(primaryConnectionString);

        const parsedCS = new DocumentDBConnectionString(primaryConnectionString);
        maskSensitiveValuesInTelemetry(context, parsedCS);

        const username = parsedCS.username;
        const password = parsedCS.password;
        // do not keep secrets in the connection string
        parsedCS.username = '';
        parsedCS.password = '';

        // the connection string received sometimes contains an 'appName' entry
        // with a value that's not escaped, let's just remove it as we don't use
        // it here anyway.
        parsedCS.searchParams.delete('appName');

        const clusterCredentials: ClusterCredentials = {
            connectionString: parsedCS.toString(),
            connectionUser: username,
            connectionPassword: password,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
        };

        return clusterCredentials;
    }
}
