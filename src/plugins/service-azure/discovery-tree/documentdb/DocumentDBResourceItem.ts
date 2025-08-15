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
import { isSupportedAuthMethod } from '../../../../documentdb/AuthMethod';
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
            const clusterInformation = (await managementClient.mongoClusters.get(
                this.cluster.resourceGroup!,
                this.cluster.name,
            )) as unknown as MongoCluster;

            // Check if authConfig exists and cast to ensure proper typing
            const clusterAuthConfig = clusterInformation.properties?.authConfig as
                | { allowedModes?: string[] }
                | undefined;

            if (!clusterAuthConfig || !clusterAuthConfig.allowedModes) {
                context.telemetry.properties.error = 'missing-authconfig';
                throw new Error(
                    l10n.t('Authentication configuration is missing for "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );
            }

            // Evaluate available authentication methods
            const authMethods = clusterAuthConfig.allowedModes;

            if (authMethods.length === 0) {
                context.telemetry.properties.error = 'authconfig-no-authentication-methods';
                throw new Error(
                    l10n.t('No authentication methods available for "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );
            }

            if (!clusterInformation.properties?.connectionString) {
                context.telemetry.properties.error = 'missing-connection-string';
                throw new Error(
                    l10n.t('Authentication data (properties.connectionString) is missing for "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );
            }

            context.valuesToMask.push(clusterInformation.properties.connectionString);

            const wizardContext: AuthenticateWizardContext = {
                ...context,
                adminUserName: clusterInformation.properties?.administrator?.userName,
                resourceName: this.cluster.name,
                availableAuthMethods: [
                    ...new Set(
                        // Pass through the string values directly
                        authMethods.map((method: string) => {
                            // Use the type guard to check if it's a known method
                            if (!isSupportedAuthMethod(method)) {
                                // Log unknown auth methods for telemetry
                                context.telemetry.properties.warning = 'unknown-authmethod';
                                context.telemetry.properties.authMethod = method;
                                console.warn(`Unknown auth method from Azure SDK: ${method}`);
                            }
                            // Return the method as-is (known or unknown)
                            return method;
                        }),
                    ),
                ],
            };

            // Prompt the user for credentials
            const credentialsProvided = await this.promptForCredentials(wizardContext);

            // If the wizard was aborted or failed, return null
            if (!credentialsProvided) {
                return null;
            }

            if (wizardContext.password) {
                context.valuesToMask.push(wizardContext.password);
            }

            // Cache the credentials
            CredentialCache.setAuthCredentials(
                this.id,
                nonNullValue(wizardContext.selectedAuthMethod, 'authMethod'),
                nonNullValue(clusterInformation.properties?.connectionString),
                wizardContext.selectedUserName, // can be undefined
                wizardContext.password, // can be undefined
                // emulatorConfiguration is not set, as it's a resource item from Azure resources, not a workspace item, therefore, no emulator support needed
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
            promptSteps: [new ChooseAuthMethodStep(), new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
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
