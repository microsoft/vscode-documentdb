/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { readAtlasCredentials } from '../credentials/atlasCredentialStore';
import { snapshotHasFailures, type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { AtlasOrganizationItem } from './AtlasOrganizationItem';
import { createEmptyPlaceholderNode, createRevisitCredentialsNode } from './atlasTreeNodes';

/**
 * Root tree item for the MongoDB Atlas discovery provider.
 *
 * Renders the quiet merged tree: organization to project to cluster, with duplicate resources
 * merged by Atlas ID and no per-node credential attribution. Whatever goes wrong across the
 * credential fleet collapses into a single "Click here to revisit credentials" row, so one broken
 * credential never blanks the healthy data and never produces a storm of nodes or modals.
 */
export class AtlasServiceRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableLearnMoreCommand;discoveryAtlasServiceRootItem';

    constructor(
        private readonly discoveryService: AtlasDiscoveryService,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/${DISCOVERY_PROVIDER_ID}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const credentials = await readAtlasCredentials();
        if (credentials.length === 0) {
            return [this.createSignInNode()];
        }

        const snapshot = await this.discoveryService.listAll();

        const children: ExtTreeElementBase[] = [];
        if (snapshotHasFailures(snapshot)) {
            children.push(createRevisitCredentialsNode(this, snapshot));
        }

        // Organizations whose only credentials failed keep no data of their own; a credential's
        // cached organization id is what lets a partially-degraded organization still be flagged.
        const degradedOrgIds = new Set(
            snapshot.credentialErrors
                .map((error) => credentials.find((record) => record.id === error.credentialId)?.orgId)
                .filter((orgId): orgId is string => typeof orgId === 'string'),
        );

        for (const entry of snapshot.organizations) {
            children.push(
                new AtlasOrganizationItem(
                    this.id,
                    entry.organization,
                    this.discoveryService,
                    degradedOrgIds.has(entry.organization.id),
                ),
            );
        }

        if (children.length === 0) {
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

    /**
     * Explicit refresh re-attempts every credential, healthy and failed alike. Passive expansion
     * reuses the cached snapshot, so a persistently failing credential is not hammered every time
     * a node is expanded.
     */
    public async refresh(_context: IActionContext): Promise<void> {
        this.discoveryService.invalidate();
        await this.discoveryService.listAll({ forceRefresh: true });
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
            contextValue: this.contextValue,
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
