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

// Define a model for VM, similar to ClusterModel but for VM properties
export interface VirtualMachineModel extends ClusterModel {
    vmSize?: string;
    publicIpAddress?: string;
    fqdn?: string;
}

export class AzureVMResourceItem extends ClusterItemBase {
    iconPath = new vscode.ThemeIcon('vm'); // Generic VM icon

    constructor(
        readonly subscription: AzureSubscription, // Retained from original
        readonly cluster: VirtualMachineModel, // Using the new VM model
        // connectionInfo: any, // Passed from the wizard execution step, containing vmId, name, connectionStringTemplate
    ) {
        super(cluster); // label, id

        // Construct tooltip and description
        const tooltipParts: string[] = [`**Name:** ${cluster.name}`, `**ID:** ${cluster.id}`];
        if (cluster.vmSize) {
            tooltipParts.push(`**Size:** ${cluster.vmSize}`);
        }
        if (cluster.fqdn) {
            tooltipParts.push(`**FQDN:** ${cluster.fqdn}`);
        }
        if (cluster.publicIpAddress) {
            tooltipParts.push(`**Public IP:** ${cluster.publicIpAddress}`);
        }

        if (cluster.publicIpAddress && !cluster.fqdn) {
            this.descriptionOverride = l10n.t('No Connectivity');
            tooltipParts.push(l10n.t('**No public IP or FQDN available for direct connection.**'));
        }

        this.tooltipOverride = new vscode.MarkdownString(tooltipParts.join('\n\n'));
    }

    public async getConnectionString(): Promise<string | undefined> {
        return Promise.resolve(this.cluster.connectionString);
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.discoveryProvider = 'azure-discovery';
            context.telemetry.properties.view = Views.DiscoveryView;

            ext.outputChannel.appendLine(
                l10n.t('Azure VM: Attempting to authenticate with "{vmName}"…', {
                    vmName: this.cluster.name,
                }),
            );

            const wizardContext: AuthenticateWizardContext = {
                ...context,
                resourceName: this.cluster.name,
                adminUserName: undefined,
                selectedUserName: undefined,
            };

            const credentialsProvided = await this.promptForCredentials(wizardContext);

            if (!credentialsProvided || !wizardContext.selectedUserName || !wizardContext.password) {
                return null;
            }

            context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

            // Construct the final connection string with user-provided credentials
            const connectionString = await this.getConnectionString();
            const finalConnectionString = new ConnectionString(nonNullValue(connectionString, 'connectionString'));
            finalConnectionString.username = wizardContext.selectedUserName;

            // Password will be handled by the ClustersClient, not directly in the string for cache

            CredentialCache.setCredentials(
                this.id, // Use the VM resource ID as the cache key
                finalConnectionString.toString(), // Store the string with username for reference, but password separately
                wizardContext.selectedUserName,
                wizardContext.password,
            );

            ext.outputChannel.append(
                l10n.t('Azure VM: Connecting to "{vmName}" as "{username}"…', {
                    vmName: this.cluster.name,
                    username: wizardContext.selectedUserName ?? '',
                }),
            );

            let clustersClient: ClustersClient;
            try {
                // GetClient will use the cached credentials including the password
                clustersClient = await ClustersClient.getClient(this.id).catch((error: Error) => {
                    ext.outputChannel.appendLine(l10n.t('Error: {error}', { error: error.message }));
                    void vscode.window.showErrorMessage(
                        l10n.t('Failed to connect to VM "{vmName}"', { vmName: this.cluster.name }),
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
                await ClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);
                return null;
            }

            ext.outputChannel.appendLine(
                l10n.t('Azure VM: Connected to "{vmName}" as "{username}".', {
                    vmName: this.cluster.name,
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
