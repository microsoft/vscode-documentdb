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
        readonly contextInfo: KubeContextInfo,
        readonly serviceInfo: KubeServiceInfo,
        parentId: string,
    ) {
        const sanitizedContext = sanitizeForId(contextInfo.name);
        const sanitizedNs = sanitizeForId(serviceInfo.namespace);
        const sanitizedSvc = sanitizeForId(serviceInfo.name);
        const sanitizedId = `${sanitizedNs}__${sanitizedSvc}`;
        const prefixedClusterId = `${DISCOVERY_PROVIDER_ID}_${sanitizedContext}__${sanitizedId}`;

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
            treeId: `${parentId}/${sanitizedId}`,
            viewId: Views.DiscoveryView,
        };

        super(cluster);
        this.journeyCorrelationId = journeyCorrelationId;
        this.contextValue = createContextValue([
            'treeItem_documentdbcluster',
            'documentdbTargetLeaf',
            'discovery.kubernetesService',
            `experience_${this.experience.api}`,
        ]);
        this.iconPath = new vscode.ThemeIcon('server-environment');
        this.descriptionOverride = this.buildDescription();
        this.tooltipOverride = this.buildTooltip();
    }

    /**
     * Returns credentials for the "Add to Connections View" flow.
     */
    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            this.populateTelemetry(context);
            return await this.resolveClusterCredentials(context);
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

            const credentials = await this.resolveClusterCredentials(context);
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

    private async resolveClusterCredentials(context: IActionContext): Promise<EphemeralClusterCredentials | undefined> {
        const kubeConfig = await loadConfiguredKubeConfig();
        const coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
        const endpoint = await resolveServiceEndpoint(this.serviceInfo, coreApi);
        const resolvedConnectionDetails = await this.resolveConnectionDetails(context, endpoint, kubeConfig, coreApi);

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
        await ensureKubernetesPortForward(
            createKubernetesPortForwardMetadata(this.contextInfo.name, this.serviceInfo, localPort),
        );
    }

    private async resolveConnectionDetails(
        context: IActionContext,
        endpoint: KubeServiceEndpoint,
        kubeConfig: KubeConfig,
        coreApi: CoreV1Api,
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
                const localPort = await promptForLocalPort(this.serviceInfo);
                if (localPort === undefined) {
                    context.telemetry.properties.connectionResult = 'cancelled';
                    return undefined;
                }

                const result = await PortForwardTunnelManager.getInstance().startTunnel({
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

                return {
                    connectionString: buildPortForwardConnectionString(this.serviceInfo, localPort),
                    connectionProperties: {
                        [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: createKubernetesPortForwardMetadata(
                            this.contextInfo.name,
                            this.serviceInfo,
                            localPort,
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
        const portDisplay =
            this.serviceInfo.type === 'NodePort' && this.serviceInfo.nodePort
                ? `:${String(this.serviceInfo.nodePort)}`
                : `:${String(this.serviceInfo.port)}`;
        const sourcePrefix = this.serviceInfo.sourceKind === 'dko' ? 'DKO' : 'Generic';
        return `[${sourcePrefix}] [${this.serviceInfo.type} ${portDisplay}]`;
    }

    private buildTooltip(): vscode.MarkdownString {
        const tooltipParts: string[] = [
            `**Target:** ${this.serviceInfo.displayName}`,
            `**Source:** ${this.serviceInfo.sourceKind === 'dko' ? 'DKO resource' : 'Generic fallback service'}`,
            `**Service:** ${this.serviceInfo.serviceName}`,
            `**Namespace:** ${this.serviceInfo.namespace}`,
            `**Type:** ${this.serviceInfo.type}`,
            `**Port:** ${String(this.serviceInfo.port)}`,
        ];

        if (this.serviceInfo.documentDbName) {
            tooltipParts.push(`**DocumentDB:** ${this.serviceInfo.documentDbName}`);
        }
        if (this.serviceInfo.status) {
            tooltipParts.push(`**Status:** ${this.serviceInfo.status}`);
        }
        if (this.serviceInfo.secretName) {
            tooltipParts.push(`**Secret:** ${this.serviceInfo.secretName}`);
        }

        if (this.serviceInfo.nodePort) {
            tooltipParts.push(`**NodePort:** ${String(this.serviceInfo.nodePort)}`);
        }
        if (this.serviceInfo.externalAddress) {
            tooltipParts.push(`**External Address:** ${this.serviceInfo.externalAddress}`);
        }
        if (this.serviceInfo.clusterIP) {
            tooltipParts.push(`**ClusterIP:** ${this.serviceInfo.clusterIP}`);
        }
        tooltipParts.push('', `**Context:** ${this.contextInfo.name}`, `**Server:** ${this.contextInfo.server}`);

        if (this.contextInfo.provider) {
            tooltipParts.push(`**Provider:** ${this.contextInfo.provider}`);
        }
        if (this.contextInfo.region) {
            tooltipParts.push(`**Region:** ${this.contextInfo.region}`);
        }

        return new vscode.MarkdownString(tooltipParts.join('\n\n'));
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
