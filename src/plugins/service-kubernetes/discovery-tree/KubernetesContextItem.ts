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
import { CUSTOM_KUBECONFIG_PATH_KEY, DISCOVERY_PROVIDER_ID, FILTERED_NAMESPACES_KEY } from '../config';
import {
    createCoreApi,
    listDocumentDBServices,
    listNamespaces,
    loadKubeConfig,
    type KubeContextInfo,
} from '../kubernetesClient';
import { KubernetesNamespaceItem } from './KubernetesNamespaceItem';

export class KubernetesContextItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.kubernetesContext';

    constructor(
        public readonly parentId: string,
        public readonly contextInfo: KubeContextInfo,
        public readonly alias: string | undefined,
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

                const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);

                let kubeConfig: Awaited<ReturnType<typeof loadKubeConfig>>;
                let namespaceNames: string[];
                let coreApi: Awaited<ReturnType<typeof createCoreApi>>;
                try {
                    kubeConfig = await loadKubeConfig(customPath);
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

                // Apply namespace filtering
                const filteredNamespaces = ext.context.globalState.get<Record<string, string[]>>(
                    FILTERED_NAMESPACES_KEY,
                    {},
                );
                const hiddenNamespaces = filteredNamespaces[this.contextInfo.name] ?? [];
                const visibleNamespaces = namespaceNames.filter((ns) => !hiddenNamespaces.includes(ns));

                // Only show namespaces that actually have DocumentDB-compatible services.
                // Pass undefined for kubeConfig to skip expensive CR/Secret resolution during scan.
                const scanResults = await Promise.allSettled(
                    visibleNamespaces.map(async (ns) => {
                        const services = await listDocumentDBServices(coreApi, ns);
                        return { ns, hasServices: services.length > 0 };
                    }),
                );

                const namespacesWithServices: KubernetesNamespaceItem[] = [];
                for (const result of scanResults) {
                    if (result.status === 'fulfilled' && result.value.hasServices) {
                        namespacesWithServices.push(
                            new KubernetesNamespaceItem(
                                this.id,
                                this.contextInfo,
                                result.value.ns,
                                this.journeyCorrelationId,
                            ),
                        );
                    } else if (result.status === 'rejected') {
                        const errorMessage =
                            result.reason instanceof Error ? result.reason.message : String(result.reason);
                        ext.outputChannel.warn(
                            `[KubernetesDiscovery] Could not scan namespace in context "${this.contextInfo.name}": ${errorMessage}`,
                        );
                    }
                }

                context.telemetry.measurements.namespacesCount = namespacesWithServices.length;

                return namespacesWithServices;
            },
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const displayName = this.alias || this.contextInfo.name;
        const serverUrl = this.contextInfo.server;

        const tooltipParts: string[] = [
            `**Context:** ${this.contextInfo.name}`,
            `**Cluster:** ${this.contextInfo.cluster}`,
            `**Server:** ${serverUrl}`,
        ];

        if (this.alias) {
            tooltipParts.push(`**Alias:** ${this.alias}`);
        }

        let hostDisplay: string | undefined;
        if (serverUrl) {
            try {
                hostDisplay = new URL(serverUrl).host;
            } catch {
                hostDisplay = serverUrl;
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: displayName,
            description: hostDisplay ? `(${hostDisplay})` : undefined,
            tooltip: new vscode.MarkdownString(tooltipParts.join('\n\n')),
            iconPath: new vscode.ThemeIcon('server'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
