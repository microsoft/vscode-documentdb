/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { DISCOVERY_PROVIDER_ID, type KubeconfigSourceRecord } from '../config';
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
        // A journey starts each time the user expands this source (matches the funnel
        // semantics used by the Azure discovery roots). The id is threaded through all
        // descendants so the source -> context -> namespace -> target chain shares one id.
        const journeyCorrelationId = randomUUID();

        const children = await callWithTelemetryAndErrorHandling(
            'kubernetes-discovery.loadKubeconfigSource',
            async (context: IActionContext) => {
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;
                context.telemetry.properties.kubeconfigSourceKind = this.source.kind;
                context.telemetry.properties.journeyCorrelationId = journeyCorrelationId;

                let contexts: KubeContextInfo[];
                try {
                    // Sub-step with rethrow: lets the telemetry library record the load
                    // failure (result = Failed, error name + message) automatically, while
                    // the outer event still renders the recovery UI below. suppressDisplay
                    // is set because we surface our own modal warning in the recovery path.
                    contexts =
                        (await callWithTelemetryAndErrorHandling(
                            'kubernetes-discovery.loadKubeconfigSource.load',
                            async (loadContext: IActionContext) => {
                                loadContext.errorHandling.rethrow = true;
                                loadContext.errorHandling.suppressDisplay = true;
                                const kubeConfig = await loadConfiguredKubeConfig(this.source.id);
                                return getContexts(kubeConfig);
                            },
                        )) ?? [];
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    context.telemetry.properties.kubeconfigLoadResult = 'failed';
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

                context.telemetry.measurements.contextsInSource = contexts.length;

                if (contexts.length === 0) {
                    context.telemetry.properties.kubeconfigLoadResult = 'noContexts';
                    return this.createKubeconfigRecoveryChildren(
                        vscode.l10n.t('No Kubernetes contexts were found in this kubeconfig source.'),
                    );
                }

                context.telemetry.properties.kubeconfigLoadResult = 'loaded';

                const sortedContexts = [...contexts].sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, { numeric: true }),
                );

                // Resolve display aliases once per source-load. Pass the per-context alias into
                // the child item so its synchronous getTreeItem() can render label / description
                // without needing its own async lookup.
                const aliases = await aliasMapForSource(this.source.id);

                // Best-effort: drop aliases for contexts that have disappeared from this source.
                // Fire-and-forget so a slow / failing storage write never blocks the tree.
                void pruneAliasesForSource(
                    this.source.id,
                    sortedContexts.map((ctx) => ctx.name),
                ).catch((pruneError) => {
                    const message = pruneError instanceof Error ? pruneError.message : String(pruneError);
                    ext.outputChannel.warn(
                        `[KubernetesDiscovery] Failed to prune context aliases for source "${this.source.label}": ${message}`,
                    );
                });

                return sortedContexts.map(
                    (ctx) =>
                        new KubernetesContextItem(
                            this.id,
                            this.source.id,
                            ctx,
                            journeyCorrelationId,
                            aliases.get(ctx.name),
                        ),
                );
            },
        );

        return children ?? [];
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.source.label,
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
                    id: `${this.id}/edit`,
                    label: vscode.l10n.t('Edit Kubeconfig'),
                    iconPath: new vscode.ThemeIcon('go-to-file'),
                    commandId: 'vscode-documentdb.command.discoveryView.kubernetes.editSource',
                    commandArgs: [this],
                }),
            );
        }

        // Inline (pasted) sources have no on-disk file, so offer a read-only view to
        // help the user inspect the stored YAML (e.g. to copy, fix, and re-paste it).
        if (this.source.kind === 'inline') {
            children.push(
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/view`,
                    label: vscode.l10n.t('View Kubeconfig'),
                    iconPath: new vscode.ThemeIcon('eye'),
                    commandId: 'vscode-documentdb.command.discoveryView.kubernetes.viewSource',
                    commandArgs: [this],
                }),
            );
        }

        return children;
    }
}

function buildContextValue(source: KubeconfigSourceRecord): string {
    // All sources, including the default, share the same context-value markers
    // so Rename / Remove are exposed uniformly. The Default source is
    // re-creatable through the "+" inline action via {@link addDefaultSource}.
    const markers = ['enableRefreshCommand', 'discovery.kubernetesSource', 'discovery.kubernetesSourceMutable'];

    // File sources have an on-disk path, so they additionally expose "Edit Kubeconfig".
    if (source.kind === 'file') {
        markers.push('discovery.kubernetesSourceFile');
    }

    // Inline (pasted) sources have no on-disk file, so they expose a read-only "View Kubeconfig".
    if (source.kind === 'inline') {
        markers.push('discovery.kubernetesSourceInline');
    }

    return createContextValue(markers);
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
    return new vscode.ThemeIcon('group-by-ref-type');
}

function sanitize(value: string): string {
    return value.replace(/[/\\:@]/g, '_');
}
