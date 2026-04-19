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
import { CUSTOM_KUBECONFIG_PATH_KEY, DISCOVERY_PROVIDER_ID } from '../config';
import {
    createCoreApi,
    listDocumentDBServices,
    loadKubeConfig,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KubernetesServiceItem } from './KubernetesServiceItem';

export class KubernetesNamespaceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.kubernetesNamespace';

    constructor(
        public readonly parentId: string,
        public readonly contextInfo: KubeContextInfo,
        public readonly namespace: string,
        private readonly journeyCorrelationId: string,
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

                const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);

                let services: KubeServiceInfo[];
                try {
                    const kubeConfig = await loadKubeConfig(customPath);
                    const coreApi = await createCoreApi(kubeConfig, this.contextInfo.name);
                    services = await listDocumentDBServices(coreApi, this.namespace, kubeConfig);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.error(
                        `[KubernetesDiscovery] Failed to list services in "${this.contextInfo.name}/${this.namespace}": ${errorMessage}`,
                    );
                    context.telemetry.properties.serviceFetchError = 'true';
                    return [];
                }

                context.telemetry.measurements.discoveryResourcesCount = services.length;
                context.telemetry.measurements.discoveryLoadTimeMs = Date.now() - startTime;

                return services.map(
                    (svc) => new KubernetesServiceItem(this.journeyCorrelationId, this.contextInfo, svc, this.id),
                );
            },
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.namespace,
            iconPath: new vscode.ThemeIcon('archive'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
