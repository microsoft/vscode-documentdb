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

interface NamespaceDiscoveryResult {
    readonly namespace: string;
    readonly services?: readonly KubeServiceInfo[];
}

const NAMESPACE_PRESCAN_CONCURRENCY = 5;

export class KubernetesContextItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.kubernetesContext';

    constructor(
        public readonly parentId: string,
        public readonly contextInfo: KubeContextInfo,
        private readonly journeyCorrelationId: string,
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
                    kubeConfig = await loadConfiguredKubeConfig();
                    coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
                    namespaceNames = await listNamespaces(coreApi);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.error(
                        `[KubernetesDiscovery] Failed to list namespaces for context "${this.contextInfo.name}": ${errorMessage}`,
                    );
                    context.telemetry.properties.namespaceFetchError = 'true';

                    return [
                        createGenericElementWithContext({
                            contextValue: 'error',
                            id: `${this.id}/retry`,
                            label: vscode.l10n.t('Failed to connect. Click to retry.'),
                            iconPath: new vscode.ThemeIcon('refresh'),
                            commandId: 'vscode-documentdb.command.internal.retry',
                            commandArgs: [this],
                        }),
                    ];
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

                return sortedNamespaceResults.map(
                    (result) =>
                        new KubernetesNamespaceItem(
                            this.id,
                            this.contextInfo,
                            result.namespace,
                            this.journeyCorrelationId,
                            result.services,
                        ),
                );
            },
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const serverUrl = this.contextInfo.server;

        const tooltipParts: string[] = [
            `**Context:** ${this.contextInfo.name}`,
            `**Cluster:** ${this.contextInfo.cluster}`,
            `**Server:** ${serverUrl}`,
        ];

        if (this.contextInfo.provider) {
            tooltipParts.push(`**Provider:** ${this.contextInfo.provider}`);
        }
        if (this.contextInfo.region) {
            tooltipParts.push(`**Region:** ${this.contextInfo.region}`);
        }
        // Build description: prefer provider/region, fall back to server host
        const descriptionParts: string[] = [];
        if (this.contextInfo.provider) {
            descriptionParts.push(this.contextInfo.provider);
        }
        if (this.contextInfo.region) {
            descriptionParts.push(this.contextInfo.region);
        }

        let description: string | undefined;
        if (descriptionParts.length > 0) {
            description = descriptionParts.join(' / ');
        } else if (serverUrl) {
            try {
                description = new URL(serverUrl).host;
            } catch {
                description = serverUrl;
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.contextInfo.name,
            description: description ? `(${description})` : undefined,
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
