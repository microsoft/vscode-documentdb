/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `pickTreeNode` — a generic, reusable quick pick that lets the user *browse* an
 * existing tree view to select a node, instead of presenting a flat, hand-built
 * list.
 *
 * ## Why this exists
 * Several flows need the user to choose, say, a database from the Connections
 * view (the query playground's "Connect to a database" being the first). The
 * naive approach — enumerate every cluster, connect to each, list its databases,
 * and flatten the result into one quick pick — is slow, eagerly connects to
 * clusters the user doesn't care about, and re-implements folder nesting,
 * sorting, auth-on-expand and icons that the tree already does.
 *
 * Instead this picker *walks the live tree*: at each level it calls the tree's
 * own `getChildren`, shows those children as quick-pick items, and drills into
 * the one the user selects — exactly mirroring what expanding a node in the tree
 * view does. As a result we inherit, for free:
 *  - folder nesting and ordering (no bespoke folder handling),
 *  - lazy connect/auth-on-expand (selecting a cluster triggers the same
 *    connection/authentication the tree performs when expanded), and
 *  - each item's tree icon.
 *
 * The shape is deliberately the one the partner extension (vscode-cosmosdb)
 * arrived at for its `pickAppResource`/`pickWorkspaceResource` helpers: drive a
 * quick pick off `getChildren` + `getTreeItem` + a `contextValue` filter.
 *
 * ## How it works
 *  - A node is a selectable **leaf** when its `contextValue` contains
 *    {@link PickTreeNodeOptions.leafContextValue} (e.g. `'treeItem_database'`).
 *    Any other node that exposes `getChildren` is a navigable **container**.
 *  - Navigation is an explicit parent stack (root = `undefined`). "Back" pops it;
 *    selecting a container pushes it. This is iterative (not recursive) so
 *    "Back" is trivial and there is no call-stack growth.
 *  - Each level's picks are produced as a **promise** handed to `showQuickPick`,
 *    which renders the quick pick immediately with a busy/loading indicator while
 *    `getChildren` runs (a cluster connection can take seconds). Without this the
 *    quick pick would simply vanish during the wait.
 *  - The list is never empty: "Back" (on nested levels) plus an "empty" /
 *    "no connections" placeholder keep the quick pick alive so the user can
 *    always navigate out.
 *
 * ## Termination / safety
 * Every loop iteration either blocks on a quick pick (waiting for the user) or
 * pops the stack toward the root, so the loop cannot spin: there is no infinite
 * loop even if a level is empty. Cancellation (Esc → `UserCancelledError`) and
 * the "no connections" root state both resolve to `undefined`.
 *
 * ## Telemetry
 * Wrapped in its own `documentdb.pickTreeNode` event so we can see how the picker
 * is used: `source` (caller), `leafContextValue`, `outcome`
 * (`picked` | `cancelled` | `empty`), and measurements `stepCount` / `maxDepth`.
 *
 * ## Reuse
 * The picker is intentionally domain-agnostic. Callers customize it via
 * {@link PickTreeNodeOptions}: the leaf contextValue, an optional provider
 * (defaults to the Connections view), and an optional `getDetail` to add a
 * second line (e.g. a host) that disambiguates same-named items.
 */

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
    type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
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

    /**
     * Optional: produce a second-line `detail` string for a node (e.g. its
     * host:port). Returning `undefined` shows no detail. Used to disambiguate
     * items that share a display name. Only applied to real tree items, not the
     * synthetic Back/empty entries.
     */
    readonly getDetail?: (node: TreeElement) => string | undefined;
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
    getDetail?: (node: TreeElement) => string | undefined,
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
            detail: getDetail?.(child),
            iconPath: toQuickPickIconPath(treeItem),
            data: child,
        });
    }

    const picks: IAzureQuickPickItem<TreeElement | undefined>[] = [];

    // "Back" sits at the top so it's always in the same place while drilling down,
    // followed by a separator that divides it from the level's items.
    if (depth > 0) {
        picks.push({ id: BACK_PICK_ID, label: l10n.t('$(arrow-left) Back'), data: undefined });
        picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator, data: undefined });
    }

    if (itemPicks.length > 0) {
        // Natural tree order (folders before connections) is preserved.
        picks.push(...itemPicks);
    } else if (depth > 0) {
        picks.push({
            id: EMPTY_PICK_ID,
            label: l10n.t('$(info) Empty'),
            detail: l10n.t('No entries'),
            data: undefined,
        });
    } else {
        picks.push({
            id: NO_CONNECTIONS_PICK_ID,
            label: l10n.t('$(info) No connections found'),
            detail: l10n.t('Add a connection in the DocumentDB panel first'),
            data: undefined,
        });
    }

    return picks;
}

/**
 * Browse a tree via a quick pick and return the node the user selects.
 *
 * Presents one quick pick per tree level, drilling from the root through
 * navigable containers until the user picks a node whose `contextValue` matches
 * {@link PickTreeNodeOptions.leafContextValue}. Because it walks the live tree
 * (see the module overview), folder nesting and connect/auth-on-expand behave
 * exactly as they do in the tree view.
 *
 * Behavior:
 *  - **Back** (top of each nested level) steps up one level; **Esc** cancels.
 *  - A busy indicator is shown while a level loads (e.g. a cluster connection).
 *  - Empty levels and an empty root show a non-actionable placeholder rather
 *    than collapsing the quick pick.
 *
 * @returns the selected {@link TreeElement}; `undefined` if the user cancelled,
 *          exited via "Back" past the root, or there was nothing to pick.
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
                    buildLevelPicks(provider, parent, depth, options.leafContextValue, options.getDetail),
                    {
                        placeHolder: options.placeHolder ?? l10n.t('Select an item'),
                        loadingPlaceHolder: l10n.t('Loading…'),
                        suppressPersistence: true,
                        matchOnDescription: true,
                        matchOnDetail: true,
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
