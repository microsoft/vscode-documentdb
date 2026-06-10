/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type KubeconfigSourceRecord } from '../config';
import {
    describeDefaultKubeconfigPath,
    getContexts,
    loadConfiguredKubeConfig,
    type KubeContextInfo,
} from '../kubernetesClient';
import { aliasMapForSource, pruneAliasesForSource } from '../sources/aliasStore';
import { KubernetesContextItem } from './KubernetesContextItem';
import { hasRetryActionNode } from './retryNodeDetection';

/**
 * Tree node representing a single kubeconfig source (Default / file / pasted YAML).
 *
 * Children are {@link KubernetesContextItem}s for every context defined by the
 * source's kubeconfig. A failed load shows recovery actions scoped to this source.
 */
export class KubernetesKubeconfigSourceItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string;

    constructor(
        public readonly parentId: string,
        public readonly source: KubeconfigSourceRecord,
    ) {
        this.id = `${parentId}/${sanitize(source.id)}`;
        this.contextValue = buildContextValue(source);
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const journeyCorrelationId = randomUUID();

        let contexts: KubeContextInfo[];
        try {
            const kubeConfig = await loadConfiguredKubeConfig(this.source.id);
            contexts = getContexts(kubeConfig);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(
                `[KubernetesDiscovery] Failed to load kubeconfig for source "${this.source.label}": ${errorMessage}`,
            );

            return this.createKubeconfigRecoveryChildren(
                vscode.l10n.t(
                    'Failed to load this kubeconfig source: {0}',
                    errorMessage || vscode.l10n.t('unknown error'),
                ),
            );
        }

        if (contexts.length === 0) {
            return this.createKubeconfigRecoveryChildren(
                vscode.l10n.t('No Kubernetes contexts were found in this kubeconfig source.'),
            );
        }

        const sortedContexts = [...contexts].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Resolve display aliases once per source-load. Pass the per-context alias into
        // the child item so its synchronous getTreeItem() can render label / description
        // without needing its own async lookup.
        const aliases = await aliasMapForSource(this.source.id);

        // Best-effort: drop aliases for contexts that have disappeared from this source.
        // Fire-and-forget so a slow / failing storage write never blocks the tree.
        void pruneAliasesForSource(
            this.source.id,
            sortedContexts.map((ctx) => ctx.name),
        ).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(
                `[KubernetesDiscovery] Failed to prune context aliases for source "${this.source.label}": ${message}`,
            );
        });

        return sortedContexts.map(
            (ctx) =>
                new KubernetesContextItem(this.id, this.source.id, ctx, journeyCorrelationId, aliases.get(ctx.name)),
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.source.label,
            description: buildDescription(this.source),
            tooltip: buildTooltip(this.source),
            iconPath: buildIcon(this.source),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return hasRetryActionNode(children);
    }

    private createKubeconfigRecoveryChildren(message: string): ExtTreeElementBase[] {
        // Modal on purpose: a failed source is only (re)loaded on an explicit user
        // action (expand or "Click here to retry"). The retry-node cache prevents
        // getChildren() from re-running on passive tree refreshes, so this modal
        // cannot spam — it fires once per real load attempt.
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Kubeconfig source "{0}": {1}', this.source.label, message),
            { modal: true },
        );

        const children: ExtTreeElementBase[] = [
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/retry`,
                label: vscode.l10n.t('Click here to retry'),
                iconPath: new vscode.ThemeIcon('refresh'),
                commandId: 'vscode-documentdb.command.discoveryView.kubernetes.reloadSource',
                commandArgs: [this],
            }),
        ];

        // File sources have an on-disk path, so offer a one-click way to open and fix it.
        if (this.source.kind === 'file' && this.source.path) {
            children.push(
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/open-in-editor`,
                    label: vscode.l10n.t('Open in Editor'),
                    iconPath: new vscode.ThemeIcon('go-to-file'),
                    commandId: 'vscode-documentdb.command.discoveryView.kubernetes.openSourceInEditor',
                    commandArgs: [this],
                }),
            );
        }

        children.push(
            createGenericElementWithContext({
                contextValue: 'error',
                id: `${this.id}/open-docs`,
                label: vscode.l10n.t('Learn more about Kubernetes discovery'),
                iconPath: new vscode.ThemeIcon('book'),
                commandId: 'vscode-documentdb.command.discoveryView.learnMoreAboutProvider',
                commandArgs: [this],
            }),
        );

        return children;
    }
}

function buildContextValue(source: KubeconfigSourceRecord): string {
    // All sources, including the default, share the same context-value markers
    // so Rename / Remove are exposed uniformly. The Default source is
    // re-creatable through the "+" inline action via {@link addDefaultSource}.
    const markers = ['enableRefreshCommand', 'discovery.kubernetesSource', 'discovery.kubernetesSourceMutable'];

    // File sources have an on-disk path, so they additionally expose "Open in Editor".
    if (source.kind === 'file') {
        markers.push('discovery.kubernetesSourceFile');
    }

    return createContextValue(markers);
}

function buildDescription(source: KubeconfigSourceRecord): string | undefined {
    switch (source.kind) {
        case 'file':
            return source.path ? `(file: ${shortenPath(source.path)})` : '(file)';
        case 'inline':
        case 'default':
            return undefined;
        default:
            return undefined;
    }
}

function buildTooltip(source: KubeconfigSourceRecord): vscode.MarkdownString {
    const lines: string[] = [`**Source:** ${source.label}`, `**Kind:** ${source.kind}`];
    if (source.kind === 'file' && source.path) {
        lines.push(`**Path:** \`${source.path}\``);
    } else if (source.kind === 'inline') {
        lines.push('**Storage:** VS Code Secret Storage');
    } else if (source.kind === 'default') {
        lines.push(`**Path:** \`${describeDefaultKubeconfigPath()}\``);
        lines.push(
            '**Source:** Resolved from the `KUBECONFIG` environment variable, otherwise your default kubeconfig.',
        );
    }
    return new vscode.MarkdownString(lines.join('\n\n'));
}

function buildIcon(_source: KubeconfigSourceRecord): vscode.ThemeIcon {
    return new vscode.ThemeIcon('plug');
}

function shortenPath(absolutePath: string): string {
    const segments = absolutePath.split(/[/\\]/);
    if (segments.length <= 3) {
        return absolutePath;
    }
    return `…/${segments.slice(-2).join('/')}`;
}

function sanitize(value: string): string {
    return value.replace(/[/\\:@]/g, '_');
}
