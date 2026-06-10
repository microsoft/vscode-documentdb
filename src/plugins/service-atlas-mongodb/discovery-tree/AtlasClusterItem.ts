/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    createContextValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { Views } from '../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ChooseAuthMethodStep } from '../../../documentdb/wizards/authenticate/ChooseAuthMethodStep';
import { ProvidePasswordStep } from '../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ext } from '../../../extensionVariables';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { nonNullValue } from '../../../utils/nonNull';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type AtlasClusterModel } from '../models/AtlasClusterModel';

/** Resource type identifier for telemetry */
const RESOURCE_TYPE = 'atlas-mongodb-cluster';

/**
 * Tree item representing a MongoDB Atlas cluster within a project.
 * Extends ClusterItemBase to support expanding into databases,
 * credential caching, and the unified connection experience.
 */
export class AtlasClusterItem extends ClusterItemBase<AtlasClusterModel> {
    constructor(
        /**
         * Correlation ID for telemetry funnel analysis.
         * For statistics only - does not influence functionality.
         */
        journeyCorrelationId: string,
        cluster: TreeCluster<AtlasClusterModel>,
    ) {
        super(cluster);
        this.journeyCorrelationId = journeyCorrelationId;

        // Add enableAddToConnectionsCommand so the "Save to Connections" menu item appears
        this.contextValue = createContextValue([this.contextValue, 'enableAddToConnectionsCommand']);
    }

    /**
     * Returns the Atlas console URL for this cluster.
     */
    public getAtlasConsoleUrl(): string {
        return `https://cloud.mongodb.com/v2/${this.cluster.projectId}#/clusters/detail/${this.cluster.name}`;
    }

    /**
     * Returns credentials for this Atlas cluster.
     * Used by the "Save to Connections" flow (addConnectionFromRegistry command).
     *
     * Atlas clusters use native MongoDB auth (SCRAM username/password).
     * The connection string is already known from the Atlas Admin API.
     */
    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.resourceType = RESOURCE_TYPE;
            if (this.journeyCorrelationId) {
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
            }

