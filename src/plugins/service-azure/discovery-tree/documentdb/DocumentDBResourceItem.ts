/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    nonNullValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { Views } from '../../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../../extensionVariables';
import { ClusterItemBase } from '../../../../tree/documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../../tree/documentdb/ClusterModel';
import { createMongoClustersManagementClient } from '../../../../utils/azureClients';

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
            // Create a client to interact with the MongoDB vCore management API and read the cluster details
            const managementClient = await createMongoClustersManagementClient(context, this.subscription);

            const clusterInformation = await managementClient.mongoClusters.get(
                this.cluster.resourceGroup as string,
                this.cluster.name,
            );

            if (!clusterInformation.connectionString) {
                return undefined;
            }

            context.valuesToMask.push(clusterInformation.connectionString);
            const connectionString = new ConnectionString(clusterInformation.connectionString as string);

            if (clusterInformation.administratorLogin) {
                context.valuesToMask.push(clusterInformation.administratorLogin);
                connectionString.username = clusterInformation.administratorLogin;
            }

            connectionString.password = '';

            return connectionString.toString();
        });
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

            // Create a client to interact with the MongoDB vCore management API and read the cluster details
            const managementClient = await createMongoClustersManagementClient(context, this.subscription);
            const clusterInformation = await managementClient.mongoClusters.get(
                this.cluster.resourceGroup as string,
                this.cluster.name,
            );

            const clusterConnectionString = nonNullValue(clusterInformation.connectionString);

            context.valuesToMask.push(clusterConnectionString);
            if (clusterInformation.administratorLogin) {
                context.valuesToMask.push(clusterInformation.administratorLogin);
            }

            const wizardContext: AuthenticateWizardContext = {
                ...context,
                adminUserName: clusterInformation.administratorLogin,
                resourceName: this.cluster.name,
            };

            // Prompt the user for credentials
            const credentialsProvided = await this.promptForCredentials(wizardContext);

            // If the wizard was aborted or failed, return null
            if (!credentialsProvided) {
                return null;
            }

            context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

            // Cache the credentials
            CredentialCache.setCredentials(
                this.id,
                nonNullValue(clusterConnectionString),
                nonNullProp(wizardContext, 'selectedUserName'),
                nonNullProp(wizardContext, 'password'),
                // here, emulatorConfiguration is not set, as it's a resource item from Azure resources, not a workspace item, therefore, no emulator support needed
            );

            ext.outputChannel.append(
                l10n.t('Connecting to the cluster as "{username}"…', {
                    username: wizardContext.selectedUserName ?? '',
                }),
            );

            // Attempt to create the client with the provided credentials
            let clustersClient: ClustersClient;
            try {
                clustersClient = await ClustersClient.getClient(this.id).catch((error: Error) => {
                    ext.outputChannel.appendLine(l10n.t('Error: {error}', { error: error.message }));

                    void vscode.window.showErrorMessage(
                        l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                        {
                            modal: true,
                            detail:
                                l10n.t('Revisit connection details and try again.') +
                                '\n\n' +
                                l10n.t('Error: {error}', { error: error.message }),
                        },
                    );

                    throw error;
                });
            } catch {
                // If connection fails, remove cached credentials
                await ClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);

                // Return null to indicate failure
                return null;
            }

            ext.outputChannel.appendLine(
                l10n.t('Connected to "{cluster}" as "{username}".', {
                    cluster: this.cluster.name,
                    username: wizardContext.selectedUserName ?? '',
                }),
            );

            return clustersClient;
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
            promptSteps: [new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: l10n.t('Authenticate to connect with your MongoDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials

        try {
            await wizard.prompt(); // This will prompt the user; results are stored in wizardContext
        } catch (error) {
            if (error instanceof UserCancelledError) {
                wizardContext.aborted = true;
            }
        }

        // Return true if the wizard completed successfully; false otherwise
        return !wizardContext.aborted;
    }
}
