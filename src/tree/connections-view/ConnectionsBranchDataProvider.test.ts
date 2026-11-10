/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClustersClient } from '../../documentdb/ClustersClient';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../documentdb/ClusterItemBase';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { ConnectionsBranchDataProvider } from './ConnectionsBranchDataProvider';

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling }>()),
    callWithTelemetryAndErrorHandling: async (
        _name: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as IActionContext),
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { appendLine: vi.fn(), debug: vi.fn() },
        state: { wrapItemInStateHandling: (item: TreeElement): TreeElement => item },
    },
}));
vi.mock('./DocumentDBClusterItem', () => ({ DocumentDBClusterItem: class {} }));
vi.mock('./LocalEmulators/LocalEmulatorsItem', () => ({ LocalEmulatorsItem: class {} }));
vi.mock('./LocalQuickStart/LocalQuickStartItem', () => ({ LocalQuickStartItem: class {} }));

class FailedClusterItem extends ClusterItemBase {
    constructor() {
        super({
            treeId: 'connectionsView/folder/stable-id',
            clusterId: 'stable-id',
            name: 'Saved connection',
            dbExperience: DocumentDBExperience,
        } as TreeCluster<BaseClusterModel>);
    }

    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        return null;
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return undefined;
    }
}

describe('Connections recovery actions', () => {
    beforeEach((): void => {
        vi.clearAllMocks();
    });

    it.each([undefined, 'entraDestinationRejected'] as const)(
        'adds Update Connection String only for %s and preserves cached action-only children',
        async (reason): Promise<void> => {
            const provider = new ConnectionsBranchDataProvider();
            const item = new FailedClusterItem();
            const originalGetChildren = item.getChildren.bind(item);
            vi.spyOn(item, 'getChildren').mockImplementation(async (): Promise<TreeElement[]> => {
                const children = await originalGetChildren();
                item.lastConnectionFailureReason = reason;
                return children;
            });

            const children = await provider.getChildren(item);
            const treeItems = await Promise.all((children ?? []).map((child) => Promise.resolve(child.getTreeItem())));

            expect(treeItems.map((child) => child.command?.command)).toEqual([
                'vscode-documentdb.command.internal.retry',
                'vscode-documentdb.command.diagnoseConnection',
                'vscode-documentdb.command.shell.open',
                'vscode-documentdb.command.connectionsView.updateCredentials',
                ...(reason ? ['vscode-documentdb.command.connectionsView.updateConnectionString'] : []),
            ]);
            expect(treeItems.every((child) => !!child.command)).toBe(true);
            expect(treeItems.slice(1).every((child) => child.command?.arguments?.[0] === item)).toBe(true);
            expect(await provider.getChildren(item)).toEqual(children);
            expect(item.getChildren).toHaveBeenCalledTimes(1);
        },
    );

    it('does not add saved-connection recovery actions to a non-cluster failure', async (): Promise<void> => {
        const provider = new ConnectionsBranchDataProvider();
        const child: TreeElement = { id: 'database/retry', getTreeItem: (): object => ({ label: 'Retry' }) };
        const item = {
            id: 'database',
            contextValue: 'treeItem_database',
            lastConnectionFailureReason: 'entraDestinationRejected',
            getTreeItem: (): object => ({ label: 'Database', contextValue: 'treeItem_database' }),
            getChildren: async (): Promise<TreeElement[]> => [child],
            hasRetryNode: (): boolean => true,
        };

        expect(await provider.getChildren(item)).toEqual([child]);
    });
});
