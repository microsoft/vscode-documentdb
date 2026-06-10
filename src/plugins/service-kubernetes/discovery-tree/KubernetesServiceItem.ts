/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CoreV1Api, type KubeConfig } from '@kubernetes/client-node';
import {
    UserCancelledError,
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { type ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { type BaseClusterModel, type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { getResourcesPath } from '../../../utils/icons';
import { DISCOVERY_PROVIDER_ID } from '../config';
import {
    buildPortForwardConnectionString,
    createCoreApi,
    loadConfiguredKubeConfig,
    resolveDocumentDBCredentials,
    resolveGenericServiceCredentials,
    resolveServiceEndpoint,
    type KubeContextInfo,
    type KubeServiceEndpoint,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KUBERNETES_PORT_FORWARD_METADATA_PROPERTY, createKubernetesPortForwardMetadata } from '../portForwardMetadata';
import { PortForwardTunnelManager } from '../portForwardTunnel';
import { promptForLocalPort } from '../promptForLocalPort';
import { getSource } from '../sources/sourceStore';

/**
 * Model for a Kubernetes-discovered service, extending BaseClusterModel.
 */
export interface KubernetesServiceModel extends BaseClusterModel {
    /** Kubernetes context name */
    contextName: string;
    /** Namespace the service belongs to */
    namespace: string;
    /** Service type: ClusterIP, NodePort, LoadBalancer */
    serviceType: string;
    /** Service port */
    servicePort: number;
    /** NodePort (for NodePort services) */
    nodePort?: number;
    /** External address (for LoadBalancer services) */
    externalAddress?: string;
}

interface ResolvedConnectionDetails {
    readonly connectionString: string;
    readonly connectionProperties?: Record<string, unknown>;
}

interface ResolveConnectionOptions {
    readonly startPortForward: boolean;
}

interface ReachabilityInfo {
    /**
     * The connectivity shortcut shown as the node's grey description. Empty for the healthy
     * "direct" case so that node shows just its name (a non-empty value signals a caveat).
     */
    readonly description: string;
    /**
     * Always-present short word for the connectivity model (e.g. `direct`, `port-forward`,
     * `node-routed`, `pending`, `unsupported`). The tooltip echoes this exact word before the
     * longer explanation, so the tooltip doubles as a legend that teaches what the terse node
     * description means. Unlike {@link description}, this is populated even for the `direct` case.
     */
    readonly word: string;
    readonly tooltipLabel: string;
    readonly tooltipDetail: string;
    readonly displayPort: number;
    /**
     * ThemeIcon id rendered as a `$(id)` prefix on the tooltip "Reachability" line.
     * This is the single glyph we allow in the tooltip: it encodes the connection-string
     * portability spectrum (globe = portable, server = cluster-routed, plug = machine-local
     * tunnel, warning = not reachable as-is) so the node can be classified at a glance.
     */
    readonly tooltipIcon: string;
}

/**
 * Sanitizes a string for use in tree IDs and cluster IDs.
 * Uses double-underscore as separator to avoid collisions
 * (K8s names can contain single underscores but not double).
 */
function sanitizeForId(value: string): string {
    return value.replace(/[/\\:@]/g, '_');
}

/**
 * Discovery tree item representing a discovered Kubernetes DocumentDB target.
 *
 * Unlike the earlier metadata-only leaf, this now behaves like the other discovery
 * cluster nodes: expanding the item authenticates and lists databases, and
 * collections underneath open the collection view directly.
 */
export class KubernetesServiceItem extends ClusterItemBase<KubernetesServiceModel> {
    constructor(
        journeyCorrelationId: string,
        readonly sourceId: string,
        readonly contextInfo: KubeContextInfo,
        readonly serviceInfo: KubeServiceInfo,
        parentId: string,
    ) {
        const sanitizedSource = sanitizeForId(sourceId);
        const sanitizedContext = sanitizeForId(contextInfo.name);
        const sanitizedNs = sanitizeForId(serviceInfo.namespace);
        const sanitizedSvc = sanitizeForId(serviceInfo.name);
        const sanitizedClusterSuffix = `${sanitizedSource}_${sanitizedContext}__${sanitizedNs}__${sanitizedSvc}`;
        const prefixedClusterId = `${DISCOVERY_PROVIDER_ID}_${sanitizedClusterSuffix}`;

        const cluster: TreeCluster<KubernetesServiceModel> = {
            name: serviceInfo.displayName,
            connectionString: undefined,
            dbExperience: DocumentDBExperience,
            clusterId: prefixedClusterId,
            contextName: contextInfo.name,
            namespace: serviceInfo.namespace,
            serviceType: serviceInfo.type,
            servicePort: serviceInfo.port,
            nodePort: serviceInfo.nodePort,
            externalAddress: serviceInfo.externalAddress,
            // The tree element id intentionally ends with the same suffix that
            // `clusterId` carries (the part after the provider-id prefix).
            // `DiscoveryBranchDataProvider.findClusterNodeByClusterId` strips
            // the provider prefix from `clusterId` and searches the tree for a
            // node whose id ends with `/${suffix}` — so the leaf path
            // component must equal that suffix for "open collection by
            // clusterId" / "reveal saved cluster" flows to resolve.
            treeId: `${parentId}/${sanitizedClusterSuffix}`,
            viewId: Views.DiscoveryView,
        };

        super(cluster);
        this.journeyCorrelationId = journeyCorrelationId;
        // Keep the base `treeItem_documentdbcluster` so the standard cluster commands
        // apply uniformly (they self-guard on sign-in). `discovery.kubernetesService`
        // is retained because the copy command uses it to pick the read-only, no-tunnel
        // copy path (see copyConnectionString.ts). The old `documentdbTargetLeaf` marker
        // was redundant — menus already match on `treeItem_documentdbcluster`.
        this.contextValue = createContextValue([
            'treeItem_documentdbcluster',
            'discovery.kubernetesService',
            `experience_${this.experience.api}`,
        ]);
        // Use the DocumentDB brand mark (the same icon as the "DocumentDB Local" node in the
        // Connections view) so a discovered cluster reads as a first-class DocumentDB cluster.
        // Dedicated cluster-named copies decouple this from the Local node's own asset.
        this.iconPath = {
            light: vscode.Uri.file(
                path.join(getResourcesPath(), 'icons', 'vscode-documentdb-cluster-light-themes.svg'),
            ),
            dark: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-cluster-dark-themes.svg')),
        };
        this.descriptionOverride = this.buildDescription();
        this.tooltipOverride = this.buildTooltip();
    }

    /**
     * Returns credentials for the "Add to Connections View" flow.
     */
    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            this.populateTelemetry(context);
            return await this.resolveClusterCredentials(context, { startPortForward: true });
        });
    }

    /**
     * Returns credentials for read-only copy operations.
     *
     * For ClusterIP services, this deliberately does not prompt for a local port
     * or start a port-forward tunnel. The copied localhost connection string is
     * annotated with port-forward metadata so the caller can explain the
     * machine-local tunnel dependency to the user.
     */
    public async getCredentialsForCopy(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials.copy', async (context: IActionContext) => {
            this.populateTelemetry(context);
            context.telemetry.properties.connectionIntent = 'copy';
            return await this.resolveClusterCredentials(context, { startPortForward: false });
        });
    }

    /**
     * Authenticates and connects so expanding the discovery node shows databases and collections.
     */
    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            this.populateTelemetry(context);
            context.telemetry.properties.connectionInitiatedFrom = 'discoveryView';

            ext.outputChannel.appendLine(
                l10n.t('Attempting to authenticate with "{cluster}"…', {
                    cluster: this.cluster.name,
                }),
            );

            const credentials = await this.resolveClusterCredentials(context, { startPortForward: true });
            if (!credentials) {
                return null;
            }

            let selectedAuthMethod =
                credentials.selectedAuthMethod ?? credentials.availableAuthMethods[0] ?? AuthMethodId.NativeAuth;
            let nativeAuthConfig = credentials.nativeAuthConfig;

            if (
                selectedAuthMethod === AuthMethodId.NativeAuth &&
                (!nativeAuthConfig?.connectionUser || !nativeAuthConfig.connectionPassword)
            ) {
                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    adminUserName: nativeAuthConfig?.connectionUser,
                    availableAuthMethods: credentials.availableAuthMethods,
                    resourceName: this.cluster.name,
                    selectedAuthMethod,
                    selectedUserName: undefined,
                };

                const credentialsProvided = await this.promptForCredentials(wizardContext);
                if (!credentialsProvided) {
                    context.telemetry.properties.connectionResult = 'cancelled';
                    return null;
                }

                if (wizardContext.password) {
                    context.valuesToMask.push(wizardContext.password);
                }

                selectedAuthMethod = wizardContext.selectedAuthMethod ?? selectedAuthMethod;
                nativeAuthConfig =
                    wizardContext.selectedUserName || wizardContext.password
                        ? {
                              connectionUser:
                                  wizardContext.nativeAuthConfig?.connectionUser ??
                                  wizardContext.selectedUserName ??
                                  '',
                              connectionPassword:
                                  wizardContext.nativeAuthConfig?.connectionPassword ?? wizardContext.password ?? '',
                          }
                        : wizardContext.nativeAuthConfig;
            } else if (nativeAuthConfig?.connectionPassword) {
                context.valuesToMask.push(nativeAuthConfig.connectionPassword);
            }

            CredentialCache.setAuthCredentials(
                this.cluster.clusterId,
                selectedAuthMethod,
                credentials.connectionString,
                nativeAuthConfig,
                undefined,
                credentials.entraIdAuthConfig,
            );

            switch (selectedAuthMethod) {
                case AuthMethodId.MicrosoftEntraID:
                    ext.outputChannel.append(l10n.t('Connecting to the cluster using Entra ID…'));
                    break;
                default:
                    ext.outputChannel.append(
                        l10n.t('Connecting to the cluster as "{username}"…', {
                            username: nativeAuthConfig?.connectionUser ?? '',
                        }),
                    );
            }

            try {
                const clustersClient = await this.getClientWithProgress(this.cluster.clusterId);

                ext.outputChannel.appendLine(
                    l10n.t('Connected to the cluster "{cluster}".', {
                        cluster: this.cluster.name,
                    }),
                );

                context.telemetry.properties.connectionResult = 'success';
                context.telemetry.properties.connectionCorrelationId = clustersClient.connectionCorrelationId ?? '';

                return clustersClient;
            } catch (error) {
                if (error instanceof UserCancelledError) {
                    context.telemetry.properties.connectionResult = 'cancelled';
                    throw error;
                }

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

                const { ClustersClient } = await import('../../../documentdb/ClustersClient');
                await ClustersClient.deleteClient(this.cluster.clusterId);
                CredentialCache.deleteCredentials(this.cluster.clusterId);

                return null;
            }
        });

        return result ?? null;
    }

    private populateTelemetry(context: IActionContext): void {
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
        context.telemetry.properties.view = Views.DiscoveryView;
        context.telemetry.properties.serviceType = this.serviceInfo.type;

        if (this.journeyCorrelationId) {
            context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
        }
    }

    private async resolveClusterCredentials(
        context: IActionContext,
        options: ResolveConnectionOptions,
    ): Promise<EphemeralClusterCredentials | undefined> {
        const kubeConfig = await loadConfiguredKubeConfig(this.sourceId);
        const coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
        const endpoint = await resolveServiceEndpoint(this.serviceInfo, coreApi);
        const resolvedConnectionDetails = await this.resolveConnectionDetails(
            context,
            endpoint,
            kubeConfig,
            coreApi,
            options,
        );

        if (!resolvedConnectionDetails) {
            return undefined;
        }

        // DKO services resolve credentials via DocumentDB CR secrets.
        let resolvedUsername: string | undefined;
        let resolvedPassword: string | undefined;

        const dkoCreds = await resolveDocumentDBCredentials(
            coreApi,
            kubeConfig,
            this.serviceInfo.namespace,
            this.serviceInfo.serviceName,
        );

        if (dkoCreds) {
            resolvedUsername = dkoCreds.username;
            resolvedPassword = dkoCreds.password;
        } else if (this.serviceInfo.sourceKind === 'generic' && this.serviceInfo.credentialSecretName) {
            // Generic services may declare a credential secret via the
            // documentdb.vscode.extension/credential-secret annotation.
            const genericCreds = await resolveGenericServiceCredentials(
                coreApi,
                this.serviceInfo.namespace,
                this.serviceInfo.credentialSecretName,
            );
            if (genericCreds) {
                resolvedUsername = genericCreds.username;
                resolvedPassword = genericCreds.password;
            }
        }

        context.telemetry.properties.hasAutoCredentials = resolvedUsername ? 'true' : 'false';

        if (resolvedUsername && resolvedPassword) {
            context.valuesToMask.push(resolvedPassword);
            return {
                connectionString: resolvedConnectionDetails.connectionString,
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
                connectionProperties: resolvedConnectionDetails.connectionProperties,
                nativeAuthConfig: {
                    connectionUser: resolvedUsername,
                    connectionPassword: resolvedPassword,
                },
            };
        }

        return {
            connectionString: resolvedConnectionDetails.connectionString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            connectionProperties: resolvedConnectionDetails.connectionProperties,
        };
    }

    protected override async beforeCachedClientConnect(): Promise<void> {
        if (this.serviceInfo.type !== 'ClusterIP') {
            return;
        }

        const cachedCredentials = CredentialCache.getCredentials(this.cluster.clusterId);
        const localPort = cachedCredentials
            ? getSingleLocalPortFromConnectionString(cachedCredentials.connectionString)
            : undefined;

        if (!localPort) {
            return;
        }

        const { ensureKubernetesPortForward } = await import('../ensureKubernetesPortForward');
        const sourceRecord = await getSource(this.sourceId);
        await ensureKubernetesPortForward(
            createKubernetesPortForwardMetadata(
                this.sourceId,
                this.contextInfo.name,
                this.serviceInfo,
                localPort,
                sourceRecord?.label,
            ),
        );
    }

    private async resolveConnectionDetails(
        context: IActionContext,
        endpoint: KubeServiceEndpoint,
        kubeConfig: KubeConfig,
        coreApi: CoreV1Api,
        options: ResolveConnectionOptions,
    ): Promise<ResolvedConnectionDetails | undefined> {
        switch (endpoint.kind) {
            case 'ready':
                if (endpoint.warning) {
                    ext.outputChannel.appendLine(endpoint.warning);
                    void vscode.window.showWarningMessage(endpoint.warning);
                    context.telemetry.properties.endpointWarning = 'internalIpMayBeUnreachable';
                }
                return { connectionString: endpoint.connectionString };
            case 'needsPortForward': {
                const localPort = options.startPortForward
                    ? await promptForLocalPort(this.serviceInfo)
                    : endpoint.suggestedLocalPort;
                if (localPort === undefined) {
                    context.telemetry.properties.connectionResult = 'cancelled';
                    return undefined;
                }

                if (options.startPortForward) {
                    const result = await PortForwardTunnelManager.getInstance().startTunnel({
                        sourceId: this.sourceId,
                        kubeConfig,
                        coreApi,
                        contextName: this.contextInfo.name,
                        namespace: this.serviceInfo.namespace,
                        serviceName: this.serviceInfo.serviceName,
                        servicePort: this.serviceInfo.port,
                        servicePortName: this.serviceInfo.portName,
                        localPort,
                    });

                    context.telemetry.properties.portForwardOutcome = result.outcome;

                    if (result.outcome === 'started') {
                        void vscode.window.showInformationMessage(
                            l10n.t('Port-forward tunnel started on 127.0.0.1:{port} for "{service}".', {
                                port: String(localPort),
                                service: this.serviceInfo.displayName,
                            }),
                        );
                    }
                } else {
                    context.telemetry.properties.portForwardOutcome = 'notStartedForCopy';
                }

                // Capture the source label so future reconnects can produce a friendlier
                // error message if the source has been removed by the time the user opens
                // this saved connection.
                const sourceRecord = await getSource(this.sourceId);

                return {
                    connectionString: buildPortForwardConnectionString(this.serviceInfo, localPort),
                    connectionProperties: {
                        [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: createKubernetesPortForwardMetadata(
                            this.sourceId,
                            this.contextInfo.name,
                            this.serviceInfo,
                            localPort,
                            sourceRecord?.label,
                        ),
                    },
                };
            }
            case 'pending':
            case 'unreachable':
                void vscode.window.showWarningMessage(endpoint.reason);
                context.telemetry.properties.connectionResult = endpoint.kind;
                context.telemetry.properties.unreachableReason = this.serviceInfo.type;
                return undefined;
        }
    }

    private buildDescription(): string {
        // Keep the always-visible grey text to a single connectivity caveat word. The healthy
        // "direct" case returns an empty string so the node shows just its name; a non-empty
        // description therefore signals "there is a connectivity caveat here" at a glance. The
        // provenance ([DKO]/[Generic]), service type, and port live in the tooltip instead.
        return this.getReachabilityInfo().description;
    }

    private buildTooltip(): vscode.MarkdownString {
        const reachability = this.getReachabilityInfo();

        // Group 1 — reachability (how VS Code actually reaches this target). Promoted to the top
        // of the tooltip because it is the signal the user cares about most. A single theme icon
        // prefixes the label to anchor the connectivity model visually (the only glyph we render
        // in the tooltip — see ReachabilityInfo.tooltipIcon). The line echoes the exact `word`
        // used in the node's grey description and then explains it, so the tooltip teaches what
        // the terse one-word shortcut means.
        const reachabilitySection: string[] = [
            `$(${reachability.tooltipIcon}) **Reachability (\`${reachability.word}\`):** ${reachability.tooltipLabel}`,
            reachability.tooltipDetail,
        ];

        // Group 2 — key info (identity, provenance, type, port). The provenance and service type
        // that used to sit in the node description now live here so the always-visible line stays
        // to a single connectivity word.
        const keyInfo: string[] = [`**Target:** ${this.serviceInfo.displayName}`];
        keyInfo.push(
            `**Source:** ${
                this.serviceInfo.sourceKind === 'dko'
                    ? l10n.t('DocumentDB Kubernetes Operator (DKO)')
                    : l10n.t('Generic Kubernetes service')
            }`,
        );
        keyInfo.push(`**Service type:** ${this.serviceInfo.type}`);
        if (this.serviceInfo.status) {
            keyInfo.push(`**Status:** ${this.serviceInfo.status}`);
        }
        keyInfo.push(`**Port:** ${String(reachability.displayPort)}`);
        if (this.serviceInfo.externalAddress) {
            keyInfo.push(`**External Address:** ${this.serviceInfo.externalAddress}`);
        }

        // Group 3 — placement (where the target lives).
        const placement: string[] = [];
        if (this.contextInfo.provider) {
            placement.push(`**Provider:** ${this.contextInfo.provider}`);
        }
        if (this.contextInfo.region) {
            placement.push(`**Region:** ${this.contextInfo.region}`);
        }
        placement.push(`**Namespace:** ${this.serviceInfo.namespace}`, `**Context:** ${this.contextInfo.name}`);

        // Join the three groups with markdown horizontal rules. MarkdownString renders
        // `\n\n---\n\n` as a horizontal line, giving a clean reachability / key-info /
        // placement separation in the rich tooltip.
        const sections = [reachabilitySection.join('\n\n'), keyInfo.join('\n\n'), placement.join('\n\n')];
        const tooltip = new vscode.MarkdownString(sections.join('\n\n---\n\n'));
        // Required so the single `$(...)` glyph on the reachability line renders as an icon.
        tooltip.supportThemeIcons = true;
        return tooltip;
    }

    private getReachabilityInfo(): ReachabilityInfo {
        switch (this.serviceInfo.type) {
            case 'LoadBalancer':
                if (this.serviceInfo.externalAddress) {
                    return {
                        // Healthy/portable case: no caveat word, node shows just its name.
                        description: '',
                        word: l10n.t('direct'),
                        tooltipLabel: l10n.t('Direct external address'),
                        tooltipDetail: l10n.t(
                            'Connects to the LoadBalancer external address. The connection string is portable if that address is reachable from the client machine.',
                        ),
                        displayPort: this.serviceInfo.port,
                        // Portable: reachable from anywhere the external address resolves.
                        tooltipIcon: 'globe',
                    };
                }
                if (this.serviceInfo.nodePort) {
                    return {
                        description: l10n.t('node-routed'),
                        word: l10n.t('node-routed'),
                        tooltipLabel: l10n.t('Cluster-routed via node port'),
                        tooltipDetail: l10n.t(
                            'The LoadBalancer external address is not assigned, so VS Code falls back to a node port. This only works if the selected node address is reachable from this machine.',
                        ),
                        displayPort: this.serviceInfo.nodePort,
                        // Cluster-routed: depends on a node address being reachable.
                        tooltipIcon: 'server',
                    };
                }
                return {
                    // "pending" mirrors kubectl's `EXTERNAL-IP: <pending>` for an unprovisioned LB.
                    description: l10n.t('pending'),
                    word: l10n.t('pending'),
                    tooltipLabel: l10n.t('LoadBalancer pending'),
                    tooltipDetail: l10n.t(
                        'The LoadBalancer external address is not assigned yet and no node-port fallback is available.',
                    ),
                    displayPort: this.serviceInfo.port,
                    // Not reachable as-is until the external address is assigned.
                    tooltipIcon: 'warning',
                };
            case 'NodePort':
                return {
                    description: l10n.t('node-routed'),
                    word: l10n.t('node-routed'),
                    tooltipLabel: l10n.t('Cluster-routed via node port'),
                    tooltipDetail: l10n.t(
                        'Connects through a Kubernetes node port. This only works if a cluster node address is reachable from this machine.',
                    ),
                    displayPort: this.serviceInfo.nodePort ?? this.serviceInfo.port,
                    // Cluster-routed: depends on a node address being reachable.
                    tooltipIcon: 'server',
                };
            case 'ClusterIP':
                return {
                    description: l10n.t('port-forward'),
                    word: l10n.t('port-forward'),
                    tooltipLabel: l10n.t('Local port-forward required'),
                    tooltipDetail: l10n.t(
                        'VS Code connects through the Kubernetes PortForward API. Connection strings using 127.0.0.1 only work on this machine while the tunnel is active.',
                    ),
                    displayPort: this.serviceInfo.port,
                    // Machine-local tunnel only (127.0.0.1 while the tunnel is active).
                    tooltipIcon: 'plug',
                };
            default:
                return {
                    description: l10n.t('unsupported'),
                    word: l10n.t('unsupported'),
                    tooltipLabel: l10n.t('Not directly reachable'),
                    tooltipDetail: l10n.t(
                        'This Kubernetes service type is not resolved automatically. Use a reachable service endpoint or connect manually.',
                    ),
                    displayPort: this.serviceInfo.port,
                    // Not resolved automatically.
                    tooltipIcon: 'warning',
                };
        }
    }

    private async promptForCredentials(wizardContext: AuthenticateWizardContext): Promise<boolean> {
        const { AzureWizard } = await import('@microsoft/vscode-azext-utils');
        const { ChooseAuthMethodStep } = await import('../../../documentdb/wizards/authenticate/ChooseAuthMethodStep');
        const { ProvideUserNameStep } = await import('../../../documentdb/wizards/authenticate/ProvideUsernameStep');
        const { ProvidePasswordStep } = await import('../../../documentdb/wizards/authenticate/ProvidePasswordStep');

        const wizard = new AzureWizard(wizardContext, {
            promptSteps: [new ChooseAuthMethodStep(), new ProvideUserNameStep(), new ProvidePasswordStep()],
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            showLoadingPrompt: true,
        });

        await callWithTelemetryAndErrorHandling('connect.promptForCredentials', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;

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
}

function getSingleLocalPortFromConnectionString(connectionString: string): number | undefined {
    try {
        const parsedConnectionString = new DocumentDBConnectionString(connectionString);
        if (parsedConnectionString.hosts.length !== 1) {
            return undefined;
        }

        const [host, portText] = parsedConnectionString.hosts[0].split(':');
        const port = Number(portText);
        if ((host === '127.0.0.1' || host === 'localhost') && Number.isInteger(port) && port > 0 && port <= 65535) {
            return port;
        }
    } catch {
        return undefined;
    }

    return undefined;
}
