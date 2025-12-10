/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { maskSensitiveValuesInTelemetry } from '../../../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../../extensionVariables';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../../../tree/documentdb/ClusterItemBase';
import { type ClusterModel } from '../../../../tree/documentdb/ClusterModel';
import { nonNullProp, nonNullValue } from '../../../../utils/nonNull';
import { DISCOVERY_PROVIDER_ID } from '../../config';

// Define a model for VM, similar to ClusterModel but for VM properties
export interface VirtualMachineModel extends ClusterModel {
    vmSize?: string;
    publicIpAddress?: string;
    fqdn?: string;
}

const DEFAULT_PORT = 27017;

export class AzureVMResourceItem extends ClusterItemBase {
    iconPath = new vscode.ThemeIcon('server-environment');

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

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.view = Views.DiscoveryView;

            const newPort = await context.ui.showInputBox({
                prompt: l10n.t('Enter the port number your DocumentDB uses. The default port: {defaultPort}.', {
                    defaultPort: DEFAULT_PORT,
                }),
                value: `${DEFAULT_PORT}`,
                placeHolder: l10n.t('The default port: {defaultPort}', { defaultPort: DEFAULT_PORT }),
                validateInput: (port: string) => {
                    port = port ? port.trim() : '';

                    if (!port) {
                        return l10n.t('Port number is required');
                    }

                    const portNumber = parseInt(port, 10);
                    if (isNaN(portNumber)) {
                        return l10n.t('Port number must be a number');
                    }

                    if (portNumber <= 0 || portNumber > 65535) {
                        return l10n.t('Port number must be between 1 and 65535');
                    }

                    return undefined;
                },
            });

            const portNumber = newPort ? parseInt(newPort, 10) : DEFAULT_PORT;

            const parsedCS = new DocumentDBConnectionString(this.cluster.connectionString ?? '');

            const newHosts: string[] = [];
            if (parsedCS.hosts && parsedCS.hosts.length > 0) {
                for (const hostString of parsedCS.hosts) {
                    let baseAddress = hostString;
                    const lastColonIndex = hostString.lastIndexOf(':');

                    // Check if a colon exists and it's not the first character of the string.
                    // This is an attempt to identify a port separator.
                    if (lastColonIndex > 0) {
                        const potentialPortStr = hostString.substring(lastColonIndex + 1);

                        // Verify if the part after the colon is purely numeric.
                        if (/^\d+$/.test(potentialPortStr)) {
                            const portVal = parseInt(potentialPortStr, 10);
                            // Verify if the numeric part is within the valid port range.
                            if (portVal > 0 && portVal <= 65535) {
                                // If all checks pass, consider this a "host:port" structure.
                                // The baseAddress is the part before the last colon.
                                // This handles "hostname:port" and "[ipv6address]:port".
                                baseAddress = hostString.substring(0, lastColonIndex);
                            }
                            // If portVal is not in valid range, potentialPortStr is not a valid port.
                            // So, the colon was likely part of the hostname itself (e.g. unbracketed IPv6).
                            // In this case, baseAddress remains the original hostString.
                        }
                        // If potentialPortStr is not numeric, it's not a port.
                        // The colon was likely part of the hostname.
                        // baseAddress remains the original hostString.
                    }
                    // If lastColonIndex <= 0 (no colon, or colon is the first char like ":27017"),
                    // or if the part after colon wasn't a valid port,
                    // baseAddress is the original hostString.

                    // Construct the new host entry with the specified port.
                    // The format "baseAddress:numericPortToUse" is verified by construction.
                    newHosts.push(`${baseAddress}:${portNumber}`);
                }
            }
            // else if parsedCS.hosts is null, undefined or empty, newHosts remains empty.

            parsedCS.hosts = newHosts;

            return {
                connectionString: parsedCS.toString(),
                connectionUser: parsedCS.username,
                connectionPassword: parsedCS.password,
                availableAuthMethods: [AuthMethodId.NativeAuth],
            };
        });
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.view = Views.DiscoveryView;

            ext.outputChannel.appendLine(
                l10n.t('Azure VM: Attempting to authenticate with "{vmName}"…', {
                    vmName: this.cluster.name,
                }),
            );

            // Construct the final connection string with user-provided credentials
            const connectionString = (await this.getCredentials())?.connectionString;

            context.valuesToMask.push(nonNullValue(connectionString, 'connectionString', 'AzureVMResourceItem.ts'));

            const finalConnectionString = new DocumentDBConnectionString(
                nonNullValue(connectionString, 'connectionString', 'AzureVMResourceItem.ts'),
            );
            maskSensitiveValuesInTelemetry(context, finalConnectionString);

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

            context.valuesToMask.push(
                nonNullProp(wizardContext, 'password', 'wizardContext.password', 'AzureVMResourceItem.ts'),
            );

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
            title: l10n.t('Authenticate to Connect with Your DocumentDB Cluster'),
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
