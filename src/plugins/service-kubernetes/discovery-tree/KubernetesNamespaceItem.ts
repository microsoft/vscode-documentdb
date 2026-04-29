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
    loadConfiguredKubeConfig,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KubernetesServiceItem } from './KubernetesServiceItem';

export class KubernetesNamespaceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.kubernetesNamespace';

    constructor(
        public readonly parentId: string,
        public readonly sourceId: string,
        public readonly contextInfo: KubeContextInfo,
        public readonly namespace: string,
        private readonly journeyCorrelationId: string,
        private readonly preloadedServices?: readonly KubeServiceInfo[],
    ) {
        this.id = `${parentId}/${namespace}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'kubernetes-discovery.listServices',
            async (context: IActionContext) => {
                const startTime = Date.now();
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;

                let services: readonly KubeServiceInfo[];
                try {
                    if (this.preloadedServices !== undefined) {
                        services = this.preloadedServices;
                    } else {
                        const kubeConfig = await loadConfiguredKubeConfig(this.sourceId);
                        const coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
                        services = await listDocumentDBServices(coreApi, this.namespace, kubeConfig);
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.error(
                        `[KubernetesDiscovery] Failed to list services in "${this.contextInfo.name}/${this.namespace}": ${errorMessage}`,
                    );
                    context.telemetry.properties.serviceFetchError = 'true';
                    return [
                        createGenericElementWithContext({
                            contextValue: 'error',
                            id: `${this.id}/retry`,
                            label: vscode.l10n.t('Failed to list services. Click to retry.'),
                            iconPath: new vscode.ThemeIcon('refresh'),
                            commandId: 'vscode-documentdb.command.internal.retry',
                            commandArgs: [this],
                        }),
                    ];
                }

                context.telemetry.measurements.discoveryResourcesCount = services.length;
                context.telemetry.measurements.discoveryLoadTimeMs = Date.now() - startTime;

                if (services.length === 0) {
                    return [
                        createGenericElementWithContext({
                            contextValue: 'informational',
                            id: `${this.id}/no-services`,
                            label: vscode.l10n.t('No DocumentDB services found in this namespace.'),
                            iconPath: new vscode.ThemeIcon('info'),
                        }),
                    ];
                }

                return services.map(
                    (svc) =>
                        new KubernetesServiceItem(
                            this.journeyCorrelationId,
                            this.sourceId,
                            this.contextInfo,
                            svc,
                            this.id,
                        ),
                );
            },
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const preloadedServiceCount = this.preloadedServices?.length;
        let description: string | undefined;
        if (preloadedServiceCount !== undefined) {
            if (preloadedServiceCount === 0) {
                description = vscode.l10n.t('No DocumentDB targets');
            } else if (preloadedServiceCount === 1) {
                description = vscode.l10n.t('1 DocumentDB target');
            } else {
                description = vscode.l10n.t('{0} DocumentDB targets', String(preloadedServiceCount));
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.namespace,
            description,
            iconPath: new vscode.ThemeIcon('archive'),
            collapsibleState:
                preloadedServiceCount === 0
                    ? vscode.TreeItemCollapsibleState.None
                    : vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
