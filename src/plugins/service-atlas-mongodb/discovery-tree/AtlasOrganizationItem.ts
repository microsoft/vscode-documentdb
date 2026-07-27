/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { escapeMarkdown } from '../../../webviews/utils/escapeMarkdown';
import { atlasTrace } from '../atlasTrace';
import { type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { type AtlasOrganization } from '../models/AtlasProjectModel';
import { AtlasProjectItem } from './AtlasProjectItem';
import { createEmptyPlaceholderNode } from './atlasTreeNodes';

/**
 * Tree item for a MongoDB Atlas organization.
 *
 * The organization is the natural top level: every credential resolves to one organization, and
 * two credentials for the same organization merge into a single node whose project children are
 * the union of what each credential can see.
 *
 * The node is deliberately quiet: no `via <method>` description, no credential attribution. When
 * one of several credentials for this organization is unhealthy, the node carries a warning icon
 * only, and recovery happens through the single consolidated credentials row at the root.
 */
export class AtlasOrganizationItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;treeItem_atlasOrganization';

    constructor(
        parentId: string,
        private readonly organization: AtlasOrganization,
        private readonly discoveryService: AtlasDiscoveryService,
        /** True when at least one credential that resolves to this organization is unhealthy. */
        private readonly degraded: boolean = false,
    ) {
        this.id = `${parentId}/${organization.id}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        // Uses the cached snapshot: expanding an organization must never re-attempt a credential
        // that is already known to be failing.
        const snapshot = await this.discoveryService.listAll();
        const projects = snapshot.projects.filter((entry) => entry.project.orgId === this.organization.id);

        atlasTrace(
            `organization "${this.organization.name}": ${String(projects.length)} project(s) from the current snapshot`,
        );

        if (projects.length === 0) {
            return [
                createEmptyPlaceholderNode(
                    this,
                    vscode.l10n.t(
                        'No projects are visible here yet. Check the project access and roles of the credentials for this organization in MongoDB Atlas.',
                    ),
                ),
            ];
        }

        return projects.map(
            (entry) =>
                new AtlasProjectItem(
                    this.id,
                    entry.project,
                    this.discoveryService,
                    entry.ownerCredentialId,
                    this.organization.name,
                ),
        );
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    /**
     * Refreshing an organization re-attempts the whole fleet, because its project children come
     * from the shared snapshot rather than from a request of its own.
     *
     * Without this hook the generic refresh path would simply re-read the cached snapshot, so a
     * user who fixed roles in Atlas and refreshed the organization they were looking at would keep
     * seeing the stale result.
     */
    public async refresh(_context: IActionContext): Promise<void> {
        atlasTrace(`organization "${this.organization.name}": explicit refresh requested`);
        await this.discoveryService.refreshAll();
        ext.discoveryBranchDataProvider.resetNodeErrorState(this.id);
        ext.discoveryBranchDataProvider.refresh(this);
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.organization.name,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon(this.degraded ? 'warning' : 'organization'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`**${escapeMarkdown(this.organization.name)}**\n\n`);
        md.appendMarkdown(`- **${vscode.l10n.t('Organization ID')}:** ${escapeMarkdown(this.organization.id)}\n`);

        if (this.degraded) {
            md.appendMarkdown(`\n---\n`);
            md.appendMarkdown(
                escapeMarkdown(
                    vscode.l10n.t(
                        'Some projects may be hidden. A credential for this organization needs attention; use "Click here to revisit credentials".',
                    ),
                ),
            );
        }

        return md;
    }
}
