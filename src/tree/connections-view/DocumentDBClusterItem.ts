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
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { nonNullProp } from '../../utils/nonNull';

import {
    authMethodFromString,
    AuthMethodId,
    authMethodsFromString,
    getAuthMethod,
    isSupportedAuthMethod,
} from '../../documentdb/auth/AuthMethod';
import { showConnectionFailedAndMaybeOfferDecodedRetry } from '../../documentdb/auth/urlEncodedPassword';
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
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../documentdb/ClusterItemBase';
import { type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElementWithStorageId } from '../TreeElementWithStorageId';
import { type ConnectionClusterModel } from './models/ConnectionClusterModel';

/**
 * Escapes markdown special characters so user-provided text is always rendered
 * as plain text rather than being interpreted as markdown formatting or links.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&');
}

export class DocumentDBClusterItem extends ClusterItemBase<ConnectionClusterModel> implements TreeElementWithStorageId {
    public override readonly cluster: TreeCluster<ConnectionClusterModel>;

    constructor(mongoCluster: TreeCluster<ConnectionClusterModel>) {
        super(mongoCluster);
        this.cluster = mongoCluster; // Explicit initialization
    }

    public get storageId(): string {
        return this.cluster.storageId;
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        const connectionType = this.cluster.emulatorConfiguration?.isEmulator
            ? ConnectionType.Emulators
            : ConnectionType.Clusters;
        const connectionCredentials = await ConnectionStorageService.get(this.storageId, connectionType);

        if (!connectionCredentials || !isConnection(connectionCredentials)) {
            return undefined;
        }

        return {
            connectionString: connectionCredentials.secrets.connectionString,
            availableAuthMethods: authMethodsFromString(connectionCredentials.properties.availableAuthMethods),
            selectedAuthMethod: authMethodFromString(connectionCredentials.properties.selectedAuthMethod),

            // Structured auth configurations
            nativeAuthConfig: connectionCredentials.secrets.nativeAuthConfig,
            entraIdAuthConfig: connectionCredentials.secrets.entraIdAuthConfig
                ? {
                      tenantId: connectionCredentials.secrets.entraIdAuthConfig.tenantId,
                  }
                : undefined,
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
            context.telemetry.properties.connectionInitiatedFrom = Views.ConnectionsView;

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            const connectionType = this.cluster.emulatorConfiguration?.isEmulator
                ? ConnectionType.Emulators
                : ConnectionType.Clusters;

            context.telemetry.properties.connectionType = connectionType;

            const connectionCredentials = await ConnectionStorageService.get(this.storageId, connectionType);

            if (!connectionCredentials || !isConnection(connectionCredentials)) {
                return null;
            }

            const connectionString = new DocumentDBConnectionString(connectionCredentials.secrets.connectionString);

            // Use nativeAuthConfig for credentials
            let username: string | undefined = connectionCredentials.secrets.nativeAuthConfig?.connectionUser;
            let password: string | undefined = connectionCredentials.secrets.nativeAuthConfig?.connectionPassword;
            let authMethod: AuthMethodId | undefined = authMethodFromString(
                connectionCredentials.properties.selectedAuthMethod,
            );

            /**
             * Prompt for credentials if no auth method selected or
             * native auth but no username/password set
             */
            if (
                !authMethod ||
                (authMethod === AuthMethodId.NativeAuth &&
                    (!username || username.length === 0 || !password || password.length === 0))
            ) {
                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    availableAuthMethods: authMethodsFromString(connectionCredentials.properties.availableAuthMethods),
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
                authMethod = nonNullProp(
                    wizardContext,
                    'selectedAuthMethod',
                    'wizardContext.selectedAuthMethod',
                    'DocumentDBClusterItem.ts',
                );

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
                    if (connection && isConnection(connection)) {
                        connection.properties.selectedAuthMethod = authMethod;
                        connection.secrets = {
                            connectionString: connectionString.toString(),
                            // Populate nativeAuthConfig configuration
                            nativeAuthConfig:
                                authMethod === AuthMethodId.NativeAuth && (username || password)
                                    ? {
                                          connectionUser: username ?? '',
                                          connectionPassword: password ?? '',
                                      }
                                    : undefined,
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
                case AuthMethodId.MicrosoftEntraID:
                    ext.outputChannel.append(l10n.t('Connecting to the cluster using Entra ID…'));
                    break;
                default:
                    ext.outputChannel.append(
                        l10n.t('Connecting to the cluster as "{username}"…', {
                            username: username ?? '',
                        }),
                    );
            }

            // Cache the credentials using clusterId for stable caching across folder moves
            CredentialCache.setAuthCredentials(
                this.cluster.clusterId,
                authMethod,
                connectionString.toString(),
                username && password
                    ? {
                          connectionUser: username,
                          connectionPassword: password,
                      }
                    : undefined,
                this.cluster.emulatorConfiguration, // workspace items can potentially be connecting to an emulator, so we always pass it
                connectionCredentials.secrets.entraIdAuthConfig,
            );

            let clustersClient: ClustersClient;

            // Attempt to create the client with the provided credentials
            try {
                clustersClient = await this.getClientWithProgress(this.cluster.clusterId);
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    context.telemetry.properties.connectionResult = 'cancelled';
                    throw error;
                }
                ext.outputChannel.appendLine(
                    l10n.t('Error: {error}', { error: error instanceof Error ? error.message : String(error) }),
                );

                // If the password looks URL-encoded (e.g. copy-pasted from a connection URL),
                // offer a single, user-confirmed retry with the decoded value. We never
                // silently decode-and-retry to avoid tripping server-side lockout policies.
                const { decodedPassword } = await showConnectionFailedAndMaybeOfferDecodedRetry({
                    clusterName: this.cluster.name,
                    password,
                    isNativeAuth: authMethod === AuthMethodId.NativeAuth,
                    originalError: error,
                    context,
                });

                if (decodedPassword) {
                    context.valuesToMask.push(decodedPassword);

                    CredentialCache.setAuthCredentials(
                        this.cluster.clusterId,
                        authMethod,
                        connectionString.toString(),
                        { connectionUser: username ?? '', connectionPassword: decodedPassword },
                        this.cluster.emulatorConfiguration,
                        connectionCredentials.secrets.entraIdAuthConfig,
                    );

                    await ClustersClient.deleteClient(this.cluster.clusterId);

                    try {
                        clustersClient = await this.getClientWithProgress(this.cluster.clusterId);

                        ext.outputChannel.appendLine(
                            l10n.t('Connected to the cluster "{cluster}" using decoded password.', {
                                cluster: this.cluster.name,
                            }),
                        );
                        context.telemetry.properties.urlDecodePasswordResult = 'succeeded';

                        // Offer to persist the corrected password so the user does not have to retry next time.
                        const updateButton = l10n.t('Update Saved Password');
                        const saveChoice = await vscode.window.showInformationMessage(
                            l10n.t(
                                'Connected to "{cluster}" using the decoded password. Would you like to update your saved credentials?',
                                { cluster: this.cluster.name },
                            ),
                            { modal: false },
                            updateButton,
                        );

                        if (saveChoice === updateButton) {
                            connectionCredentials.secrets.nativeAuthConfig = {
                                connectionUser: username ?? '',
                                connectionPassword: decodedPassword,
                            };
                            await ConnectionStorageService.save(connectionType, connectionCredentials, true);
                            context.telemetry.properties.urlDecodePasswordSaved = 'true';
                        }

                        return clustersClient;
                    } catch (retryErr: unknown) {
                        const retryError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
                        ext.outputChannel.appendLine(l10n.t('Retry Error: {error}', { error: retryError.message }));
                        context.telemetry.properties.urlDecodePasswordResult = 'failed';

                        void vscode.window.showErrorMessage(
                            l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                            {
                                modal: true,
                                detail:
                                    l10n.t('Revisit connection details and try again.') +
                                    '\n\n' +
                                    l10n.t('Error: {error}', { error: retryError.message }),
                            },
                        );
                    }
                }

                // If connection fails, remove cached credentials
                await ClustersClient.deleteClient(this.cluster.clusterId);
                CredentialCache.deleteCredentials(this.cluster.clusterId);

                // Return null to indicate failure
                return null;
            }

            ext.outputChannel.appendLine(
                l10n.t('Connected to the cluster "{cluster}".', {
                    cluster: this.cluster.name,
                }),
            );

            context.telemetry.properties.connectionCorrelationId = clustersClient.connectionCorrelationId ?? '';

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
        if (
            this.cluster.emulatorConfiguration?.isEmulator &&
            this.cluster.emulatorConfiguration?.disableEmulatorSecurity
        ) {
            description = l10n.t('⚠ TLS/SSL Disabled');
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
            tooltip: this.buildTooltip(),
        };
    }

    /**
     * Builds a markdown tooltip showing the connection name, host, auth method,
     * username (SCRAM only), and emulator security status.
     *
     * The cluster name is escaped so it always renders as plain text regardless
     * of characters that might otherwise be interpreted as markdown links or formatting.
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`### ${escapeMarkdown(this.cluster.name)}\n\n`);

        // Host(s) from the connection string
        const hosts = this.getHosts();
        if (hosts.length > 0) {
            const escapedHosts = hosts.map((host) => escapeMarkdown(host));
            md.appendMarkdown(`**${l10n.t('Host')}:** ${escapedHosts.join(', ')}\n\n`);
        }

        // Auth method
        const authMethodId = this.cluster.selectedAuthMethod;
        if (authMethodId) {
            const isSupported = isSupportedAuthMethod(authMethodId);
            const authLabel = isSupported ? getAuthMethod(authMethodId).label : authMethodId;
            md.appendMarkdown(`**${l10n.t('Auth')}:** ${escapeMarkdown(authLabel)}\n\n`);

            if (isSupported && authMethodId === AuthMethodId.NativeAuth && this.cluster.connectionUser) {
                md.appendMarkdown(`**${l10n.t('User')}:** ${escapeMarkdown(this.cluster.connectionUser)}\n\n`);
            }
        }

        // Emulator security notice
        if (this.cluster.emulatorConfiguration?.isEmulator) {
            if (this.cluster.emulatorConfiguration.disableEmulatorSecurity) {
                md.appendMarkdown(`⚠️ **${l10n.t('Security')}:** ${l10n.t('TLS/SSL Disabled')}\n\n`);
            } else {
                md.appendMarkdown(`✅ **${l10n.t('Security')}:** ${l10n.t('TLS/SSL Enabled')}\n\n`);
            }
        }

        return md;
    }

    /**
     * Extracts the host(s) from the connection string for display in the tooltip.
     * Returns an empty array if the connection string is unavailable or unparseable.
     */
    private getHosts(): string[] {
        if (!this.cluster.connectionString) {
            return [];
        }
        try {
            return new DocumentDBConnectionString(this.cluster.connectionString).hosts ?? [];
        } catch {
            return [];
        }
    }
}
