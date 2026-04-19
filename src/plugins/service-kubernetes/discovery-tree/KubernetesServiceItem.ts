/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { Views } from '../../../documentdb/Views';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { type BaseClusterModel, type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { CUSTOM_KUBECONFIG_PATH_KEY, DISCOVERY_PROVIDER_ID } from '../config';
import {
    createCoreApi,
    loadKubeConfig,
    resolveDocumentDBCredentials,
    resolveServiceEndpoint,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';

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

/**
 * Sanitizes a string for use in tree IDs and cluster IDs.
 * Uses double-underscore as separator to avoid collisions
 * (K8s names can contain single underscores but not double).
 */
function sanitizeForId(value: string): string {
    return value.replace(/[/\\:@]/g, '_');
}

/**
 * Leaf tree item representing a discovered Kubernetes service.
 *
 * This is intentionally NOT expandable in the Discovery tree.
 * The user clicks "Add to Connections View" to add it, and then
 * manages auth/databases in the Connections View.
 *
 * Implements the cluster contextValue so the "Add to Connections" button appears.
 */
export class KubernetesServiceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string;
    public readonly cluster: TreeCluster<KubernetesServiceModel>;
    public readonly experience = DocumentDBExperience;

    public journeyCorrelationId?: string;

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

        this.cluster = {
            name: serviceInfo.name,
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

        this.id = this.cluster.treeId;
        this.journeyCorrelationId = journeyCorrelationId;

        // Use a Kubernetes-specific context value that only enables "Add to Connections View"
        // Do NOT use treeItem_documentdbcluster — that enables Create Database, Launch Shell, etc.
        // which require a real ClusterItemBase with authenticated connection.
        this.contextValue = createContextValue([
            'treeItem_documentdbcluster',
            'kubernetesServiceLeaf',
            `experience_${DocumentDBExperience.api}`,
        ]);
    }

    /**
     * Returns credentials for the "Add to Connections View" flow.
     * Resolves the connection endpoint — does NOT prompt for credentials.
     * Auth is handled by the Connections View when the user expands the connection.
     */
    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            context.telemetry.properties.view = Views.DiscoveryView;
            if (this.journeyCorrelationId) {
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
            }
            context.telemetry.properties.serviceType = this.serviceInfo.type;

            // Resolve connection string from the Kubernetes service endpoint
            const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
            const kubeConfig = await loadKubeConfig(customPath);
            const coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
            const endpoint = await resolveServiceEndpoint(this.serviceInfo, coreApi);

            if (!endpoint.isReachable || !endpoint.connectionString) {
                const reason = endpoint.unreachableReason ?? vscode.l10n.t('Service is not reachable.');
                void vscode.window.showWarningMessage(reason);
                context.telemetry.properties.connectionResult = 'unreachable';
                context.telemetry.properties.unreachableReason = this.serviceInfo.type;
                return undefined;
            }

            context.telemetry.properties.connectionResult = 'success';

            // Resolve credentials from DocumentDB CR secrets on-demand (not during tree enumeration)
            const resolvedCreds = await resolveDocumentDBCredentials(
                coreApi,
                kubeConfig,
                this.serviceInfo.namespace,
                this.serviceInfo.name,
            );

            context.telemetry.properties.hasAutoCredentials = resolvedCreds ? 'true' : 'false';

            // If the CRD resolution returned connectionParams (e.g. TLS settings),
            // merge them into the endpoint connection string. This handles the case
            // where the service was discovered without kubeConfig during tree scan.
            let finalConnectionString = endpoint.connectionString;
            if (resolvedCreds?.connectionParams && !finalConnectionString.includes('tls=')) {
                const separator = finalConnectionString.includes('?') ? '&' : '?';
                finalConnectionString = `${finalConnectionString}${separator}${resolvedCreds.connectionParams}`;
            }

            if (resolvedCreds) {
                return {
                    connectionString: finalConnectionString,
                    availableAuthMethods: [AuthMethodId.NativeAuth],
                    selectedAuthMethod: AuthMethodId.NativeAuth,
                    nativeAuthConfig: {
                        connectionUser: resolvedCreds.username,
                        connectionPassword: resolvedCreds.password,
                    },
                };
            }

            // No auto-credentials — Connections View will prompt
            return {
                connectionString: finalConnectionString,
                availableAuthMethods: [AuthMethodId.NativeAuth],
                selectedAuthMethod: AuthMethodId.NativeAuth,
            };
        });
    }

    /**
     * Returns detail nodes showing service properties.
     * Single-click expands to show these details.
     */
    public getChildren(): vscode.ProviderResult<TreeElement[]> {
        const details: TreeElement[] = [];

        const addDetail = (label: string, value: string, icon: string): void => {
            details.push({
                id: `${this.id}/${label}`,
                getTreeItem: () => ({
                    id: `${this.id}/${label}`,
                    label: `${label}: ${value}`,
                    iconPath: new vscode.ThemeIcon(icon),
                    collapsibleState: vscode.TreeItemCollapsibleState.None,
                }),
            });
        };

        addDetail('Type', this.serviceInfo.type, 'symbol-enum');
        addDetail('Port', String(this.serviceInfo.port), 'plug');
        if (this.serviceInfo.nodePort) {
            addDetail('NodePort', String(this.serviceInfo.nodePort), 'plug');
        }
        if (this.serviceInfo.externalAddress) {
            addDetail('External', this.serviceInfo.externalAddress, 'globe');
        }
        if (this.serviceInfo.clusterIP) {
            addDetail('ClusterIP', this.serviceInfo.clusterIP, 'debug-disconnect');
        }
        addDetail('Namespace', this.serviceInfo.namespace, 'archive');
        addDetail('Context', this.contextInfo.name, 'server');

        return details;
    }

    public getTreeItem(): vscode.TreeItem {
        // Build description showing service type and port
        const portDisplay =
            this.serviceInfo.type === 'NodePort' && this.serviceInfo.nodePort
                ? `:${String(this.serviceInfo.nodePort)}`
                : `:${String(this.serviceInfo.port)}`;
        const description = `[${this.serviceInfo.type} ${portDisplay}]`;

        // Build tooltip
        const tooltipParts: string[] = [
            `**Service:** ${this.serviceInfo.name}`,
            `**Namespace:** ${this.serviceInfo.namespace}`,
            `**Type:** ${this.serviceInfo.type}`,
            `**Port:** ${String(this.serviceInfo.port)}`,
        ];

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

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.serviceInfo.name,
            description,
            tooltip: new vscode.MarkdownString(tooltipParts.join('\n\n')),
            iconPath: new vscode.ThemeIcon('server-environment'),
            // Expandable — single click shows details, right-click to add to connections
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
