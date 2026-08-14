/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon, TreeItemCollapsibleState } from 'vscode';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../../services/localQuickStart/quickStartTypes';
import { LocalQuickStartItem } from './LocalQuickStartItem';

// The root node's iconPath initializer calls getResourcesPath() (needs ext.context); stub it so the
// item constructs without a real extension host.
jest.mock('../../../utils/icons', () => ({ getResourcesPath: () => '/resources' }));

describe('LocalQuickStartItem — lazy hydration', () => {
    afterEach(() => jest.restoreAllMocks());

    it('starts collapsed and performs no Docker work while only the root row is rendered', () => {
        const ensureHydrated = jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        const item = new LocalQuickStartItem('connectionsView/root');

        expect(item.getTreeItem().collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
        expect(item.getTreeItem().contextValue).toContain('treeItem_localQuickStart');
        expect(ensureHydrated).not.toHaveBeenCalled();
    });

    it('awaits first hydration without starting a redundant background probe', async () => {
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        const ensureHydrated = jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        const backgroundRefresh = jest
            .spyOn(QuickStartService, 'refreshLiveStateInBackground')
            .mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.NotInstalled,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        });

        await new LocalQuickStartItem('connectionsView/root').getChildren();

        expect(ensureHydrated).toHaveBeenCalledTimes(1);
        expect(backgroundRefresh).not.toHaveBeenCalled();
    });

    it('uses the background live-state probe after initial hydration', async () => {
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(true);
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        const backgroundRefresh = jest
            .spyOn(QuickStartService, 'refreshLiveStateInBackground')
            .mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.NotInstalled,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        });

        await new LocalQuickStartItem('connectionsView/root').getChildren();

        expect(backgroundRefresh).toHaveBeenCalledTimes(1);
    });

    it('still renders the set-up row when hydration fails because Docker is unavailable', async () => {
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        jest.spyOn(QuickStartService, 'ensureHydrated').mockRejectedValue(new Error('Docker unavailable'));
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.NotInstalled,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        });

        const children = await new LocalQuickStartItem('connectionsView/root').getChildren();

        expect(children.map((child) => child.id)).toEqual(['connectionsView/root/localQuickStart/start']);
        await expect(Promise.resolve(children[0].getTreeItem())).resolves.toHaveProperty(
            'label',
            'Set up DocumentDB Local',
        );
    });
});

describe('LocalQuickStartItem — action states', () => {
    afterEach(() => jest.restoreAllMocks());

    it('opens Quick Start to review setup without offering deletion in the tree', async () => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.CredentialsMissing,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        } as QuickStartStatus);

        const item = new LocalQuickStartItem('connectionsView/root');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        const treeItem = await children[0].getTreeItem();
        expect(treeItem.label).toBe('Review setup');
        expect(treeItem.iconPath).toEqual(new ThemeIcon('tools'));
        expect(treeItem.command?.command).toBe('vscode-documentdb.command.localQuickStart.open');
    });

    it('offers recreate and delete actions when the managed container is missing', async () => {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.Stopped,
            metadata: {
                containerId: 'c1',
                alias: 'vscode-documentdb-local',
                boundPort: 10260,
                clusterId: 'quickstart-vscode-documentdb-local',
                connectionString: 'mongodb://u:p@localhost:10260/',
                username: 'u',
            },
            missing: true,
            canResumeReadiness: false,
        });

        const children = await new LocalQuickStartItem('connectionsView/root').getChildren();
        const treeItems = await Promise.all(children.map(async (child) => child.getTreeItem()));

        expect(treeItems.map((item) => item.label)).toEqual(['Recreate container', 'Delete container']);
        expect(treeItems.map((item) => item.iconPath)).toEqual([new ThemeIcon('refresh'), new ThemeIcon('trash')]);
    });
});

