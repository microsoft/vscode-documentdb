/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoCluster } from '@azure/arm-mongocluster';
import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    nonNullValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethod } from '../../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { maskSensitiveValuesInTelemetry } from '../../../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ChooseAuthMethodStep } from '../../../../documentdb/wizards/authenticate/ChooseAuthMethodStep';
import { ProvidePasswordStep } from '../../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../../extensionVariables';
import { ClusterItemBase, type ClusterCredentials } from '../../../../tree/documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../../tree/documentdb/ClusterModel';
import { createMongoClustersManagementClient } from '../../../../utils/azureClients';
import { extractCredentialsFromCluster, getClusterInformationFromAzure } from '../../utils/clusterHelpers';

export class DocumentDBResourceItem extends ClusterItemBase {
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

    public async getConnectionString(): Promise<string | undefined> {
        return callWithTelemetryAndErrorHandling('getConnectionString', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-discovery';

            // Create a client to interact with the MongoDB vCore management API and read the cluster details
            const managementClient = await createMongoClustersManagementClient(context, this.subscription);

            const clusterInformation = await managementClient.mongoClusters.get(
                this.cluster.resourceGroup!,
                this.cluster.name,
            );

            if (!clusterInformation.properties?.connectionString) {
                return undefined;
            }

            context.valuesToMask.push(clusterInformation.properties.connectionString);
            const connectionString = new DocumentDBConnectionString(clusterInformation.properties.connectionString);
            maskSensitiveValuesInTelemetry(context, connectionString);

            if (clusterInformation.properties?.administrator?.userName) {
                context.valuesToMask.push(clusterInformation.properties.administrator.userName);
                connectionString.username = clusterInformation.properties.administrator.userName;
            }

            /**
             * The connection string returned from Azure does not include the actual password.
             * Instead, it contains a placeholder. We explicitly set the password to an empty string here.
             */
            connectionString.password = '';

            return connectionString.toString();
        });
    }

    public async getCredentials(): Promise<ClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-discovery';

            // Retrieve and validate cluster information (throws if invalid)
            const clusterInformation = await getClusterInformationFromAzure(
                context,
                this.subscription,
                this.cluster.resourceGroup!,
                this.cluster.name,
            );

            return extractCredentialsFromCluster(context, clusterInformation);
        });
    }

    /**
     * Retrieves and validates cluster information from Azure.
     */
    private async getClusterInformation(context: IActionContext): Promise<MongoCluster> {
        return getClusterInformationFromAzure(
            context,
            this.subscription,
            this.cluster.resourceGroup!,
            this.cluster.name,
        );
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-discovery';

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            // Get and validate cluster information
            const clusterInformation = await this.getClusterInformation(context);
            const credentials = extractCredentialsFromCluster(context, clusterInformation);

            // Prepare wizard context
            const wizardContext: AuthenticateWizardContext = {
                ...context,
                adminUserName: credentials.connectionUser,
                resourceName: this.cluster.name,
                availableAuthMethods: credentials.availableAuthMethods,
            };

            // Prompt for credentials
            const credentialsProvided = await this.promptForCredentials(wizardContext);
            if (!credentialsProvided) {
                return null;
            }

            if (wizardContext.password) {
                context.valuesToMask.push(wizardContext.password);
            }

            // Cache credentials and attempt connection
            CredentialCache.setAuthCredentials(
                this.id,
                nonNullValue(wizardContext.selectedAuthMethod, 'authMethod'),
                nonNullValue(credentials.connectionString),
                wizardContext.selectedUserName,
                wizardContext.password,
            );

            switch (wizardContext.selectedAuthMethod) {
                case AuthMethod.MicrosoftEntraID:
                    ext.outputChannel.append(l10n.t('Connecting to the cluster using Entra ID…'));
                    break;
                default:
                    ext.outputChannel.append(
                        l10n.t('Connecting to the cluster as "{username}"…', {
                            username: wizardContext.selectedUserName ?? '',
                        }),
                    );
            }

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

    /**
     * Prompts the user for credentials using a wizard.
     *
     * @param wizardContext The wizard context.
     * @returns True if the wizard completed successfully; false if the user canceled or an error occurred.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [new ChooseAuthMethodStep(), new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials
        await callWithTelemetryAndErrorHandling('connect.promptForCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-discovery';

            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = false;
            try {
                await wizard.prompt(); // This will prompt the user; results are stored in wizardContext
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    wizardContext.aborted = true;
                }
            }
        });

        // Return true if the wizard completed successfully; false otherwise
        return !wizardContext.aborted;
    }
}
