/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';
import { type Experience } from '../../DocumentDBExperiences';
import { ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { type EntraIdAuthConfig, type NativeAuthConfig } from '../../documentdb/auth/AuthConfig';
import { type AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ext } from '../../extensionVariables';
import { regionToDisplayName } from '../../utils/regionToDisplayName';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type TreeElementWithRetryChildren } from '../TreeElementWithRetryChildren';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { DatabaseItem } from './DatabaseItem';

/**
 * Full connection details for a DocumentDB cluster used at runtime during service discovery.
 *
 * This type intentionally contains concrete credentials because some service-discovery
 * flows provide ephemeral credentials from an external service rather than from stored connections.
 *
 * TODO: Maintainer notes:
 * - This type is a temporary bridge for service-discovery scenarios. The preferred
 *   long-term approach is an optional discovery API that returns connection info
 *   on demand so we avoid keeping credentials in memory longer than necessary.
 */
export type EphemeralClusterCredentials = {
    connectionString: string;
    availableAuthMethods: AuthMethodId[];
    selectedAuthMethod?: AuthMethodId; // some providers can pre-select a method

    // Authentication method specific configurations
    nativeAuthConfig?: NativeAuthConfig;
    entraIdAuthConfig?: EntraIdAuthConfig;
};

/**
 * @deprecated Use EphemeralClusterCredentials instead. This alias is provided for backward compatibility.
 */
export type ClusterCredentials = EphemeralClusterCredentials;

