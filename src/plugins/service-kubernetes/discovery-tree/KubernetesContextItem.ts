/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { DISCOVERY_PROVIDER_ID } from '../config';
import {
    createCoreApi,
    listDocumentDBServices,
    listNamespaces,
    loadConfiguredKubeConfig,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KubernetesNamespaceItem } from './KubernetesNamespaceItem';
import { KubernetesOtherNamespacesItem } from './KubernetesOtherNamespacesItem';
import { hasRetryActionNode } from './retryNodeDetection';

interface NamespaceDiscoveryResult {
    readonly namespace: string;
    readonly services?: readonly KubeServiceInfo[];
}

// Bounded concurrency for the per-namespace DocumentDB pre-scan. Intentionally a
// hardcoded constant rather than a user setting (bug-bash #20 decision): it's a
// performance knob most users can't reason about, and `5` is a safe default.
// Revisit only if telemetry shows large-cluster prescan latency.
const NAMESPACE_PRESCAN_CONCURRENCY = 5;

export class KubernetesContextItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.kubernetesContext';

    constructor(
        public readonly parentId: string,
        public readonly sourceId: string,
        public readonly contextInfo: KubeContextInfo,
        private readonly journeyCorrelationId: string,
        public readonly alias?: string,
    ) {
        // Sanitize context name for tree ID (replace / with _)
        const sanitizedName = contextInfo.name.replace(/\//g, '_');
        this.id = `${parentId}/${sanitizedName}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'kubernetes-discovery.listNamespaces',
            async (context: IActionContext) => {
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;

                let kubeConfig: Awaited<ReturnType<typeof loadConfiguredKubeConfig>>;
                let namespaceNames: string[];
                let coreApi: Awaited<ReturnType<typeof createCoreApi>>;
                try {
                    kubeConfig = await loadConfiguredKubeConfig(this.sourceId);
                    coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
                    namespaceNames = await listNamespaces(coreApi);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.error(
                        `[KubernetesDiscovery] Failed to list namespaces for context "${this.contextInfo.name}": ${errorMessage}`,
                    );
                    context.telemetry.properties.namespaceFetchError = 'true';

                    return createConnectionErrorChildren(this.id, errorMessage, this);
                }

                context.telemetry.measurements.namespacesCount = namespaceNames.length;

                if (namespaceNames.length === 0) {
                    return [
                        createGenericElementWithContext({
                            contextValue: 'informational',
                            id: `${this.id}/no-namespaces`,
                            label: vscode.l10n.t('No namespaces found in this context.'),
                            iconPath: new vscode.ThemeIcon('info'),
                        }),
                    ];
                }

                const namespaceResults = await mapWithBoundedConcurrency(
                    namespaceNames,
                    NAMESPACE_PRESCAN_CONCURRENCY,
                    async (namespace): Promise<NamespaceDiscoveryResult> => {
                        try {
                            const services = await listDocumentDBServices(coreApi, namespace, kubeConfig);
                            return { namespace, services };
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            ext.outputChannel.error(
                                `[KubernetesDiscovery] Failed to check services in "${this.contextInfo.name}/${namespace}": ${errorMessage}`,
                            );
                            context.telemetry.properties.namespaceServiceFetchError = 'true';

                            // Leave this namespace expandable so the user can retry and see the detailed error.
                            return { namespace };
                        }
                    },
                );

                const sortedNamespaceResults = namespaceResults.sort((a, b) => {
                    const aHasDocumentDbTargets = a.services === undefined || a.services.length > 0;
                    const bHasDocumentDbTargets = b.services === undefined || b.services.length > 0;
                    if (aHasDocumentDbTargets !== bHasDocumentDbTargets) {
                        return aHasDocumentDbTargets ? -1 : 1;
                    }

                    return a.namespace.localeCompare(b.namespace, undefined, { numeric: true });
                });

                context.telemetry.measurements.documentDbNamespacesCount = namespaceResults.filter(
                    (result) => result.services !== undefined && result.services.length > 0,
                ).length;

                const targetOrRetryResults = sortedNamespaceResults.filter(
                    (result) => result.services === undefined || result.services.length > 0,
                );
                const emptyNamespaceNames = sortedNamespaceResults
                    .filter((result) => result.services !== undefined && result.services.length === 0)
                    .map((result) => result.namespace);

                const children: TreeElement[] = targetOrRetryResults.map(
                    (result) =>
                        new KubernetesNamespaceItem(
                            this.id,
                            this.sourceId,
                            this.contextInfo,
                            result.namespace,
                            this.journeyCorrelationId,
                            result.services,
                        ),
                );

                if (emptyNamespaceNames.length > 0) {
                    children.push(new KubernetesOtherNamespacesItem(this.id, emptyNamespaceNames));
                }

                return children;
            },
        );
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return hasRetryActionNode(children);
    }

    public getTreeItem(): vscode.TreeItem {
        const serverUrl = this.contextInfo.server;

        const tooltipParts: string[] = [];
        if (this.alias) {
            // Show the alias prominently while preserving the original name as the source of truth.
            tooltipParts.push(`**Display name:** ${this.alias}`);
        }
        tooltipParts.push(
            `**Context:** ${this.contextInfo.name}`,
            `**Cluster:** ${this.contextInfo.cluster}`,
            `**Server:** ${serverUrl}`,
        );

        if (this.contextInfo.provider) {
            tooltipParts.push(`**Provider:** ${this.contextInfo.provider}`);
        }
        if (this.contextInfo.region) {
            tooltipParts.push(`**Region:** ${this.contextInfo.region}`);
        }
        // Build description: prefer provider/region, fall back to server host.
        // When an alias is in effect, the original context name is shown so users can still
        // identify the underlying context at a glance.
        const descriptionParts: string[] = [];
        if (this.alias) {
            descriptionParts.push(`(${this.contextInfo.name})`);
        }
        const detailParts: string[] = [];
        if (this.contextInfo.provider) {
            detailParts.push(this.contextInfo.provider);
        }
        if (this.contextInfo.region) {
            detailParts.push(this.contextInfo.region);
        }
        if (detailParts.length > 0) {
            descriptionParts.push(`(${detailParts.join(' / ')})`);
        } else if (serverUrl) {
            try {
                descriptionParts.push(`(${new URL(serverUrl).host})`);
            } catch {
                descriptionParts.push(`(${serverUrl})`);
            }
        }

        const description = descriptionParts.length > 0 ? descriptionParts.join(' ') : undefined;

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.alias ?? this.contextInfo.name,
            description,
            tooltip: new vscode.MarkdownString(tooltipParts.join('\n\n')),
            iconPath: new vscode.ThemeIcon('server'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}

async function mapWithBoundedConcurrency<T>(
    items: readonly string[],
    concurrency: number,
    mapper: (item: string) => Promise<T>,
): Promise<T[]> {
    const results = new Map<number, T>();
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            const currentIndex = nextIndex;
            const item = items[currentIndex];
            nextIndex++;
            if (item === undefined) {
                return;
            }

            results.set(currentIndex, await mapper(item));
        }
    });

    await Promise.all(workers);
    return items.map((_item, index) => results.get(index)).filter((result): result is T => result !== undefined);
}

/**
 * Classifies a Kubernetes API error message into a user-friendly summary
 * and an actionable hint so tree error nodes are immediately useful.
 */
function classifyConnectionError(errorMessage: string): { summary: string; hint: string } {
    const lower = errorMessage.toLowerCase();

    if (lower.includes('401') || lower.includes('unauthorized')) {
        return {
            summary: vscode.l10n.t('Authentication failed (401 Unauthorized)'),
            hint: vscode.l10n.t(
                'Credentials may have expired. Re-authenticate with your cluster or update the kubeconfig.',
            ),
        };
    }
    if (lower.includes('403') || lower.includes('forbidden')) {
        return {
            summary: vscode.l10n.t('Access denied (403 Forbidden)'),
            hint: vscode.l10n.t(
                'Your account lacks the required RBAC permissions. Contact your cluster administrator.',
            ),
        };
    }
    if (lower.includes('econnrefused') || lower.includes('connection refused')) {
        return {
            summary: vscode.l10n.t('Connection refused'),
            hint: vscode.l10n.t(
                'The cluster may be stopped or unreachable. Verify the cluster is running and the server URL is correct.',
            ),
        };
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
        return {
            summary: vscode.l10n.t('Cluster not found (DNS resolution failed)'),
            hint: vscode.l10n.t(
                'The server hostname could not be resolved. The cluster may have been deleted or the URL may be incorrect.',
            ),
        };
    }
    if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('timed out')) {
        return {
            summary: vscode.l10n.t('Connection timed out'),
            hint: vscode.l10n.t(
                'The cluster did not respond in time. Check your network connection and firewall settings.',
            ),
        };
    }
    if (lower.includes('certificate') || lower.includes('cert') || lower.includes('ssl') || lower.includes('tls')) {
        return {
            summary: vscode.l10n.t('Certificate error'),
            hint: vscode.l10n.t(
                'The cluster certificate may have changed or expired. Update your kubeconfig with fresh credentials.',
            ),
        };
    }
    if (lower.includes('not found') || lower.includes('404')) {
        return {
            summary: vscode.l10n.t('Resource not found'),
            hint: vscode.l10n.t(
                'The cluster or API endpoint may have been deleted. Verify your kubeconfig is up to date.',
            ),
        };
    }

    // Truncate long generic messages
    const truncated = errorMessage.length > 120 ? errorMessage.slice(0, 117) + '...' : errorMessage;
    return {
        summary: vscode.l10n.t('Connection failed: {0}', truncated),
        hint: vscode.l10n.t(
            'Check the output channel for details. The cluster may be unreachable or your credentials may need updating.',
        ),
    };
}

/**
 * Builds tree children for a connection-level error: a classified error
 * summary, a retry action, and a troubleshooting docs link.
 */
function createConnectionErrorChildren(
    parentId: string,
    errorMessage: string,
    retryTarget: TreeElement,
): TreeElement[] {
    const { summary, hint } = classifyConnectionError(errorMessage);

    return [
        createGenericElementWithContext({
            contextValue: 'error',
            id: `${parentId}/retry`,
            label: vscode.l10n.t('Click here to retry'),
            iconPath: new vscode.ThemeIcon('refresh'),
            commandId: 'vscode-documentdb.command.internal.retry',
            commandArgs: [retryTarget],
        }),
        createGenericElementWithContext({
            contextValue: 'error',
            id: `${parentId}/error-info`,
            label: summary,
            description: hint,
            iconPath: new vscode.ThemeIcon('warning'),
            tooltip: `${summary}\n\n${hint}\n\nFull error: ${errorMessage}`,
        }),
    ];
}
