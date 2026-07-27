/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
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
import { atlasTrace } from '../atlasTrace';
import { getAtlasViewMode } from '../commands/switchAtlasViewMode';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { readAtlasCredentials } from '../credentials/atlasCredentialStore';
import {
    snapshotHasFailures,
    type AtlasDiscoveryService,
    type AtlasDiscoverySnapshot,
} from '../discovery/AtlasDiscoveryService';
import { createAtlasClusterModel } from '../models/AtlasClusterModel';
import { AtlasClusterItem } from './AtlasClusterItem';
import { AtlasOrganizationItem } from './AtlasOrganizationItem';
import { createEmptyPlaceholderNode, createRecoveryNode } from './atlasTreeNodes';

/**
 * Root tree item for the MongoDB Atlas discovery provider.
 *
 * Renders the quiet merged tree: organization to project to cluster, with duplicate resources
 * merged by Atlas ID and no per-node credential attribution. Whatever goes wrong across the
 * credential fleet collapses into a single recovery row, so one broken credential never blanks the
 * healthy data and never produces a storm of nodes or modals. That row asks for a retry or for a
 * credential review depending on what actually failed.
 */
export class AtlasServiceRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;

    /**
     * Must stay a writable property: the discovery branch data provider appends its own markers
     * (for example `rootItem`) onto root elements, so a getter-only accessor breaks activation.
     * The view-mode marker is therefore folded in at {@link getTreeItem} time instead of being
     * baked into this field, which keeps it current after a toggle without accumulating stale
     * markers.
     */
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableLearnMoreCommand;discoveryAtlasServiceRootItem';

    constructor(
        private readonly discoveryService: AtlasDiscoveryService,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/${DISCOVERY_PROVIDER_ID}`;
    }

    /**
     * The current view mode is part of the rendered context value so the toggle command can be
     * gated on it: the icon reflects the current mode and the action switches to the other one.
     */
    private get viewModeContextValue(): string {
        return getAtlasViewMode() === 'list' ? 'discoveryAtlasViewModeList' : 'discoveryAtlasViewModeTree';
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const credentials = await readAtlasCredentials();
        if (credentials.length === 0) {
            atlasTrace('root: no credentials stored, showing the sign-in row');
            return [this.createSignInNode()];
        }

        const listMode = getAtlasViewMode() === 'list';
        atlasTrace(
            `root: expanding in ${listMode ? 'list' : 'tree'} mode with ${String(credentials.length)} credential(s)`,
        );
        const snapshot = await this.discoveryService.listAll({ includeClusters: listMode });

        const children: ExtTreeElementBase[] = [];
        if (snapshotHasFailures(snapshot)) {
            // The recovery row is just another row, so it drops into a flat list unchanged and
            // List mode needs no special casing: a failure never forces a view-mode switch.
            children.push(createRecoveryNode(this, snapshot));
        }

        children.push(
            ...(listMode ? this.buildClusterRows(snapshot) : this.buildOrganizationRows(snapshot, credentials)),
        );

        if (children.length === 0) {
            atlasTrace('root: nothing visible to any credential, showing the empty placeholder');
            return [
                createEmptyPlaceholderNode(
                    this,
                    vscode.l10n.t(
                        'These credentials cannot see any organizations yet. Check their project access and roles in MongoDB Atlas.',
                    ),
                ),
            ];
        }

        return children;
    }

    /** Tree mode: one node per merged organization. */
    private buildOrganizationRows(
        snapshot: AtlasDiscoverySnapshot,
        credentials: Awaited<ReturnType<typeof readAtlasCredentials>>,
    ): ExtTreeElementBase[] {
        // Organizations whose only credentials failed keep no data of their own; a credential's
        // cached organization id is what lets a partially-degraded organization still be flagged.
        const degradedOrgIds = new Set(
            snapshot.credentialErrors
                .map((error) => credentials.find((record) => record.id === error.credentialId)?.orgId)
                .filter((orgId): orgId is string => typeof orgId === 'string'),
        );

        return snapshot.organizations.map(
            (entry) =>
                new AtlasOrganizationItem(
                    this.id,
                    entry.organization,
                    this.discoveryService,
                    degradedOrgIds.has(entry.organization.id),
                ),
        );
    }

    /** List mode: a flat, deduplicated cluster list carrying `organization · project` context. */
    private buildClusterRows(snapshot: AtlasDiscoverySnapshot): ExtTreeElementBase[] {
        const orgNames = new Map(
            snapshot.organizations.map((entry) => [entry.organization.id, entry.organization.name]),
        );

        return snapshot.clusters.map((entry) => {
            const model = createAtlasClusterModel(entry.projectId, entry.projectName, entry.cluster, AtlasExperience);
            const treeCluster = {
                ...model,
                treeId: `${this.id}/${entry.projectId}/${entry.cluster.name.replaceAll('/', '_')}`,
                viewId: Views.DiscoveryView,
            };
            const orgName = orgNames.get(entry.orgId);
            const context = orgName ? `${orgName} · ${entry.projectName}` : entry.projectName;
            return new AtlasClusterItem('', treeCluster, context, {
                service: this.discoveryService,
                ownerCredentialId: entry.ownerCredentialId,
            });
        });
    }

    /**
     * Explicit refresh re-attempts every credential, healthy and failed alike, and re-derives
     * every session first. Passive expansion reuses the cached snapshot, so a persistently failing
     * credential is not hammered every time a node is expanded.
     */
    public async refresh(_context: IActionContext): Promise<void> {
        atlasTrace('root: explicit refresh requested');
        await this.discoveryService.refreshAll({ includeClusters: getAtlasViewMode() === 'list' });
        ext.discoveryBranchDataProvider.resetNodeErrorState(this.id);
        ext.discoveryBranchDataProvider.refresh(this);
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: createContextValue([this.contextValue, this.viewModeContextValue]),
            label: vscode.l10n.t('MongoDB Atlas'),
            iconPath: new vscode.ThemeIcon('cloud'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private createSignInNode(): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/sign-in`,
            label: vscode.l10n.t('Sign in to view MongoDB Atlas clusters'),
            iconPath: new vscode.ThemeIcon('sign-in'),
            commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
            commandArgs: [this],
        });
    }
}
