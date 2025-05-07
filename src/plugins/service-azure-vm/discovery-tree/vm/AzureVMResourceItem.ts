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
import { type AuthenticateWizardContext } from '../../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../../extensionVariables';
import { ResourceItemBase } from '../../../../tree/ResourceItemBase';

// Define a model for VM, similar to ClusterModel but for VM properties
export interface VirtualMachineModel {
    id: string;
    name: string;
    // Relevant properties from the VM object discovered by the wizard, stored in `azureVMInfo`
    connectionStringTemplate: string;
    vmSize?: string;
    publicIpAddress?: string;
    fqdn?: string;
    // Add other VM specific details if needed for the tree item
}

export class AzureVMResourceItem extends ResourceItemBase {
    iconPath = new vscode.ThemeIcon('vm'); // Generic VM icon

    // Store the connection string template and other details passed from the wizard
    private _connectionStringTemplate: string;
    private _vmSize?: string;
    private _publicIpAddress?: string;
    private _fqdn?: string;

    constructor(
        readonly subscription: AzureSubscription, // Retained from original
        readonly vmModel: VirtualMachineModel, // Using the new VM model
        // connectionInfo: any, // Passed from the wizard execution step, containing vmId, name, connectionStringTemplate
    ) {
        super(vmModel.name, vmModel.id); // label, id
        this._connectionStringTemplate = vmModel.connectionStringTemplate;
        this._vmSize = vmModel.vmSize;
        this._publicIpAddress = vmModel.publicIpAddress;
        this._fqdn = vmModel.fqdn;

        // Construct tooltip and description
        const tooltipParts: string[] = [`Name: ${this.vmModel.name}`, `ID: ${this.vmModel.id}`];
        if (this._vmSize) {
            tooltipParts.push(`Size: ${this._vmSize}`);
        }
        if (this._fqdn) {
            tooltipParts.push(`FQDN: ${this._fqdn}`);
        }
        if (this._publicIpAddress) {
            tooltipParts.push(`Public IP: ${this._publicIpAddress}`);
        }

        if (!this._publicIpAddress && !this._fqdn) {
            this.description = l10n.t('No Connectivity');
            tooltipParts.push(l10n.t('No public IP or FQDN available for direct connection.'));
        } else {
            this.description = this._fqdn || this._publicIpAddress;
        }
        this.tooltip = tooltipParts.join('\n');
    }

    // This method will be called by the framework when the item is expanded or actions are performed.
    public async getConnectionString(): Promise<string | undefined> {
        // The connection string template is already available from the wizard.
        // Credentials will be filled in by the authentication process.
        return Promise.resolve(this._connectionStringTemplate);
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'azureVM.connect', // Changed telemetry event name
            async (context: IActionContext) => {
                ext.outputChannel.appendLine(
                    l10n.t('Azure VM: Attempting to authenticate with "{vmName}"…', {
                        vmName: this.vmModel.name,
                    }),
                );

                // The connection string template is already stored in this._connectionStringTemplate
                const connectionStringTemplate = nonNullValue(this._connectionStringTemplate);
                context.valuesToMask.push(connectionStringTemplate);

                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    // adminUserName: undefined, // VM connection doesn't have a default admin username from Azure like vCore
                    resourceName: this.vmModel.name,
                    connectionString: connectionStringTemplate, // Pass the template to the wizard
                };

                const credentialsProvided = await this.promptForCredentials(wizardContext);

                if (!credentialsProvided || !wizardContext.selectedUserName || !wizardContext.password) {
                    return null;
                }

                context.valuesToMask.push(nonNullProp(wizardContext, 'password'));

                // Construct the final connection string with user-provided credentials
                const finalConnectionString = new ConnectionString(connectionStringTemplate);
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
                        vmName: this.vmModel.name,
                        username: wizardContext.selectedUserName ?? '',
                    }),
                );

                let clustersClient: ClustersClient;
                try {
                    // GetClient will use the cached credentials including the password
                    clustersClient = await ClustersClient.getClient(this.id).catch((error: Error) => {
                        ext.outputChannel.appendLine(l10n.t('Error: {error}', { error: error.message }));
                        void vscode.window.showErrorMessage(
                            l10n.t('Failed to connect to VM "{vmName}"', { vmName: this.vmModel.name }),
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
                        vmName: this.vmModel.name,
                        username: wizardContext.selectedUserName ?? '',
                    }),
                );
                return clustersClient;
            },
        );
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