describe('LocalQuickStartItem — configured instance description', () => {
    afterEach(() => jest.restoreAllMocks());

    const metadata = {
        containerId: 'c1',
        alias: 'vscode-documentdb-local',
        boundPort: 10260,
        clusterId: 'quickstart-vscode-documentdb-local',
        connectionString: 'mongodb://u:p@localhost:10260/',
        username: 'u',
    };

    async function getInstanceTreeItem(state: InstanceState): Promise<ReturnType<LocalQuickStartItem['getTreeItem']>> {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state,
            metadata,
            missing: false,
            canResumeReadiness: false,
        });

        const [instance] = await new LocalQuickStartItem('connectionsView/root').getChildren();
        return instance.getTreeItem();
    }

    it.each([
        [InstanceState.Running, 'Running'],
        [InstanceState.Stopped, 'Stopped'],
    ])('shows only the %s status and keeps the endpoint in the tooltip', async (state, description) => {
        const treeItem = await getInstanceTreeItem(state);

        expect(treeItem.description).toBe(description);
        expect(treeItem.tooltip).toHaveProperty('value', expect.stringContaining('localhost:10260'));
    });
});

// Review §9.2 Q4 / N3 (I2-4): a genuine failure renders ACTIONABLE recovery nodes, not error text.
// `Missing` / `CredentialsMissing` are service states with their own rows and are deliberately NOT
// treated this way (I2-Q5) — the test above pins that contract.
describe('LocalQuickStartItem — error recovery nodes (I2-4)', () => {
    afterEach(() => jest.restoreAllMocks());

    async function children(
        status: Partial<QuickStartStatus>,
    ): Promise<Awaited<ReturnType<LocalQuickStartItem['getChildren']>>> {
        jest.spyOn(QuickStartService, 'ensureHydrated').mockResolvedValue(undefined);
        jest.spyOn(QuickStartService, 'isHydrated', 'get').mockReturnValue(false);
        jest.spyOn(QuickStartService, 'refreshLiveStateInBackground').mockReturnValue(undefined);
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.Error,
            errorMessage: 'boom',
            missing: false,
            canResumeReadiness: false,
            ...status,
        } as QuickStartStatus);

        const item = new LocalQuickStartItem('connectionsView/root');
        const children = await item.getChildren();
        // The provider caches the failed children only when the element reports a retry node.
        expect(item.hasRetryNode(children)).toBe(true);
        return children;
    }

    it('offers retry, the setup log and Delete Container when a container exists', async () => {
        const items = await children({
            metadata: {
                containerId: 'c1',
                alias: 'vscode-documentdb-local',
                boundPort: 10260,
                clusterId: 'quickstart-vscode-documentdb-local',
                connectionString: 'mongodb://u:p@localhost:10260/',
                username: 'u',
            },
        } as Partial<QuickStartStatus>);

        expect(items.map((item) => item.id)).toEqual([
            'connectionsView/root/localQuickStart/retry',
            'connectionsView/root/localQuickStart/viewLogs',
            'connectionsView/root/localQuickStart/delete',
        ]);
        const treeItems = await Promise.all(items.map(async (item) => item.getTreeItem()));
        expect(treeItems.map((item) => item.label)).toEqual(['Retry setup', 'View setup log', 'Delete container']);
        expect(items[2].getTreeItem()).toHaveProperty('label', 'Delete container');
    });

    it('offers retry and the setup log only when nothing was created, and never a message-only row (N3)', async () => {
        const items = await children({ metadata: undefined });
        const ids = items.map((item) => item.id);

        expect(ids).toEqual([
            'connectionsView/root/localQuickStart/retry',
            'connectionsView/root/localQuickStart/viewLogs',
        ]);
        const treeItems = await Promise.all(items.map(async (item) => item.getTreeItem()));
        expect(treeItems.map((item) => item.label)).toEqual(['Retry setup', 'View setup log']);
        expect(ids).not.toContain('connectionsView/root/localQuickStart/error');
    });
});
