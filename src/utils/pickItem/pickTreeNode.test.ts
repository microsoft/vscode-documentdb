/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from '../../tree/TreeElement';
import { pickTreeNode, type TreeChildrenProvider } from './pickTreeNode';

// ── Mocks ────────────────────────────────────────────────────────────────────

const showQuickPickMock = jest.fn();

jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class extends Error {},
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_id: string, callback: (context: unknown) => unknown): Promise<unknown> => {
            const context = {
                errorHandling: {},
                telemetry: { properties: {} as Record<string, unknown>, measurements: {} as Record<string, number> },
                ui: { showQuickPick: showQuickPickMock },
            };
            return callback(context);
        },
    ),
}));

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? '')),
}));

const showInformationMessageMock = jest.fn();
const showWarningMessageMock = jest.fn();
jest.mock('vscode', () => ({
    window: {
        showInformationMessage: (...args: unknown[]) => showInformationMessageMock(...args),
        showWarningMessage: (...args: unknown[]) => showWarningMessageMock(...args),
    },
}));

jest.mock('../../extensionVariables', () => ({ ext: {} }));

// Make `instanceof UserCancelledError` work with the error our tests throw.
import { UserCancelledError } from '@microsoft/vscode-azext-utils';

// ── Test tree helpers ────────────────────────────────────────────────────────

interface FakeNodeOptions {
    id: string;
    label: string;
    contextValue: string;
    children?: TreeElement[];
}

function makeNode(opts: FakeNodeOptions): TreeElement {
    const node: TreeElement = {
        id: opts.id,
        getTreeItem: () => ({ label: opts.label, contextValue: opts.contextValue }),
    };
    if (opts.children) {
        (node as TreeElement & { getChildren: () => TreeElement[] }).getChildren = () => opts.children!;
    }
    return node;
}

function providerFor(rootChildren: TreeElement[]): TreeChildrenProvider {
    return {
        getChildren: (element?: TreeElement) => {
            if (!element) {
                return rootChildren;
            }
            const withChildren = element as TreeElement & { getChildren?: () => TreeElement[] };
            return withChildren.getChildren ? withChildren.getChildren() : [];
        },
    };
}

/** Programs showQuickPick to pick, in order, the item whose label contains each substring. */
function queuePicks(...labelSubstrings: string[]): void {
    let call = 0;
    showQuickPickMock.mockImplementation((picks: { label: string }[]) => {
        const wanted = labelSubstrings[call++];
        const found = picks.find((p) => p.label.includes(wanted));
        if (!found) {
            throw new Error(`No pick matching "${wanted}" among [${picks.map((p) => p.label).join(', ')}]`);
        }
        return Promise.resolve(found);
    });
}

const DATABASE_CV = 'treeItem_database;experience_MongoDB';
const CLUSTER_CV = 'treeItem_documentdbcluster;experience_MongoDB';

describe('pickTreeNode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('drills folder → cluster → database and returns the database node', async () => {
        const dbX = makeNode({ id: 'dbX', label: 'orders', contextValue: DATABASE_CV });
        const dbY = makeNode({ id: 'dbY', label: 'products', contextValue: DATABASE_CV });
        const cluster = makeNode({ id: 'c1', label: 'Cluster A', contextValue: CLUSTER_CV, children: [dbX, dbY] });
        const folder = makeNode({ id: 'f1', label: 'My Folder', contextValue: 'treeItem_folder', children: [cluster] });
        const newConn = makeNode({ id: 'nc', label: 'New Connection…', contextValue: 'treeItem_newConnection' });

        queuePicks('My Folder', 'Cluster A', 'products');

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([folder, cluster, newConn]),
            telemetrySource: 'test',
        });

        expect(result).toBe(dbY);
    });

    it('returns a database picked directly under a top-level cluster', async () => {
        const dbX = makeNode({ id: 'dbX', label: 'orders', contextValue: DATABASE_CV });
        const cluster = makeNode({ id: 'c1', label: 'Cluster A', contextValue: CLUSTER_CV, children: [dbX] });

        queuePicks('Cluster A', 'orders');

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([cluster]),
            telemetrySource: 'test',
        });

        expect(result).toBe(dbX);
    });

    it('excludes action and placeholder nodes from the picks', async () => {
        const dbX = makeNode({ id: 'dbX', label: 'orders', contextValue: DATABASE_CV });
        const cluster = makeNode({ id: 'c1', label: 'Cluster A', contextValue: CLUSTER_CV, children: [dbX] });
        const newConn = makeNode({ id: 'nc', label: 'New Connection…', contextValue: 'treeItem_newConnection' });

        queuePicks('Cluster A', 'orders');

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([cluster, newConn]),
            telemetrySource: 'test',
        });

        expect(result).toBe(dbX);
        // The root-level pick list must not include the "New Connection" action node.
        const rootPicks = showQuickPickMock.mock.calls[0][0] as { label: string }[];
        expect(rootPicks.some((p) => p.label.includes('New Connection'))).toBe(false);
    });

    it('steps back automatically out of an empty level', async () => {
        const dbX = makeNode({ id: 'dbX', label: 'orders', contextValue: DATABASE_CV });
        const emptyCluster = makeNode({ id: 'c1', label: 'Empty Cluster', contextValue: CLUSTER_CV, children: [] });
        const goodCluster = makeNode({ id: 'c2', label: 'Good Cluster', contextValue: CLUSTER_CV, children: [dbX] });

        // Enter the empty cluster (auto-back to root), then enter the good one and pick its db.
        queuePicks('Empty Cluster', 'Good Cluster', 'orders');

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([emptyCluster, goodCluster]),
            telemetrySource: 'test',
        });

        expect(result).toBe(dbX);
        expect(showWarningMessageMock).toHaveBeenCalled();
    });

    it('supports going back up a level via the Back entry', async () => {
        const dbA = makeNode({ id: 'dbA', label: 'alpha', contextValue: DATABASE_CV });
        const dbB = makeNode({ id: 'dbB', label: 'beta', contextValue: DATABASE_CV });
        const clusterA = makeNode({ id: 'c1', label: 'Cluster A', contextValue: CLUSTER_CV, children: [dbA] });
        const clusterB = makeNode({ id: 'c2', label: 'Cluster B', contextValue: CLUSTER_CV, children: [dbB] });

        // Enter Cluster A, hit Back to return to root, enter Cluster B, pick its database.
        queuePicks('Cluster A', 'Back', 'Cluster B', 'beta');

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([clusterA, clusterB]),
            telemetrySource: 'test',
        });

        expect(result).toBe(dbB);
    });

    it('returns undefined and informs the user when there are no connections', async () => {
        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([]),
            telemetrySource: 'test',
        });

        expect(result).toBeUndefined();
        expect(showInformationMessageMock).toHaveBeenCalled();
        expect(showQuickPickMock).not.toHaveBeenCalled();
    });

    it('returns undefined when the user cancels', async () => {
        const cluster = makeNode({ id: 'c1', label: 'Cluster A', contextValue: CLUSTER_CV, children: [] });
        showQuickPickMock.mockRejectedValue(new UserCancelledError());

        const result = await pickTreeNode({
            leafContextValue: 'treeItem_database',
            provider: providerFor([cluster]),
            telemetrySource: 'test',
        });

        expect(result).toBeUndefined();
    });
});
