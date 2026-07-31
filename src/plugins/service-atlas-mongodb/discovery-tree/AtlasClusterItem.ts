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
import { escapeMarkdown } from '../../../webviews/utils/escapeMarkdown';
import { AtlasApiClient } from '../api/AtlasApiClient';
import { isAtlasTlsHandshakeRejection } from '../atlasConnectionErrors';
import { buildAtlasNetworkAccessUrl } from '../atlasDeepLinks';
import { atlasTrace, monotonicNow } from '../atlasTrace';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { toAtlasDatabaseUserCandidates, type AtlasDatabaseUserCandidate } from '../connect/atlasDatabaseUsers';
import { SelectAtlasDatabaseUserStep } from '../connect/SelectAtlasDatabaseUserStep';
import { type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { type AtlasClusterModel } from '../models/AtlasClusterModel';
import { type AtlasClusterState } from '../models/AtlasProjectModel';

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
        /**
         * Context shown instead of the tier/region description, used by List mode to render
         * `organization · project` next to a flat cluster row.
         */
        private readonly contextDescription?: string,
        /**
         * The discovery service and the credential that surfaced this cluster. Optional so the
         * item stays constructible without them; when absent the sign-in flow simply asks for a
         * username instead of offering the project's database users.
         */
        private readonly discovery?: { service: AtlasDiscoveryService; ownerCredentialId: string },
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
     * Lists the database users that apply to this cluster, for the username prompt.
     *
     * Reuses the very credential that discovered the cluster, so no extra sign-in is involved and
     * the call needs no permission the user has not already granted. Failures propagate to the
     * step, which downgrades to a plain username prompt rather than blocking sign-in.
     */
    private async listDatabaseUserCandidates(signal: AbortSignal): Promise<AtlasDatabaseUserCandidate[]> {
        if (!this.discovery) {
            return [];
        }

        const { service, ownerCredentialId } = this.discovery;
        const session = await service.sessionRegistry.getSession(ownerCredentialId);
        if (!session) {
            atlasTrace(`cluster "${this.cluster.name}": no usable session, skipping the database user lookup`);
            return [];
        }

        const client = new AtlasApiClient(session, service.sessionRegistry.refresherFor(ownerCredentialId));
        const users = await client.listDatabaseUsers(this.cluster.projectId, signal);

        return toAtlasDatabaseUserCandidates(users, this.cluster.name);
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

            // "Save to Connections" is offered even for a non-IDLE / connection-string-less cluster.
            // Explain why it cannot be saved instead of tripping the internal `nonNullValue` assert.
            if (!this.isConnectable()) {
                void vscode.window.showWarningMessage(this.describeUnavailable());
                return undefined;
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
     * - Layer 1 (Atlas Admin API): API Key or Service Account — used only for discovery (listing clusters).
     * - Layer 2 (MongoDB wire protocol): SCRAM username/password — used to connect to the database.
     *
     * This method handles Layer 2: it prompts the user for their MongoDB database credentials,
     * caches them in CredentialCache, and establishes a ClustersClient connection.
     *
     * @returns ClustersClient if successful; null if the user cancels or auth fails.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            const connectionStartTime = monotonicNow();
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.connectionInitiatedFrom = 'discoveryView';
            context.telemetry.properties.resourceType = RESOURCE_TYPE;
            if (this.journeyCorrelationId) {
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
            }

            // Defense in depth: the tree marks a non-connectable cluster as a leaf, but if this is
            // reached anyway, explain why rather than tripping the internal connection-string assert.
            if (!this.isConnectable()) {
                void vscode.window.showWarningMessage(this.describeUnavailable());
                return null;
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

                context.telemetry.measurements.connectionEstablishmentTimeMs = monotonicNow() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'success';
                context.telemetry.properties.connectionCorrelationId = clustersClient.connectionCorrelationId ?? '';

                return clustersClient;
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    context.telemetry.measurements.connectionEstablishmentTimeMs = monotonicNow() - connectionStartTime;
                    context.telemetry.properties.connectionResult = 'cancelled';
                    throw error;
                }

                context.telemetry.measurements.connectionEstablishmentTimeMs = monotonicNow() - connectionStartTime;
                context.telemetry.properties.connectionResult = 'failed';
                context.telemetry.properties.connectionErrorType = error instanceof Error ? error.name : 'UnknownError';

                ext.outputChannel.appendLine(
                    l10n.t('Error: {error}', { error: error instanceof Error ? error.message : String(error) }),
                );

                await this.showConnectionFailure(context, error);

                // Clean up failed connection
                await ClustersClient.deleteClient(this.cluster.clusterId);
                CredentialCache.deleteCredentials(this.cluster.clusterId);

                return null;
            }
        });

        return result ?? null;
    }

    /**
     * Reports a failed connection attempt.
     *
     * A TLS-level failure gets its own wording. What can be stated with confidence is only what
     * the error itself proves: the connection died at the transport layer, and that is not the
     * shape of an authentication rejection, which arrives as `bad auth : Authentication failed`.
     * Naming a single cause would be a guess. MongoDB documents that the project IP access list
     * gates client connections, but it does not document that a blocked address surfaces as this
     * particular alert, so the modal lists what to check rather than claiming a diagnosis.
     */
    private async showConnectionFailure(context: IActionContext, error: unknown): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (!isAtlasTlsHandshakeRejection(error)) {
            context.telemetry.properties.atlasConnectionFailureKind = 'other';
            void vscode.window.showErrorMessage(
                l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
                {
                    modal: true,
                    detail:
                        l10n.t('Revisit connection details and try again.') +
                        '\n\n' +
                        l10n.t('Error: {error}', { error: errorMessage }),
                },
            );
            return;
        }

        context.telemetry.properties.atlasConnectionFailureKind = 'tlsFailure';

        const openNetworkAccess = l10n.t('Open Network Access in Atlas');
        const selected = await vscode.window.showErrorMessage(
            l10n.t('Failed to connect to "{cluster}"', { cluster: this.cluster.name }),
            {
                modal: true,
                detail:
                    l10n.t(
                        'MongoDB Atlas closed the TLS connection with an internal error. This is a transport-level failure rather than an authentication response, so it is not what an incorrect username or password looks like: those report "bad auth : Authentication failed".',
                    ) +
                    '\n\n' +
                    l10n.t('Worth checking in MongoDB Atlas:') +
                    '\n' +
                    l10n.t('- Is this machine\u2019s IP address on the project\u2019s IP access list?') +
                    '\n' +
                    l10n.t('- Is the cluster paused, or still being provisioned?') +
                    '\n\n' +
                    l10n.t('Error: {error}', { error: errorMessage }),
            },
            openNetworkAccess,
        );

        if (selected === openNetworkAccess) {
            context.telemetry.properties.atlasNetworkAccessOpened = 'true';
            await vscode.env.openExternal(vscode.Uri.parse(buildAtlasNetworkAccessUrl(this.cluster.projectId)));
        }
    }

    /**
     * Returns the tree item representation with Atlas-specific display.
     *
     * Deliberately does NOT use `vscode-documentdb-cluster-{light,dark}-themes.svg`. Those
     * files are byte-identical copies of the DocumentDB product logo, so stamping them on an
     * Atlas cluster would brand somebody else's managed service as DocumentDB. The Kubernetes
     * plugin does use them, and correctly so: it discovers actual DocumentDB deployments.
     *
     * `server-environment` is the same neutral codicon the Connections view already draws for a
     * non-emulator cluster, so a discovered Atlas cluster and a saved one read the same.
     * The icon stays fixed across refreshes; transient cluster state is carried by the
     * description and tooltip instead.
     */
    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.cluster.name,
            description: this.buildDescription(),
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('server-environment'),
            // A non-IDLE cluster, or one Atlas has not published a connection string for yet, cannot
            // be connected to. Mark it as a leaf so expanding it does not reach an internal
            // assertion; the tooltip explains why. This mirrors the wizard's guard in
            // `SelectAtlasClusterStep`, so the two surfaces agree.
            collapsibleState: this.isConnectable()
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        };
    }

    /** IDLE with a known connection string is the only state a cluster can be opened from. */
    private isConnectable(): boolean {
        return this.cluster.stateName === 'IDLE' && !!this.cluster.connectionString;
    }

    /** Localized reason a non-connectable cluster cannot be opened, for tooltips and guards. */
    private describeUnavailable(): string {
        return (
            this.getStateExplanation() ??
            l10n.t(
                'This cluster does not expose a connection string yet. Try refreshing once it finishes provisioning.',
            )
        );
    }

    /**
     * Prompts the user for credentials using a wizard.
     */
    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [
                new ChooseAuthMethodStep(),
                new SelectAtlasDatabaseUserStep((signal) => this.listDatabaseUserCandidates(signal), this.cluster.name),
                new ProvideUserNameStep(),
                new ProvidePasswordStep(),
            ],
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

        if (this.contextDescription) {
            // List mode already carries the organization and project, so repeating the tier here
            // would only add noise. State is still worth showing when it is not IDLE.
            parts.push(this.contextDescription);
        } else if (this.cluster.instanceSizeName) {
            // The tier (e.g. "M10") should show. When the tier is unavailable (e.g. serverless clusters), fall back to the provider/region pair.
            parts.push(this.cluster.instanceSizeName);
        } else {
            if (this.cluster.providerName) {
                parts.push(this.cluster.providerName);
            }
            if (this.cluster.regionName) {
                parts.push(this.formatRegion(this.cluster.regionName));
            }
        }

        const stateLabel = this.getStateLabel();
        if (stateLabel) {
            parts.push(stateLabel);
        }

        return parts.join(' · ');
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`**${escapeMarkdown(this.cluster.name)}**\n\n`);

        // One localized field list so every label defaults to being translated. "Server version"
        // (not "MongoDB") both localizes the label and avoids using "MongoDB" as a standalone
        // product name, per the repository terminology policy.
        const fields: Array<[string, string | undefined]> = [
            [l10n.t('State'), this.cluster.stateName],
            [l10n.t('Type'), this.cluster.clusterType],
            [l10n.t('Server version'), this.cluster.mongoDBVersion ? `v${this.cluster.mongoDBVersion}` : undefined],
            [l10n.t('Tier'), this.cluster.instanceSizeName],
            [l10n.t('Provider'), this.cluster.providerName],
            [l10n.t('Region'), this.cluster.regionName ? this.formatRegion(this.cluster.regionName) : undefined],
            [l10n.t('Project'), this.cluster.projectName],
        ];

        for (const [label, value] of fields) {
            if (value) {
                md.appendMarkdown(`- **${label}:** ${escapeMarkdown(value)}\n`);
            }
        }

        const stateExplanation = this.getStateExplanation();
        if (stateExplanation) {
            md.appendMarkdown(`\n---\n`);
            md.appendMarkdown(escapeMarkdown(stateExplanation));
            return md;
        }

        md.appendMarkdown(`\n---\n`);
        md.appendMarkdown(
            this.cluster.connectionString
                ? l10n.t('Connection string available — expand to connect and browse databases.')
                : escapeMarkdown(this.describeUnavailable()),
        );

        return md;
    }

    /**
     * Returns a short, localized label for the current cluster state, or `undefined` for the
     * normal IDLE state (which needs no annotation). Shown in the tree item description.
     */
    private getStateLabel(): string | undefined {
        const labels: Record<AtlasClusterState, string | undefined> = {
            IDLE: undefined,
            CREATING: l10n.t('Creating…'),
            UPDATING: l10n.t('Updating…'),
            REPAIRING: l10n.t('Repairing…'),
            DELETING: l10n.t('Deleting…'),
            UNKNOWN: l10n.t('Unknown state'),
        };
        return labels[this.cluster.stateName];
    }

    /**
     * Returns a localized, human-readable explanation of a non-IDLE cluster state for the
     * tooltip, or `undefined` when the cluster is IDLE.
     */
    private getStateExplanation(): string | undefined {
        switch (this.cluster.stateName) {
            case 'CREATING':
                return l10n.t(
                    'This cluster is being created. It will be available to connect once creation is complete.',
                );
            case 'UPDATING':
                return l10n.t('This cluster is being updated. It may be temporarily unavailable.');
            case 'REPAIRING':
                return l10n.t('This cluster is being repaired. It may be temporarily unavailable.');
            case 'DELETING':
                return l10n.t('This cluster is being deleted and will no longer be available.');
            case 'UNKNOWN':
                return l10n.t('This cluster is in an unknown state. Try refreshing to update its status.');
            case 'IDLE':
            default:
                return undefined;
        }
    }

    private formatRegion(region: string): string {
        return region.replace(/_/g, '-').toLowerCase();
    }
}
