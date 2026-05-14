/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
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
        await ensureMigration();

        const sources = await readSources();

        if (sources.length === 0) {
            return [this.createAddSourceChild()];
        }

        return sources.map((source) => new KubernetesKubeconfigSourceItem(this.id, source));
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
            label: vscode.l10n.t('Kubernetes'),
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
            label: vscode.l10n.t('Add kubeconfig source…'),
            iconPath: new vscode.ThemeIcon('add'),
            commandId: 'vscode-documentdb.command.discoveryView.kubernetes.addSource',
            commandArgs: [this],
        });
    }
}
