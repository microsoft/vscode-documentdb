/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
    type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';

/**
 * Minimal shape required to walk a tree: anything that can return the children
 * of a node (or the root items when called with `undefined`). Both our branch
 * data providers and individual {@link TreeElement}s satisfy this.
 */
export interface TreeChildrenProvider {
    getChildren(element?: TreeElement): vscode.ProviderResult<TreeElement[]>;
}

export interface PickTreeNodeOptions {
    /**
     * Context-value token that marks a node as a selectable leaf (e.g.
     * `'treeItem_database'`). A node is returned as soon as the user picks an
     * item whose `contextValue` contains this token. All non-leaf items that
     * expose `getChildren` are treated as navigable containers.
     */
    readonly leafContextValue: string;

    /**
     * Root provider whose tree is walked. Defaults to the Connections view
     * branch data provider. Reusing the provider (rather than re-reading
     * storage) means folder nesting and connect/auth-on-expand are inherited
     * for free.
     */
    readonly provider?: TreeChildrenProvider;

    /**
     * Identifies the caller in telemetry so we can see how the picker is used
     * (e.g. `'playground.connect'`, `'playground.runUnconnected'`).
     */
    readonly telemetrySource: string;

    /** Placeholder shown in the quick pick. */
    readonly placeHolder?: string;
}

/** Context-value tokens that are never navigable nor selectable (action / placeholder nodes). */
const EXCLUDED_CONTEXT_TOKENS = new Set<string>(['treeItem_newConnection', 'treeItem_emptyFolderPlaceholder', 'error']);

/** Quick-pick id used for the synthetic "go back one level" entry. */
const BACK_PICK_ID = '__pickTreeNode_back__';

/** Quick-pick id for the informational "this level is empty" entry (selecting it goes back). */
const EMPTY_PICK_ID = '__pickTreeNode_empty__';

/** Quick-pick id for the root-level "no connections" entry (selecting it cancels the picker). */
const NO_CONNECTIONS_PICK_ID = '__pickTreeNode_noConnections__';

function tokenize(contextValue: string | undefined): string[] {
    return (contextValue ?? '').split(';').filter(Boolean);
}

function getTreeItemLabel(treeItem: vscode.TreeItem, fallback: string): string {
    const label = treeItem.label;
    if (typeof label === 'string') {
        return label;
    }
    return label?.label ?? fallback;
}

/**
 * Carry the tree item's own icon onto the quick pick so clusters, folders and
 * databases look the same as in the tree. `string` icon paths (file paths) are
 * not valid quick-pick icons and are dropped.
 */
function toQuickPickIconPath(treeItem: vscode.TreeItem): vscode.QuickPickItem['iconPath'] {
    const iconPath = treeItem.iconPath;
    if (!iconPath || typeof iconPath === 'string') {
        return undefined;
    }
    return iconPath as vscode.QuickPickItem['iconPath'];
}

/**
 * Build the quick-pick list for one tree level. Runs inside the promise handed
 * to `showQuickPick`, so the quick pick shows a busy/loading indicator while
 * `getChildren` does its work (e.g. establishing a cluster connection).
 *
 * The list always contains at least one entry so the quick pick never collapses:
 *  - a "Back" entry on non-root levels,
 *  - an "empty" entry when a level has no selectable children, and
 *  - a "no connections" entry at an empty root.
 */
