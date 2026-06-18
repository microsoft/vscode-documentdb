/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { ensureMigration } from '../sources/migrationV2';
import { readSources } from '../sources/sourceStore';
import { KubernetesKubeconfigSourceItem } from './KubernetesKubeconfigSourceItem';

export class KubernetesRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableLearnMoreCommand;enableAddKubernetesSourceCommand;discoveryKubernetesRootItem';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/kubernetes-discovery`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const children = await callWithTelemetryAndErrorHandling(
            'kubernetes-discovery.listSources',
            async (context: IActionContext) => {
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;

                await ensureMigration();

                const sources = await readSources();

                // How many kubeconfig sources users keep, and of which kind — this is
                // the top-of-funnel adoption signal for the feature. Counts are split
                // by kind so the relative use of Default vs file vs pasted YAML is
                // visible.
                context.telemetry.measurements.sourcesCount = sources.length;
                context.telemetry.measurements.fileSourcesCount = sources.filter((s) => s.kind === 'file').length;
                context.telemetry.measurements.inlineSourcesCount = sources.filter((s) => s.kind === 'inline').length;
                context.telemetry.measurements.defaultSourcesCount = sources.filter((s) => s.kind === 'default').length;
                context.telemetry.properties.hasSources = sources.length > 0 ? 'true' : 'false';

                if (sources.length === 0) {
                    return [this.createAddSourceChild()];
                }

                return sources.map((source) => new KubernetesKubeconfigSourceItem(this.id, source));
            },
        );

        return children ?? [];
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: vscode.l10n.t('Kubernetes Clusters'),
            iconPath: new vscode.ThemeIcon('layers'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public refresh(): void {
        ext.discoveryBranchDataProvider.refresh(this);
    }

    private createAddSourceChild(): ExtTreeElementBase {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/add-source`,
            label: vscode.l10n.t('Add Kubeconfig…'),
            iconPath: new vscode.ThemeIcon('add'),
            commandId: 'vscode-documentdb.command.discoveryView.kubernetes.addSource',
            commandArgs: [this],
        });
    }
}