// This info will be available at every level in the tree for immediate access
export abstract class ClusterItemBase<T extends BaseClusterModel = BaseClusterModel>
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue, TreeElementWithRetryChildren
{
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_documentdbcluster';

    /**
     * Correlation ID used for telemetry funnel analysis.
     * This is for statistics only and does not influence functionality.
     * It tracks the user's journey through the discovery flow.
     */
    public journeyCorrelationId?: string;

    protected descriptionOverride?: string;
    protected tooltipOverride?: string | vscode.MarkdownString;

    protected iconPath?: IconPath;

    private readonly experienceContextValue: string = '';

    protected constructor(public cluster: TreeCluster<T>) {
        // Use treeId for VS Code tree element identification
        this.id = cluster.treeId ?? '';
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    /**
     * Abstract method to authenticate and connect to the MongoDB cluster.
     * Must be implemented by subclasses.
     *
     * @param context The action context.
     * @returns An instance of ClustersClient if successful; otherwise, null.
     */
    protected abstract authenticateAndConnect(): Promise<ClustersClient | null>;

    /**
     * Abstract method to get the credentials for the MongoDB cluster.
     * Must be implemented by subclasses.
     * This is relevant for service discovery scenarios
     *
     * @returns A promise that resolves to the EphemeralClusterCredentials if successful; otherwise, undefined.
     */
    public abstract getCredentials(): Promise<EphemeralClusterCredentials | undefined>;

    /**
     * Authenticates and connects to the cluster to list all available databases.
     * Here, the MongoDB client is created and cached for future use.
     *
     * In case of the Azure environment (DocumentDB), we might reach out to Azure to pull
     * the list of users known to the cluster.
     *
     * (These operations can be slow as they involve network and authentication calls.)
     *
     * Children of MongoClusterItemBase are databases in the cluster, available after authentication.
     *
     * @returns A list of databases in the cluster or a single element to create a new database.
     */
    async getChildren(): Promise<TreeElement[]> {
        ext.outputChannel.appendLine(l10n.t('Loading cluster details for "{cluster}"', { cluster: this.cluster.name }));

        let clustersClient: ClustersClient | null;

        // Check if credentials are cached, and return the cached client if available
        // Use clusterId for cache lookups - stable across folder moves
        if (CredentialCache.hasCredentials(this.cluster.clusterId)) {
            ext.outputChannel.appendLine(
                l10n.t('Reusing active connection for "{cluster}".', {
                    cluster: this.cluster.name,
                }),
            );
            clustersClient = await ClustersClient.getClient(this.cluster.clusterId);
        } else {
            // Call to the abstract method to authenticate and connect to the cluster
            clustersClient = await this.authenticateAndConnect();
        }

        // If authentication failed, return the error element
        if (!clustersClient) {
            ext.outputChannel.appendLine(`Failed to connect to "${this.cluster.name}".`);
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/reconnect`, // note: keep this in sync with the `hasRetryNode` function in this file
                    label: vscode.l10n.t('Click here to retry'),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    commandId: 'vscode-documentdb.command.internal.retry',
                    commandArgs: [this],
                }),
            ];
        }

        // List the databases
        return clustersClient.listDatabases().then((databases: DatabaseItemModel[]) => {
            if (databases.length === 0) {
                return [
                    createGenericElement({
                        contextValue: createContextValue(['treeItem_no-databases', this.experienceContextValue]),
                        id: `${this.id}/no-databases`,
                        label: l10n.t('Create Database…'),
                        iconPath: new vscode.ThemeIcon('plus'),
                        commandId: 'vscode-documentdb.command.createDatabase',
                        commandArgs: [this],
                    }) as TreeElement,
                ];
            }

            // Map the databases to DatabaseItem elements
            return databases.map((database) => new DatabaseItem(this.cluster, database));
        });
    }

    /**
     * Checks if the given children array contains an error node.
     * @param children The children array to check.
     * @returns True if any child in the array is an error node, false otherwise.
     */
    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        // Note: The check for `typeof child.id === 'string'` is necessary because `showCreatingChild`
        // can add temporary nodes that don't have an `id` property, which would otherwise cause a runtime error.
        return !!(
            children &&
            children.length > 0 &&
            children.some((child) => typeof child.id === 'string' && child.id.endsWith('/reconnect'))
        );
    }

    /**
     * Returns the tree item representation of the cluster.
     * Subclasses can override descriptionOverride and tooltipOverride for custom display.
     *
     * @returns The TreeItem object.
     */
    getTreeItem(): vscode.TreeItem {
        // Cast to access Azure-specific properties that may exist on AzureClusterModel subtypes
        // These properties are optional and checked at runtime
        const azureProps = this.cluster as unknown as Partial<AzureClusterModel>;

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.cluster.name,
            description: this.descriptionOverride
                ? this.descriptionOverride
                : azureProps.sku !== undefined
                  ? `(${azureProps.sku})`
                  : azureProps.serverVersion !== undefined
                    ? `v${azureProps.serverVersion}`
                    : false,
            iconPath: this.iconPath ?? undefined,
            tooltip: this.tooltipOverride
                ? this.tooltipOverride
                : new vscode.MarkdownString(
                      `### Cluster: ${this.cluster.name}\n\n` +
                          `---\n` +
                          (azureProps.location
                              ? `- Location: **${regionToDisplayName(azureProps.location)}**\n\n`
                              : '') +
                          (azureProps.diskSize ? `- Disk Size: **${azureProps.diskSize}GB**\n` : '') +
                          (azureProps.sku ? `- SKU: **${azureProps.sku}**\n` : '') +
                          (azureProps.enableHa !== undefined
                              ? `- High Availability: **${azureProps.enableHa ? 'Enabled' : 'Disabled'}**\n`
                              : '') +
                          (azureProps.nodeCount ? `- Node Count: **${azureProps.nodeCount}**\n\n` : '') +
                          (azureProps.serverVersion ? `- Server Version: **${azureProps.serverVersion}**\n` : '') +
                          (azureProps.capabilities ? `- Capabilities: **${azureProps.capabilities}**\n` : '') +
                          (azureProps.systemData?.createdAt
                              ? `---\n- Created Date: **${azureProps.systemData.createdAt.toLocaleString()}**\n`
                              : ''),
                  ),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
