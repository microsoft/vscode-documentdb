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
import { KubernetesResourceItem } from './documentdb/KubernetesResourceItem';
import { hasRetryActionNode } from './retryNodeDetection';

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
                    context.telemetry.properties.serviceFetchErrorType =
                        error instanceof Error ? error.name : 'UnknownError';
                    return createServiceErrorChildren(this.id, errorMessage, this);
                }

                context.telemetry.measurements.discoveryResourcesCount = services.length;
                context.telemetry.measurements.discoveryLoadTimeMs = Date.now() - startTime;
                // Split the discovered targets by provenance so adoption of the DocumentDB
                // Kubernetes Operator can be tracked separately from the generic-service fallback.
                context.telemetry.measurements.dkoResourcesCount = services.filter(
                    (svc) => svc.sourceKind === 'dko',
                ).length;
                context.telemetry.measurements.genericServicesCount = services.filter(
                    (svc) => svc.sourceKind === 'generic',
                ).length;

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
                        new KubernetesResourceItem(
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

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.namespace,
            iconPath: new vscode.ThemeIcon('symbol-namespace'),
            collapsibleState:
                preloadedServiceCount === 0
                    ? vscode.TreeItemCollapsibleState.None
                    : vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return hasRetryActionNode(children);
    }
}

/**
 * Builds tree children for a service-list error with a classified summary,
 * actionable hint in the tooltip, and a retry action.
 */
function createServiceErrorChildren(parentId: string, errorMessage: string, retryTarget: TreeElement): TreeElement[] {
    const lower = errorMessage.toLowerCase();

    let summary: string;
    let hint: string;

    if (lower.includes('403') || lower.includes('forbidden')) {
        summary = vscode.l10n.t('Access denied listing services (403 Forbidden)');
        hint = vscode.l10n.t('Your account lacks permission to list services in this namespace.');
    } else if (lower.includes('401') || lower.includes('unauthorized')) {
        summary = vscode.l10n.t('Authentication failed listing services (401)');
        hint = vscode.l10n.t('Credentials may have expired. Re-authenticate with your cluster.');
    } else {
        const truncated = errorMessage.length > 120 ? errorMessage.slice(0, 117) + '...' : errorMessage;
        summary = vscode.l10n.t('Failed to list services: {0}', truncated);
        hint = vscode.l10n.t('Check the output channel for details.');
    }

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
