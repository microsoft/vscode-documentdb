/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockInitNewSession = jest.fn();
const mockCloseSession = jest.fn();
const mockGetConfiguration = jest.fn();

interface MockCollectionViewControllerInstance {
    readonly revealToForeground: jest.Mock;
    readonly onDisposed: jest.Mock;
    isDisposed: boolean;
    dispose: () => void;
}

const controllerInstances: MockCollectionViewControllerInstance[] = [];

jest.mock('vscode', () => ({
    ViewColumn: {
        One: 1,
        Active: 2,
    },
    workspace: {
        getConfiguration: (...args: unknown[]) => mockGetConfiguration(...args),
    },
}));

jest.mock('../../documentdb/ClusterSession', () => ({
    ClusterSession: {
        initNewSession: (...args: unknown[]) => mockInitNewSession(...args),
        closeSession: (...args: unknown[]) => mockCloseSession(...args),
    },
}));

jest.mock('../../webviews/documentdb/collectionView/collectionViewController', () => ({
    CollectionViewController: class MockCollectionViewController {
        public isDisposed: boolean = false;
        public readonly revealToForeground = jest.fn();
        public readonly onDisposed = jest.fn((callback: () => void) => {
            this.disposeCallback = callback;
        });

        private disposeCallback?: () => void;

        constructor(_props: unknown) {
            controllerInstances.push(this);
        }

        public dispose(): void {
            this.isDisposed = true;
            this.disposeCallback?.();
        }
    },
}));

describe('openCollectionViewInternal', () => {
    beforeEach(() => {
        while (controllerInstances.length > 0) {
            controllerInstances.pop()?.dispose();
        }
        jest.clearAllMocks();

        mockInitNewSession.mockResolvedValue('session-1');
        mockGetConfiguration.mockReturnValue({
            get: jest.fn(() => 'all'),
        });
    });

    it('reuses an existing collection tab for repeated tree opens', async () => {
        const { openCollectionViewInternal } = await import('./openCollectionView');

        const props = {
            clusterId: 'cluster-1',
            clusterDisplayName: 'Cluster 1',
            viewId: 'connectionsView',
            databaseName: 'db1',
            collectionName: 'coll1',
        };

        await openCollectionViewInternal({} as never, props);
        await openCollectionViewInternal({} as never, props);

        expect(mockInitNewSession).toHaveBeenCalledTimes(1);
        expect(controllerInstances).toHaveLength(1);
        expect(controllerInstances[0].revealToForeground).toHaveBeenCalledTimes(2);
    });

    it('creates a new collection tab after the previous one is disposed', async () => {
        const { openCollectionViewInternal } = await import('./openCollectionView');

        const props = {
            clusterId: 'cluster-1',
            clusterDisplayName: 'Cluster 1',
            viewId: 'connectionsView',
            databaseName: 'db1',
            collectionName: 'coll1',
        };

        await openCollectionViewInternal({} as never, props);
        controllerInstances[0].dispose();

        mockInitNewSession.mockResolvedValueOnce('session-2');

        await openCollectionViewInternal({} as never, props);

        expect(mockInitNewSession).toHaveBeenCalledTimes(2);
        expect(mockCloseSession).toHaveBeenCalledWith('session-1');
        expect(controllerInstances).toHaveLength(2);
    });
});
