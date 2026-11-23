/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    createGenericElement,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';
import { type Experience } from '../../DocumentDBExperiences';
import {
    addEstablishedConnectionContext,
    ClustersClient,
    type DatabaseItemModel,
} from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import {
    type EntraIdAuthConfig,
    type ManagedIdentityAuthConfig,
    type NativeAuthConfig,
} from '../../documentdb/auth/AuthConfig';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { isEntraDestinationRejectedError } from '../../documentdb/auth/oidcAllowedHosts';
import { classifyConnectionFailure, type ConnectionFailure } from '../../documentdb/connectionFailures';
import { ShellCommandIds } from '../../documentdb/shell/constants';
import { showClusterConnectFailure } from '../../documentdb/showClusterConnectFailure';
import { ext } from '../../extensionVariables';
import { SettingsService } from '../../services/SettingsService';
import { ErrorExplanationService } from '../../services/errorExplanationService';
import { settingsKeys } from '../../settingsKeys';
import { regionToDisplayName } from '../../utils/regionToDisplayName';
import { withDelayedProgress } from '../../utils/withProgress';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type TreeElementWithRetryChildren } from '../TreeElementWithRetryChildren';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { containsRetryNode, createRetryNode } from '../api/retryNode';
import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { DatabaseItem } from './DatabaseItem';
import { isAutoOpenDashboardSuppressed } from './autoOpenDashboardSuppression';
import { type DiagnosticClusterCredentials, type DiagnosticCredentialRead } from './diagnosticCredentialRead';

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
    /** An empty object selects the system-assigned identity, so absence and `{}` are different. */
    managedIdentityAuthConfig?: ManagedIdentityAuthConfig;

    // Additional non-secret storage properties needed by a discovery provider.
    connectionProperties?: Record<string, unknown>;
};

/**
 * @deprecated Use EphemeralClusterCredentials instead. This alias is provided for backward compatibility.
 */
export type ClusterCredentials = EphemeralClusterCredentials;

/**
 * Context-value tag identifying a DocumentDB cluster node.
 *
 * `contextValue` strings are built with azext-utils `createContextValue`, which de-duplicates and
 * joins multiple tags with ';'. A cluster node's contextValue is therefore composite (e.g.
 * `treeItem_documentdbcluster;experience_<api>`); the relative order of tags is not significant and
 * callers must match individual tags rather than the whole string. Providers can gate view-specific
 * error-recovery actions to clusters by checking for this tag (see `errorRecoveryActions` in
 * BaseExtendedTreeDataProvider). This constant is the single source of truth for the tag — import it
 * (e.g. in `clusterItemTypeGuard.ts`) rather than re-declaring the literal.
 */
export const CLUSTER_ITEM_CONTEXT_VALUE = 'treeItem_documentdbcluster';

