/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { ENABLED_CONTEXTS_KEY, HIDDEN_CONTEXTS_KEY, resolveEnabledContextNames } from '../config';
import { getContexts, loadConfiguredKubeConfig, type KubeContextInfo } from '../kubernetesClient';
import { KubernetesContextItem } from './KubernetesContextItem';

export class KubernetesRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableFilterCommand;enableLearnMoreCommand;discoveryKubernetesRootItem';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/kubernetes-discovery`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const journeyCorrelationId = randomUUID();

        const hiddenContextNames = ext.context.globalState.get<string[]>(HIDDEN_CONTEXTS_KEY, []);

        let allContexts: KubeContextInfo[];
        try {
            const kubeConfig = await loadConfiguredKubeConfig();
            allContexts = getContexts(kubeConfig);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(`[KubernetesDiscovery] Failed to load kubeconfig: ${errorMessage}`);

            return this.createKubeconfigRecoveryChildren(
                vscode.l10n.t('Failed to load Kubernetes kubeconfig. Configure kubeconfig or retry.'),
            );
        }

        if (allContexts.length === 0) {
            return this.createKubeconfigRecoveryChildren(
                vscode.l10n.t(
                    'No Kubernetes contexts found in the configured kubeconfig. Configure kubeconfig or retry.',
                ),
            );
        }

        const configuredEnabledContextNames = ext.context.globalState.get<string[] | undefined>(ENABLED_CONTEXTS_KEY);
        const enabledContextNames = new Set(
            resolveEnabledContextNames(
                allContexts.map((ctx) => ctx.name),
                configuredEnabledContextNames,
            ),
        );

        // Filter to enabled contexts only, excluding hidden ones; sort for stable order
        const visibleContexts = allContexts
            .filter((ctx) => enabledContextNames.has(ctx.name) && !hiddenContextNames.includes(ctx.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        if (enabledContextNames.size === 0) {
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/no-enabled-contexts`,
                    label: vscode.l10n.t('No Kubernetes contexts are enabled. Configure kubeconfig or retry.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/configure-kubeconfig`,
                    label: vscode.l10n.t('Configure kubeconfig'),
                    iconPath: new vscode.ThemeIcon('key'),
                    commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
                    commandArgs: [this],
                }),
                this.createRetryChild(),
            ];
        }

        if (visibleContexts.length === 0) {
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/all-contexts-hidden`,
                    label: vscode.l10n.t('All Kubernetes contexts are hidden by Filter. Manage Filter or retry.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/manage-filter`,
                    label: vscode.l10n.t('Manage Filter'),
                    iconPath: new vscode.ThemeIcon('filter'),
                    commandId: 'vscode-documentdb.command.discoveryView.filterProviderContent',
                    commandArgs: [this],
                }),
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/configure-kubeconfig`,
                    label: vscode.l10n.t('Configure kubeconfig'),
                    iconPath: new vscode.ThemeIcon('key'),
                    commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
                    commandArgs: [this],
                }),
                this.createRetryChild(),
            ];
        }

        return visibleContexts.map((ctx) => new KubernetesContextItem(this.id, ctx, journeyCorrelationId));
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

    private createKubeconfigRecoveryChildren(message: string): ExtTreeElementBase[] {
        return [
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/kubeconfig-error`,
                label: message,
                iconPath: new vscode.ThemeIcon('warning'),
            }),
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/configure-kubeconfig`,
                label: vscode.l10n.t('Configure kubeconfig'),
                iconPath: new vscode.ThemeIcon('key'),
                commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
                commandArgs: [this],
            }),
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/open-docs`,
                label: vscode.l10n.t('Open Kubernetes discovery docs'),
                iconPath: new vscode.ThemeIcon('book'),
                commandId: 'vscode-documentdb.command.discoveryView.learnMoreAboutProvider',
                commandArgs: [this],
            }),
            this.createRetryChild(),
        ];
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
