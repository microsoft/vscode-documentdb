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
import { CONTEXT_ALIASES_KEY, CUSTOM_KUBECONFIG_PATH_KEY, ENABLED_CONTEXTS_KEY, HIDDEN_CONTEXTS_KEY } from '../config';
import { getContexts, loadKubeConfig, type KubeContextInfo } from '../kubernetesClient';
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

        const enabledContextNames = ext.context.globalState.get<string[]>(ENABLED_CONTEXTS_KEY, []);
        const hiddenContextNames = ext.context.globalState.get<string[]>(HIDDEN_CONTEXTS_KEY, []);

        if (!enabledContextNames || enabledContextNames.length === 0) {
            const configureResult = await this.askToConfigureCredentials();
            if (configureResult === 'configure') {
                void vscode.commands.executeCommand('vscode-documentdb.command.discoveryView.manageCredentials', this);
            }

            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/retry`,
                    label: vscode.l10n.t('Click here to retry'),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    commandId: 'vscode-documentdb.command.internal.retry',
                    commandArgs: [this],
                }),
            ];
        }

        // Load kubeconfig
        const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
        let allContexts: KubeContextInfo[];
        try {
            const kubeConfig = await loadKubeConfig(customPath);
            allContexts = getContexts(kubeConfig);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(`[KubernetesDiscovery] Failed to load kubeconfig: ${errorMessage}`);

            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/retry`,
                    label: vscode.l10n.t('Failed to load kubeconfig. Click to retry.'),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    commandId: 'vscode-documentdb.command.internal.retry',
                    commandArgs: [this],
                }),
            ];
        }

        // Get aliases for display
        const aliases = ext.context.globalState.get<Record<string, string>>(CONTEXT_ALIASES_KEY, {});

        // Filter to enabled contexts only, excluding hidden ones
        const matchedContexts = allContexts.filter(
            (ctx) => enabledContextNames.includes(ctx.name) && !hiddenContextNames.includes(ctx.name),
        );

        if (matchedContexts.length === 0) {
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/retry`,
                    label: vscode.l10n.t('No enabled contexts found in kubeconfig. Click to reconfigure.'),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    commandId: 'vscode-documentdb.command.internal.retry',
                    commandArgs: [this],
                }),
            ];
        }

        return matchedContexts
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map((ctx) => new KubernetesContextItem(this.id, ctx, aliases[ctx.name], journeyCorrelationId));
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

    private async askToConfigureCredentials(): Promise<'configure' | 'cancel'> {
        const configure = vscode.l10n.t('Configure Credentials');
        const result = await vscode.window.showInformationMessage(
            vscode.l10n.t('No Kubernetes contexts are configured. Would you like to set up Kubernetes discovery?'),
            { modal: false },
            configure,
        );
        return result === configure ? 'configure' : 'cancel';
    }
}
