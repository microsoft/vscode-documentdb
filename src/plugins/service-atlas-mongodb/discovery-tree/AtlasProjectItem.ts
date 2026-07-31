/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { AtlasExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { escapeMarkdown } from '../../../webviews/utils/escapeMarkdown';
import { AtlasApiClient } from '../api/AtlasApiClient';
import { atlasTrace } from '../atlasTrace';
import { type AtlasDiscoveryService, classifyAtlasError } from '../discovery/AtlasDiscoveryService';
import { createAtlasClusterModel } from '../models/AtlasClusterModel';
import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasClusterItem } from './AtlasClusterItem';
import { createEmptyPlaceholderNode } from './atlasTreeNodes';
import { recoveryHintFor, showAtlasLoadFailure } from './showAtlasLoadFailure';

/**
 * Tree item representing a MongoDB Atlas project.
 *
 * Clusters are fetched on expand through the credential that owns this project in the merged
 * snapshot, so a project visible through two credentials still issues exactly one request.
 */
export class AtlasProjectItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;treeItem_atlasProject';

    /**
     * Set by {@link refresh} and consumed by the next {@link getChildren}.
     *
     * Refresh is a passive, whole-subtree action: the user is not asking about this project in
     * particular, so a failure belongs in the retry node, not a dialog. Expanding the node, or
     * clicking "Click here to retry" (which routes through `retryAuthentication`, not this method),
     * *is* a question about this project and still answers with a modal. That asymmetry is what
     * keeps the two paths distinguishable without extra command plumbing.
     */
    private suppressNextLoadModal = false;

    constructor(
        parentId: string,
        private readonly project: AtlasProject,
        private readonly discoveryService: AtlasDiscoveryService,
        private readonly ownerCredentialId: string,
        private readonly orgName?: string,
        /** Correlates the discovery journey down to each cluster; empty when not threaded. */
        private readonly journeyCorrelationId: string = '',
    ) {
        this.id = `${parentId}/${project.id}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        // One-shot, read (and reset) at the very top so an early return or a throw cannot leave a
        // stale `true` that silences the next genuine expansion.
        const quiet = this.suppressNextLoadModal;
        this.suppressNextLoadModal = false;

        atlasTrace(`project "${this.project.name}": expanding, listing clusters through its owning credential`);
        try {
            const session = await this.discoveryService.sessionRegistry.getSession(this.ownerCredentialId);
            if (!session) {
                // The registry returns `undefined` only for a genuinely rejected/absent credential;
                // transient token failures throw and are handled by the catch below.
                if (!quiet) {
                    showAtlasLoadFailure(
                        vscode.l10n.t('Failed to load MongoDB Atlas clusters.'),
                        new Error(vscode.l10n.t('The credential for this project was rejected.')),
                        recoveryHintFor('auth'),
                    );
                }
                return [this.createRetryNode()];
            }

            const client = new AtlasApiClient(
                session,
                this.discoveryService.sessionRegistry.refresherFor(this.ownerCredentialId),
            );
            const clusters = await client.listClusters(this.project.id);

            if (clusters.length === 0) {
                return [
                    createEmptyPlaceholderNode(this, vscode.l10n.t('This project does not contain any clusters yet.')),
                ];
            }

            return clusters
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                .map((cluster) => {
                    const model = createAtlasClusterModel(this.project.id, this.project.name, cluster, AtlasExperience);
                    const treeCluster = {
                        ...model,
                        treeId: `${this.id}/${cluster.name.replaceAll('/', '_')}`,
                        viewId: Views.DiscoveryView,
                    };
                    return new AtlasClusterItem(this.journeyCorrelationId, treeCluster, undefined, {
                        service: this.discoveryService,
                        ownerCredentialId: this.ownerCredentialId,
                    });
                });
        } catch (error) {
            // Classify so a network / rate-limit failure says "retry" rather than "revisit
            // credentials". The real error text is carried into the modal and the output channel.
            if (!quiet) {
                showAtlasLoadFailure(
                    vscode.l10n.t('Failed to load MongoDB Atlas clusters.'),
                    error,
                    recoveryHintFor(classifyAtlasError(error).kind),
                );
            }
            return [this.createRetryNode()];
        }
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    /**
     * Refreshing a project re-derives its owning credential's session before listing clusters, so
     * a role change made in Atlas takes effect immediately instead of waiting for the cached
     * Service Account token to expire.
     */
    public async refresh(_context: IActionContext): Promise<void> {
        // Refresh is passive: suppress the next expansion's modal so the failure lands quietly in
        // the retry node. `retryAuthentication` (the "Click here to retry" handler) does not call
        // this method, so an explicit retry still shows the modal.
        this.suppressNextLoadModal = true;
        atlasTrace(`project "${this.project.name}": explicit refresh requested`);
        // A transient token failure now throws; swallow it so the refresh still resets the error
        // state and re-runs getChildren, which reclassifies and returns the retry node quietly.
        await this.discoveryService.sessionRegistry.refreshSession(this.ownerCredentialId).catch(() => undefined);
        ext.discoveryBranchDataProvider.resetNodeErrorState(this.id);
        ext.discoveryBranchDataProvider.refresh(this);
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.project.name,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('project'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`**${escapeMarkdown(this.project.name)}**\n\n`);
        if (this.orgName) {
            md.appendMarkdown(`- **${vscode.l10n.t('Organization')}:** ${escapeMarkdown(this.orgName)}\n`);
        }
        md.appendMarkdown(`- **${vscode.l10n.t('Project ID')}:** ${escapeMarkdown(this.project.id)}\n`);
        md.appendMarkdown(`- **${vscode.l10n.t('Clusters')}:** ${String(this.project.clusterCount)}\n`);

        return md;
    }

    /**
     * A scoped cluster-list failure is a project-level problem, not necessarily a credential one,
     * so it offers a plain retry. Credential-level failures are handled by the single
     * "revisit credentials" row at the root.
     */
    private createRetryNode(): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/retry`,
            label: vscode.l10n.t('Click here to retry'),
            iconPath: new vscode.ThemeIcon('refresh'),
            commandId: 'vscode-documentdb.command.internal.retry',
            commandArgs: [this],
        });
    }
}