// This info will be available at every level in the tree for immediate access
export abstract class ClusterItemBase<T extends BaseClusterModel = BaseClusterModel>
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue, TreeElementWithRetryChildren
{
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = CLUSTER_ITEM_CONTEXT_VALUE;

    /**
     * Correlation ID used for telemetry funnel analysis.
     * This is for statistics only and does not influence functionality.
     * It tracks the user's journey through the discovery flow.
     */
    public journeyCorrelationId?: string;
    public lastConnectionOutcome?: 'connected' | 'canceled' | 'failed';
    public lastConnectionFailureReason?: 'entraDestinationRejected';
    public lastConnectionFailureKind?: ConnectionFailure['kind'];
    public lastConnectionCorrelationId?: string;

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
     * Connects to the cluster, prompting for credentials if they are not cached yet.
     *
     * Tree expansion is not the only way a user reaches a cluster: commands such as
     * *Show Cluster Dashboard* are invoked straight from the context menu on a node that has
     * never been expanded, where no credentials exist. Refusing those with "not signed in"
     * and asking the user to go and expand the node first makes them perform the extension's
     * bookkeeping by hand. This exposes the same authentication the tree performs so a
     * command can just connect.
     *
     * Reuses a cached client when one exists, exactly as `getChildren` does, so calling this
     * on an already-connected cluster costs nothing.
     *
     * @returns A connected client, or `null` when authentication failed or the user cancelled —
     *          callers should abort quietly in that case, because the flow has already reported
     *          the reason, or the user asked for nothing to happen.
     * @throws Unreported failures from reusing a cached client, so the caller's command error
     *         handling can report them. Cancellation and reported destination rejections return null.
     */
    public async connect(): Promise<ClustersClient | null> {
        this.lastConnectionOutcome = undefined;
        this.lastConnectionFailureReason = undefined;
        this.lastConnectionCorrelationId = undefined;
        if (
            CredentialCache.hasCredentials(this.cluster.clusterId) ||
            ClustersClient.getLatchReason(this.cluster.clusterId)
        ) {
            if (!ClustersClient.getLatchReason(this.cluster.clusterId)) {
                await this.beforeCachedClientConnect();
            }

            try {
                return await this.getClientWithProgress(this.cluster.clusterId);
            } catch (error) {
                // Cancelling the progress notification is a request for nothing to happen, so it
                // must not surface as an error dialog. `getChildren` draws the same distinction;
                // without it, dismissing "Connecting to …" reports the user's own cancellation
                // back to them as a failure.
                if (error instanceof UserCancelledError) {
                    return null;
                }

                if (isEntraDestinationRejectedError(error)) {
                    await callWithTelemetryAndErrorHandling('connect', async (context) => {
                        context.errorHandling.suppressDisplay = true;
                        context.telemetry.maskEntireErrorMessage = true;
                        addEstablishedConnectionContext(context.telemetry, this.cluster.clusterId);
                        context.telemetry.properties.connectionResult = 'failed';
                        context.telemetry.properties.experience = this.experience.api;
                        context.telemetry.properties.failurePhase = 'cachedClientConnect';
                        await showClusterConnectFailure({
                            clusterId: this.cluster.clusterId,
                            clusterName: this.cluster.name,
                            error,
                            context,
                        });
                        throw error;
                    });
                    return null;
                }

                throw error;
            }
        }

        return this.authenticateAndConnect();
    }

    /**
     * Gives subclasses a chance to prepare connection-specific infrastructure
     * before a cached client is reused. For example, Kubernetes ClusterIP
     * connections may need to restore a port-forward tunnel.
     */
    protected async beforeCachedClientConnect(): Promise<void> {
        // Default cluster types do not need extra preparation.
    }

    /**
     * Abstract method to get the credentials for the MongoDB cluster.
     * Must be implemented by subclasses.
     * This is relevant for service discovery scenarios
     *
     * @returns A promise that resolves to the EphemeralClusterCredentials if successful; otherwise, undefined.
     */
    public abstract getCredentials(): Promise<EphemeralClusterCredentials | undefined>;

    /**
     * Reads the connection details for connection diagnostics: no UI, no tunnels, typed
     * failures (see `diagnosticCredentialRead.ts`). `undefined` means the connection no longer exists.
     *
     * The default suits nodes whose {@link getCredentials} only reads stored data. Override it when
     * `getCredentials()` calls a service, shows UI, prompts, or prepares the endpoint.
     */
    public getCredentialsForDiagnostics(
        _read: DiagnosticCredentialRead,
    ): Promise<DiagnosticClusterCredentials | undefined> {
        return this.getCredentials();
    }

    /**
     * Connects to the cluster using `ClustersClient.connectInteractive()`, showing a cancellable
     * notification so the user can abort a long-running connection attempt.
     *
     * @param clusterId - The stable cluster ID for cache and credential lookups.
     * @returns A promise that resolves to the connected `ClustersClient`.
     * @throws {UserCancelledError} if the user cancels the connection via the notification.
     */
    /**
     * Reports how this connect request's connection attempt ended, on its `connect` event:
     * `connectionResult`, plus the attempt's `connectionCorrelationId`. The ID joins the request
     * (which knows the view, provider and journey) to its `connect.startup` event (destination,
     * stage, duration), for failed attempts as well as successful ones. Call it only once an attempt
     * ran; a request that stopped before connecting (a closed prompt) reports neither.
     */
    protected reportConnectionAttempt(
        context: IActionContext,
        result: 'success' | 'failed',
        client?: ClustersClient,
    ): void {
        context.telemetry.properties.connectionResult = result;
        const correlationId = client?.connectionCorrelationId ?? this.lastConnectionCorrelationId;
        if (correlationId) {
            context.telemetry.properties.connectionCorrelationId = correlationId;
        }
    }

    protected async getClientWithProgress(
        clusterId: string,
        onReuse?: (client: ClustersClient | undefined) => void,
    ): Promise<ClustersClient> {
        const abortController = new AbortController();
        const clientPromise = ClustersClient.connectInteractive(
            clusterId,
            abortController.signal,
            (id) => {
                this.lastConnectionCorrelationId = id;
                if (onReuse) {
                    const client = ClustersClient.getExistingClient(clusterId);
                    onReuse(client?.connectionCorrelationId === id ? client : undefined);
                }
            },
            'treeConnect',
        );
        try {
            const client = await withDelayedProgress(
                clientPromise,
                {
                    location: vscode.ProgressLocation.Notification,
                    title: l10n.t('Connecting to "{cluster}"…', { cluster: this.cluster.name }),
                    cancellable: true,
                },
                () => {
                    ext.outputChannel.debug(
                        `User cancelled connection attempt for "${this.cluster.name}" via progress notification.`,
                    );
                    abortController.abort();
                },
            );
            this.lastConnectionOutcome = 'connected';
            this.lastConnectionFailureReason = undefined;
            return client;
        } catch (error) {
            this.lastConnectionOutcome = error instanceof UserCancelledError ? 'canceled' : 'failed';
            this.lastConnectionFailureReason = isEntraDestinationRejectedError(error)
                ? 'entraDestinationRejected'
                : undefined;
            throw error;
        }
    }

    /** First startup did not publish a binding. Classify without attributing it to a generation. */
    protected async finishFailedStartup(context: IActionContext, error: unknown, epoch: number): Promise<void> {
        const { clusterId } = this.cluster;
        const failure = this.classifyTreeFailure(error);
        context.telemetry.properties.connectionFailureKind = failure.kind;
        addEstablishedConnectionContext(context.telemetry, clusterId);
        if (ClustersClient.getEpoch(clusterId) !== epoch || failure.note === 'cancelled') {
            return;
        }
        this.lastConnectionFailureKind = failure.kind;
        if (ClustersClient.getLatchReason(clusterId)) {
            return;
        }
        const retainedEntraSettings = failure.kind === 'credentialsRejected' && this.canSignInAgain();
        if (failure.kind === 'other' || (failure.kind === 'credentialsRejected' && !retainedEntraSettings)) {
            CredentialCache.deleteCredentials(clusterId);
        }
        if (retainedEntraSettings || (failure.kind === 'credentialsRejected' && this.readReplacementKey)) {
            ClustersClient.latch(clusterId, 'credentialsRejected');
        }
        await ClustersClient.deleteClient(clusterId);
    }

    /** Only the two Azure RU item types can replace a rejected database key from ARM. */
    public readReplacementKey?(context: IActionContext): Promise<EphemeralClusterCredentials>;

    private classifyTreeFailure(error: unknown): ConnectionFailure {
        const method = CredentialCache.getCredentials(this.cluster.clusterId)?.authMechanism ?? AuthMethodId.NativeAuth;
        return classifyConnectionFailure(error, method);
    }

    private canSignInAgain(): boolean {
        const { clusterId } = this.cluster;
        const credentials = CredentialCache.getCredentials(clusterId);
        const identity = ClustersClient.getLastVerifiedIdentity(clusterId);
        return (
            credentials?.authMechanism === AuthMethodId.MicrosoftEntraID &&
            identity?.kind === 'entra' &&
            identity.tenantId === credentials.entraIdConfig?.tenantId
        );
    }

    /**
     * Builds the FAILURE-TYPE error-recovery nodes owned by the element layer.
     *
     * Includes either "sign in again" or "retry", plus diagnosis and "open shell". `hasRetryNode`
     * lets the provider detect the error state with either recovery action. The shell is offered for every
     * failure, including sign-in failures, so experts can investigate with the shell's own
     * connection and error output. View-specific recovery actions (e.g. "update credentials") are
     * added separately by the provider via `errorRecoveryActions`.
     *
     * Error-recovery nodes in this tree are produced by two layers:
     * - The ELEMENT layer (this class) owns FAILURE-TYPE nodes: "sign in again" or "retry", "diagnose" and
     *   "open shell", for any failure.
     * - The PROVIDER layer (a BranchDataProvider) owns VIEW-SPECIFIC nodes (e.g. "update
     *   credentials") via `errorRecoveryActions`, gated by the failing element's contextValue.
     */
    private createErrorRecoveryChildren(): TreeElement[] {
        const needsSignIn =
            (this.lastConnectionFailureKind === 'signInRequired' ||
                this.lastConnectionFailureKind === 'credentialsRejected') &&
            this.canSignInAgain();
        return [
            ...(needsSignIn
                ? [
                      createGenericElementWithContext({
                          contextValue: 'error',
                          id: `${this.id}/sign-in-again`,
                          label: vscode.l10n.t('Retry sign-in'),
                          iconPath: new vscode.ThemeIcon('sign-in'),
                          commandId: 'vscode-documentdb.command.signInAgain',
                          commandArgs: [this],
                      }),
                  ]
                : []),
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/diagnose`,
                label: vscode.l10n.t('Diagnose connection…'),
                iconPath: new vscode.ThemeIcon('debug-alt'),
                commandId: 'vscode-documentdb.command.diagnoseConnection',
                commandArgs: [this, undefined, 'errorNode'],
            }),
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/open-shell`,
                label: vscode.l10n.t('Open shell'),
                iconPath: new vscode.ThemeIcon('terminal'),
                commandId: ShellCommandIds.open,
                commandArgs: [this],
            }),
            ...(needsSignIn ? [] : [createRetryNode(this.id, this)]),
        ];
    }

    private async renderExpansionFailure(
        error: unknown,
        phase: 'cachedClientConnect' | 'listDatabases',
        failedClient?: ClustersClient,
        acquisitionEpoch?: number,
    ): Promise<TreeElement[]> {
        const { clusterId, name } = this.cluster;
        const failure = failedClient
            ? classifyConnectionFailure(error, failedClient.authMethod)
            : this.classifyTreeFailure(error);
        const destinationRejected = isEntraDestinationRejectedError(error);
        let children: TreeElement[] = [];
        const telemetry = callWithTelemetryAndErrorHandling('connect', async (context) => {
            context.errorHandling.suppressDisplay = true;
            context.telemetry.maskEntireErrorMessage = true;
            context.telemetry.properties.connectionResult = failure.note === 'cancelled' ? 'cancelled' : 'failed';
            context.telemetry.properties.source = 'treeExpansion';
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.failurePhase = phase;
            if (failedClient?.binding) {
                addEstablishedConnectionContext(context.telemetry, failedClient);
                const kind = ClustersClient.reportFailure(failedClient.binding, error);
                if (!kind && failure.note !== 'cancelled') {
                    return;
                }
                this.lastConnectionFailureKind = kind;
            } else {
                if (
                    acquisitionEpoch !== undefined &&
                    ClustersClient.getEpoch(clusterId) !== acquisitionEpoch &&
                    failure.note !== 'cancelled' &&
                    failure.note !== 'alreadyUnavailable'
                ) {
                    return;
                }
                addEstablishedConnectionContext(context.telemetry, clusterId);
                this.lastConnectionFailureKind = failure.kind;
                if (this.lastConnectionCorrelationId) {
                    context.telemetry.properties.connectionCorrelationId = this.lastConnectionCorrelationId;
                }
                // A failed replacement startup has no published generation of its own.
                if (
                    failure.kind === 'credentialsRejected' &&
                    !failure.note &&
                    (this.canSignInAgain() || this.readReplacementKey) &&
                    !ClustersClient.getLatchReason(clusterId)
                ) {
                    ClustersClient.latch(clusterId, 'credentialsRejected');
                }
            }
            context.telemetry.properties.connectionFailureKind = failure.kind;
            if (failure.note === 'cancelled') {
                this.lastConnectionOutcome = 'canceled';
                throw error;
            }
            this.lastConnectionOutcome = 'failed';
            this.lastConnectionFailureReason = destinationRejected ? 'entraDestinationRejected' : undefined;
            children = this.createErrorRecoveryChildren();
            if (destinationRejected) {
                await showClusterConnectFailure({ clusterId, clusterName: name, error, context });
            } else {
                const renderingEpoch = ClustersClient.getEpoch(clusterId);
                const explanation = await ErrorExplanationService.explain({ clusterId, error });
                if (ClustersClient.getEpoch(clusterId) !== renderingEpoch) {
                    children = [];
                    return;
                }
                context.telemetry.properties.explanationProviderId = explanation?.providerId ?? 'none';
                const heading =
                    explanation?.message ??
                    (phase === 'listDatabases'
                        ? vscode.l10n.t('Failed to load databases for "{0}"', name)
                        : vscode.l10n.t('Failed to connect to "{0}"', name));
                const detail =
                    failure.note === 'alreadyUnavailable' && this.lastConnectionFailureKind === 'signInRequired'
                        ? vscode.l10n.t('Sign in again to continue using this connection.')
                        : error instanceof Error
                          ? error.message
                          : String(error);
                void vscode.window.showErrorMessage(heading, { modal: true, detail });
            }
            throw error;
        });
        await telemetry;
        return children;
    }

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

        const wasConnected = ClustersClient.exists(this.cluster.clusterId);
        this.lastConnectionOutcome = undefined;
        this.lastConnectionFailureReason = undefined;
        this.lastConnectionFailureKind = undefined;
        this.lastConnectionCorrelationId = undefined;
        let clustersClient: ClustersClient | null;

        // Check if credentials are cached, and return the cached client if available
        // Use clusterId for cache lookups - stable across folder moves
        const clusterId = this.cluster.clusterId;
        if (CredentialCache.hasCredentials(clusterId) || ClustersClient.getLatchReason(clusterId)) {
            ext.outputChannel.appendLine(
                l10n.t('Reusing active connection for "{cluster}".', {
                    cluster: this.cluster.name,
                }),
            );
            let reusedClient: ClustersClient | undefined;
            let acquisitionEpoch = ClustersClient.getEpoch(clusterId);
            try {
                if (!ClustersClient.getLatchReason(clusterId)) {
                    await this.beforeCachedClientConnect();
                }
                acquisitionEpoch = ClustersClient.getEpoch(clusterId);
                clustersClient = await this.getClientWithProgress(clusterId, (client) => {
                    reusedClient = client;
                });
            } catch (error) {
                return this.renderExpansionFailure(error, 'cachedClientConnect', reusedClient, acquisitionEpoch);
            }
        } else {
            // Call to the abstract method to authenticate and connect to the cluster
            clustersClient = await this.authenticateAndConnect();
        }

        // If authentication failed or cancelled, return the error element
        if (!clustersClient) {
            this.lastConnectionOutcome ??= 'failed';
            ext.outputChannel.appendLine(l10n.t('Could not connect to "{cluster}".', { cluster: this.cluster.name }));
            return this.createErrorRecoveryChildren();
        }

        // List the databases.
        //
        // The connection itself may have succeeded while the server still rejects this request —
        // for example an anonymous ("No Authentication") connection against a server that actually
        // requires credentials fails here with "Command listDatabases is not allowed as the
        // connection is not authenticated yet". Without handling, the rejected promise would throw
        // out of getChildren(), leaving the tree with no children and — crucially — no way for the
        // user to retry. We therefore catch the failure, record telemetry, surface a modal error,
        // and return a retry node (mirroring the `!clustersClient` branch above).
        let databases: DatabaseItemModel[];
        const connectedClient = clustersClient;
        try {
            databases = await connectedClient.listDatabases();
        } catch (error) {
            return this.renderExpansionFailure(error, 'listDatabases', connectedClient);
        }

        // A deep link that opens the dashboard itself suppresses the automatic open; that is not a skip.
        if (!wasConnected && !isAutoOpenDashboardSuppressed(this.cluster.clusterId)) {
            if (SettingsService.getSetting<boolean>(settingsKeys.showDashboardOnConnect) ?? true) {
                await vscode.commands.executeCommand('vscode-documentdb.command.clusterDashboard.open', this, null, {
                    activationSource: 'autoOpenOnConnect',
                });
            } else {
                // The counterpart of an automatic open: without it, people who turned automatic
                // opening off in Settings, rather than from the dashboard, are invisible.
                void callWithTelemetryAndErrorHandling('clusterDashboard.autoOpenSkipped', (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.reason = 'settingDisabled';
                    context.telemetry.properties.experience = this.experience.api;
                });
            }
        }

        if (databases.length === 0) {
            return [
                createGenericElement({
                    contextValue: createContextValue(['treeItem_no-databases', this.experienceContextValue]),
                    id: `${this.id}/no-databases`,
                    label: l10n.t('Create Database…'),
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'vscode-documentdb.command.createDatabase',
                    commandArgs: [this, null, { activationSource: 'treeEmptyPlaceholder' }],
                }) as TreeElement,
            ];
        }

        // Sort databases alphabetically by name
        databases.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Map the databases to DatabaseItem elements
        return databases.map((database) => {
            const databaseItem = new DatabaseItem(this.cluster, database);
            databaseItem.journeyCorrelationId = this.journeyCorrelationId;
            // Start loading collection count in background (fire-and-forget).
            databaseItem.loadCollectionCount();
            return databaseItem;
        });
    }

    /**
     * Detect a failed expansion even when the sign-in action replaces the Retry row.
     */
    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            containsRetryNode(children) || children?.some((child) => child.id === `${this.id}/sign-in-again`) === true
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