            return {
                connectionString: nonNullValue(
                    this.cluster.connectionString,
                    'cluster.connectionString',
                    'AtlasClusterItem.ts',
                ),
                availableAuthMethods: [AuthMethodId.NativeAuth],
            };
        });
    }

    /**
     * Authenticates and connects to the MongoDB Atlas cluster.
     *
     * Atlas uses a two-layer auth model:
     * - Layer 1 (Atlas Admin API): OAuth or API Key — used only for discovery (listing clusters).
     * - Layer 2 (MongoDB wire protocol): SCRAM username/password — used to connect to the database.
     *
     * This method handles Layer 2: it prompts the user for their MongoDB database credentials,
     * caches them in CredentialCache, and establishes a ClustersClient connection.
     *
     * @returns ClustersClient if successful; null if the user cancels or auth fails.
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

            // Prepare wizard context — Atlas clusters support native auth only
            const wizardContext: AuthenticateWizardContext = {
                ...context,
                adminUserName: undefined,
                resourceName: this.cluster.name,
                availableAuthMethods: [AuthMethodId.NativeAuth],
            };

            // Prompt for credentials
            const credentialsProvided = await this.promptForCredentials(wizardContext);
            if (!credentialsProvided) {
                return null;
            }

            if (wizardContext.password) {
                context.valuesToMask.push(wizardContext.password);
            }

            // Cache credentials using clusterId (stable identifier) — NOT this.id (treeId)
            CredentialCache.setAuthCredentials(
                this.cluster.clusterId,
                nonNullValue(
                    wizardContext.selectedAuthMethod,
                    'wizardContext.selectedAuthMethod',
                    'AtlasClusterItem.ts',
                ),
                nonNullValue(this.cluster.connectionString, 'cluster.connectionString', 'AtlasClusterItem.ts'),
                wizardContext.selectedUserName || wizardContext.password
                    ? {
                          connectionUser: wizardContext.selectedUserName ?? '',
                          connectionPassword: wizardContext.password,
                      }
                    : undefined,
            );

            ext.outputChannel.append(
                l10n.t('Connecting to the cluster as "{username}"…', {
                    username: wizardContext.selectedUserName ?? '',
                }),
            );

            try {
                const clustersClient = await this.getClientWithProgress(this.cluster.clusterId);

                ext.outputChannel.appendLine(
                    l10n.t('Connected to the cluster "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );

                context.telemetry.measurements.connectionEstablishmentTimeMs = Date.now() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'success';
                context.telemetry.properties.connectionCorrelationId = clustersClient.connectionCorrelationId ?? '';

                return clustersClient;
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    context.telemetry.measurements.connectionEstablishmentTimeMs = Date.now() - connectionStartTime;
                    context.telemetry.properties.connectionResult = 'cancelled';
                    throw error;
                }

                context.telemetry.measurements.connectionEstablishmentTimeMs = Date.now() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'failed';
                context.telemetry.properties.connectionErrorType = error instanceof Error ? error.name : 'UnknownError';

                ext.outputChannel.appendLine(
                    l10n.t('Error: {error}', { error: error instanceof Error ? error.message : String(error) }),
                );

                void vscode.window.showErrorMessage(
                    l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                    {
                        modal: true,
                        detail:
                            l10n.t('Revisit connection details and try again.') +
                            '\n\n' +
                            l10n.t('Error: {error}', { error: error instanceof Error ? error.message : String(error) }),
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

    /**
     * Returns the tree item representation with Atlas-specific display.
     * Shows state icon, tier/provider/region description, and cluster metadata tooltip.
     */
    getTreeItem(): vscode.TreeItem {
        const stateIcon = this.getStateIcon();

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.cluster.name,
            description: this.buildDescription(),
            tooltip: this.buildTooltip(),
            iconPath: stateIcon,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Prompts the user for credentials using a wizard.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [new ChooseAuthMethodStep(), new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: l10n.t('Authenticate to Connect with Your Atlas Cluster'),
            showLoadingPrompt: true,
        });

        await callWithTelemetryAndErrorHandling('connect.promptForCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.credentialsRequired = 'true';
            context.telemetry.properties.credentialPromptReason = 'firstTime';

            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = false;
            try {
                await wizard.prompt();
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    wizardContext.aborted = true;
                }
            }
        });

        return !wizardContext.aborted;
    }

    private buildDescription(): string {
        const parts: string[] = [];

        if (this.cluster.instanceSizeName) {
            parts.push(this.cluster.instanceSizeName);
        }
        if (this.cluster.providerName) {
            parts.push(this.cluster.providerName);
        }
        if (this.cluster.regionName) {
            parts.push(this.formatRegion(this.cluster.regionName));
        }

        return parts.length > 0 ? parts.join(', ') : this.cluster.stateName;
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.cluster.name}**\n\n`);
        md.appendMarkdown(`- **State:** ${this.cluster.stateName}\n`);
        md.appendMarkdown(`- **Type:** ${this.cluster.clusterType}\n`);
        md.appendMarkdown(`- **MongoDB:** v${this.cluster.mongoDBVersion}\n`);

        if (this.cluster.instanceSizeName) {
            md.appendMarkdown(`- **Tier:** ${this.cluster.instanceSizeName}\n`);
        }
        if (this.cluster.providerName) {
            md.appendMarkdown(`- **Provider:** ${this.cluster.providerName}\n`);
        }
        if (this.cluster.regionName) {
            md.appendMarkdown(`- **Region:** ${this.formatRegion(this.cluster.regionName)}\n`);
        }

        md.appendMarkdown(`- **Project:** ${this.cluster.projectName}\n`);

        if (this.cluster.connectionString) {
            md.appendMarkdown(`\n---\n`);
            md.appendMarkdown(`Connection string available — expand to connect and browse databases.`);
        }

        return md;
    }

    private getStateIcon(): vscode.ThemeIcon {
        switch (this.cluster.stateName) {
            case 'IDLE':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
            case 'CREATING':
            case 'UPDATING':
            case 'REPAIRING':
                return new vscode.ThemeIcon('loading~spin');
            case 'DELETING':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconFailed'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private formatRegion(region: string): string {
        return region.replace(/_/g, '-').toLowerCase();
    }
}
