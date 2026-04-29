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
import { readHiddenSourceIds, readSources } from '../sources/sourceStore';
import { KubernetesKubeconfigSourceItem } from './KubernetesKubeconfigSourceItem';

export class KubernetesRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableLearnMoreCommand;enableAddKubernetesSourceCommand;discoveryKubernetesRootItem';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/kubernetes-discovery`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        await ensureMigration();

        const sources = await readSources();
        const hiddenIds = new Set(await readHiddenSourceIds());
        const visibleSources = sources.filter((s) => !hiddenIds.has(s.id));

        if (sources.length === 0) {
            // Defensive: should never happen post-migration. Surface a recovery path.
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/no-sources`,
                    label: vscode.l10n.t('No kubeconfig sources are configured.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
                this.createAddSourceChild(),
                this.createRetryChild(),
            ];
        }

        if (visibleSources.length === 0) {
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/all-sources-hidden`,
                    label: vscode.l10n.t('All kubeconfig sources are hidden. Use Manage to re-enable one.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/manage-sources`,
                    label: vscode.l10n.t('Manage kubeconfig sources\u2026'),
                    iconPath: new vscode.ThemeIcon('key'),
                    commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
                    commandArgs: [this],
                }),
                this.createAddSourceChild(),
                this.createRetryChild(),
            ];
        }

        return visibleSources.map((source) => new KubernetesKubeconfigSourceItem(this.id, source));
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
            iconPath: new vscode.ThemeIcon('symbol-namespace'),
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
            label: vscode.l10n.t('Add kubeconfig source\u2026'),
            iconPath: new vscode.ThemeIcon('add'),
            commandId: 'vscode-documentdb.command.discoveryView.kubernetes.addSource',
            commandArgs: [this],
        });
    }

    private createRetryChild(): ExtTreeElementBase {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/retry`,
            label: vscode.l10n.t('Retry'),
            iconPath: new vscode.ThemeIcon('refresh'),
            commandId: 'vscode-documentdb.command.internal.retry',
            commandArgs: [this],
        });
    }
}
