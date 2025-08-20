/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { AuthMethod, authMethodFromString, authMethodsFromString } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ChooseAuthMethodStep } from '../../documentdb/wizards/authenticate/ChooseAuthMethodStep';
import { ProvidePasswordStep } from '../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { SaveCredentialsStep } from '../../documentdb/wizards/authenticate/SaveCredentialsStep';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { ClusterItemBase, type ClusterCredentials } from '../documentdb/ClusterItemBase';
import { type ClusterModelWithStorage } from '../documentdb/ClusterModel';
import { type TreeElementWithStorageId } from '../TreeElementWithStorageId';

export class DocumentDBClusterItem extends ClusterItemBase implements TreeElementWithStorageId {
    public override readonly cluster: ClusterModelWithStorage;

    constructor(mongoCluster: ClusterModelWithStorage) {
        super(mongoCluster);
        this.cluster = mongoCluster; // Explicit initialization
    }

    public get storageId(): string {
        return this.cluster.storageId;
    }

    public async getCredentials(): Promise<ClusterCredentials | undefined> {
        const connectionType = this.cluster.emulatorConfiguration?.isEmulator
            ? ConnectionType.Emulators
            : ConnectionType.Clusters;
        const connectionCredentials = await ConnectionStorageService.get(this.storageId, connectionType);

        if (!connectionCredentials) {
            return undefined;
        }

        return {
            connectionString: connectionCredentials.secrets.connectionString,
            connectionUser: connectionCredentials.secrets.userName,
            connectionPassword: connectionCredentials.secrets.password,
            availableAuthMethods: authMethodsFromString(connectionCredentials?.properties.availableAuthMethods),
            selectedAuthMethod: authMethodFromString(connectionCredentials?.properties.selectedAuthMethod),
        };
    }

    /**
     * Authenticates and connects to the MongoDB cluster.
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.ConnectionsView;

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            const connectionType = this.cluster.emulatorConfiguration?.isEmulator
                ? ConnectionType.Emulators
                : ConnectionType.Clusters;

            const connectionCredentials = await ConnectionStorageService.get(this.storageId, connectionType);

            if (!connectionCredentials) {
                return null;
            }

            const connectionString = new DocumentDBConnectionString(connectionCredentials.secrets.connectionString);

            let username: string | undefined = connectionCredentials.secrets.userName;
            let password: string | undefined = connectionCredentials.secrets.password;
            let authMethod: AuthMethod | undefined = authMethodFromString(
                connectionCredentials.properties.selectedAuthMethod,
            );

            /**
             * Prompt for credentials if no auth method selected or
             * native auth but no username/password set
             */
            if (
                !authMethod ||
                (authMethod === AuthMethod.NativeAuth &&
                    (!username || username.length === 0 || !password || password.length === 0))
            ) {
                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    availableAuthMethods: connectionCredentials.properties.availableAuthMethods,
                    selectedAuthMethod: authMethod,

                    // provide the default value for the username
                    adminUserName: username,
                    password: password,
                    resourceName: this.cluster.name,

                    // enforce the user to confirm theusername
                    selectedUserName: undefined,
                };

                // Prompt the user for credentials using the extracted method
                const credentialsProvided = await this.promptForCredentials(wizardContext);

                // If the wizard was aborted or failed, return null
                if (!credentialsProvided) {
                    return null;
                }

                if (wizardContext.password) {
                    context.valuesToMask.push(wizardContext.password);
                }

                username = wizardContext.selectedUserName;
                password = wizardContext.password;
                authMethod = nonNullProp(wizardContext, 'selectedAuthMethod');

                if (wizardContext.saveCredentials) {
                    ext.outputChannel.append(
                        l10n.t('Saving credentials for "{clusterName}"…', {
                            clusterName: this.cluster.name,
                        }),
                    );

                    const connectionType = this.cluster.emulatorConfiguration?.isEmulator
                        ? ConnectionType.Emulators
                        : ConnectionType.Clusters;

                    const connection = await ConnectionStorageService.get(this.storageId, connectionType);
                    if (connection) {
                        connection.properties.selectedAuthMethod = authMethod;
                        connection.secrets = {
                            connectionString: connectionString.toString(),
                            userName: username,
                            password: password,
                        };
                        try {
                            await ConnectionStorageService.save(connectionType, connection, true);
                        } catch (pushError) {
                            console.error(`Failed to save credentials for connection "${this.id}":`, pushError);
                            void vscode.window.showErrorMessage(
                                l10n.t('Failed to save credentials for "{cluster}".', {
                                    cluster: this.cluster.name,
                                }),
                            );
                        }
                    } else {
                        console.error(`Connection with ID "${this.storageId}" not found in storage.`);
                        void vscode.window.showErrorMessage(
                            l10n.t('Failed to save credentials for "{cluster}".', {
                                cluster: this.cluster.name,
                            }),
                        );
                    }
                }
            }

            switch (authMethod) {
                case AuthMethod.MicrosoftEntraID:
                    ext.outputChannel.append(l10n.t('Connecting to the cluster using Entra ID…'));
                    break;
                default:
                    ext.outputChannel.append(
                        l10n.t('Connecting to the cluster as "{username}"…', {
                            username: username ?? '',
                        }),
                    );
            }

            // Cache the credentials
            CredentialCache.setAuthCredentials(
                this.id,
                authMethod,
                connectionString.toString(),
                username,
                password,
                this.cluster.emulatorConfiguration, // workspace items can potentially be connecting to an emulator, so we always pass it
            );

            let clustersClient: ClustersClient;

            // Attempt to create the client with the provided credentials
            try {
                clustersClient = await ClustersClient.getClient(this.id);
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

                // If connection fails, remove cached credentials
                await ClustersClient.deleteClient(this.id);
                CredentialCache.deleteCredentials(this.id);

                // Return null to indicate failure
                return null;
            }

            ext.outputChannel.appendLine(
                l10n.t('Connected to the cluster "{cluster}".', {
                    cluster: this.cluster.name,
                }),
            );

            return clustersClient;
        });
        return result ?? null;
    }

    /**
     * Prompts the user for credentials using a wizard.
     * @param wizardContext The wizard context.
     * @returns True if the wizard completed successfully; false if the user canceled or an error occurred.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [
                new ChooseAuthMethodStep(),
                new ProvideUserNameStep(),
                new ProvidePasswordStep(),
                new SaveCredentialsStep(),
            ],
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            showLoadingPrompt: true,
        });

        // Prompt the user for credentials
        await callWithTelemetryAndErrorHandling('connect.promptForCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.ConnectionsView;

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

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): vscode.TreeItem {
        let description: string | undefined = undefined;
        let tooltipMessage: string | undefined = undefined;

        if (this.cluster.emulatorConfiguration?.isEmulator) {
            // For emulator clusters, show TLS/SSL status if security is disabled
            if (this.cluster.emulatorConfiguration?.disableEmulatorSecurity) {
                description = l10n.t('⚠ TLS/SSL Disabled');
                tooltipMessage = l10n.t('⚠️ **Security:** TLS/SSL Disabled');
            } else {
                tooltipMessage = l10n.t('✅ **Security:** TLS/SSL Enabled');
            }
        } else {
            // For non-emulator clusters, show SKU if defined
            if (this.cluster.sku !== undefined) {
                description = `(${this.cluster.sku})`;
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.cluster.name,
            description: description,
            iconPath: this.cluster.emulatorConfiguration?.isEmulator
                ? new vscode.ThemeIcon('plug')
                : new vscode.ThemeIcon('server-environment'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            tooltip: new vscode.MarkdownString(tooltipMessage),
        };
    }
}