async function buildLevelPicks(
    provider: TreeChildrenProvider,
    parent: TreeElement | undefined,
    depth: number,
    leafContextValue: string,
): Promise<IAzureQuickPickItem<TreeElement | undefined>[]> {
    const children = (await provider.getChildren(parent)) ?? [];

    const itemPicks: IAzureQuickPickItem<TreeElement | undefined>[] = [];
    for (const child of children) {
        const treeItem = await child.getTreeItem();
        const tokens = tokenize(treeItem.contextValue);
        if (tokens.some((t) => EXCLUDED_CONTEXT_TOKENS.has(t))) {
            continue;
        }

        const isLeaf = tokens.includes(leafContextValue);
        const isNavigable = !isLeaf && typeof child.getChildren === 'function';
        if (!isLeaf && !isNavigable) {
            continue;
        }

        itemPicks.push({
            label: getTreeItemLabel(treeItem, child.id),
            description: typeof treeItem.description === 'string' ? treeItem.description : undefined,
            iconPath: toQuickPickIconPath(treeItem),
            data: child,
        });
    }

    const picks: IAzureQuickPickItem<TreeElement | undefined>[] = [];
    if (depth > 0) {
        picks.push({ id: BACK_PICK_ID, label: l10n.t('$(arrow-left) Back'), data: undefined });
    }

    if (itemPicks.length === 0) {
        if (depth > 0) {
            // Empty folder / nothing connectable here — show an "empty" hint alongside Back.
            picks.push({
                id: EMPTY_PICK_ID,
                label: l10n.t('$(info) Empty'),
                description: l10n.t('Nothing to show here'),
                data: undefined,
            });
        } else {
            picks.push({
                id: NO_CONNECTIONS_PICK_ID,
                label: l10n.t('$(info) No connections found'),
                description: l10n.t('Add a connection in the DocumentDB panel first'),
                data: undefined,
            });
        }
        return picks;
    }

    picks.push(...itemPicks);
    return picks;
}

/**
 * Generic, reusable quick-pick that drills through a tree (folders → clusters →
 * databases …) by repeatedly calling `getChildren`, presenting one quick pick
 * per level until the user selects a node matching {@link PickTreeNodeOptions.leafContextValue}.
 *
 * The picker reuses the live tree, so:
 *  - folder nesting is navigated naturally (no bespoke folder handling), and
 *  - expanding a cluster triggers the same connect/auth flow as the tree view.
 *
 * Returns the selected {@link TreeElement}, or `undefined` if the user cancelled
 * or there was nothing to pick.
 */
export async function pickTreeNode(options: PickTreeNodeOptions): Promise<TreeElement | undefined> {
    return callWithTelemetryAndErrorHandling('documentdb.pickTreeNode', async (context: IActionContext) => {
        // We surface our own (non-modal) messages for empty/cancelled states.
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.source = options.telemetrySource;
        context.telemetry.properties.leafContextValue = options.leafContextValue;

        const provider = options.provider ?? ext.connectionsBranchDataProvider;

        // Navigation stack of parents; `undefined` is the root level.
        const parents: (TreeElement | undefined)[] = [undefined];
        let stepCount = 0;
        let maxDepth = 0;
        let outcome: 'picked' | 'cancelled' | 'empty' = 'cancelled';

        try {
            while (true) {
                const depth = parents.length - 1;
                maxDepth = Math.max(maxDepth, depth);

                const parent = parents[parents.length - 1];

                // Hand a *promise* of picks to showQuickPick: it shows the quick pick
                // immediately with a busy/loading indicator while getChildren runs
                // (which may establish a cluster connection that takes a few seconds),
                // instead of leaving the user with no UI during the wait.
                const picked = await context.ui.showQuickPick(
                    buildLevelPicks(provider, parent, depth, options.leafContextValue),
                    {
                        placeHolder: options.placeHolder ?? l10n.t('Select an item'),
                        loadingPlaceHolder: l10n.t('Loading…'),
                        suppressPersistence: true,
                        matchOnDescription: true,
                    },
                );
                stepCount++;

                if (picked.id === NO_CONNECTIONS_PICK_ID) {
                    outcome = 'empty';
                    return undefined;
                }

                if (picked.id === BACK_PICK_ID || picked.id === EMPTY_PICK_ID) {
                    parents.pop();
                    continue;
                }

                const node = picked.data;
                if (!node) {
                    continue;
                }

                const pickedTreeItem = await node.getTreeItem();
                if (tokenize(pickedTreeItem.contextValue).includes(options.leafContextValue)) {
                    outcome = 'picked';
                    return node;
                }

                // Drill into the selected container.
                parents.push(node);
            }
        } catch (error) {
            if (error instanceof UserCancelledError) {
                outcome = 'cancelled';
                return undefined;
            }
            throw error;
        } finally {
            context.telemetry.properties.outcome = outcome;
            context.telemetry.measurements.stepCount = stepCount;
            context.telemetry.measurements.maxDepth = maxDepth;
        }
    });
}
