/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type ConnectionClusterModel } from './ConnectionClusterModel';

describe('ConnectionClusterModel', () => {
    describe('ConnectionClusterModel interface', () => {
        it('should create a valid connection cluster model', () => {
            const storageId = 'uuid-1234-5678-abcd-efgh';

            const model: TreeCluster<ConnectionClusterModel> = {
                // BaseClusterModel properties
                name: 'my-local-connection',
                connectionString: 'mongodb://localhost:27017/mydb',
                dbExperience: DocumentDBExperience,
                clusterId: storageId, // storageId is used as clusterId
                // ConnectionClusterModel properties
                storageId: storageId,
                // TreeContext properties
                treeId: `connectionsView/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            expect(model.name).toBe('my-local-connection');
            expect(model.connectionString).toBe('mongodb://localhost:27017/mydb');
            expect(model.storageId).toBe(storageId);
            expect(model.clusterId).toBe(storageId); // clusterId === storageId
        });

        it('should include emulator configuration when present', () => {
            const storageId = 'emulator-uuid-1234';

            const model: TreeCluster<ConnectionClusterModel> = {
                name: 'local-emulator',
                connectionString: 'mongodb://localhost:10255/?ssl=true',
                dbExperience: DocumentDBExperience,
                clusterId: storageId,
                storageId: storageId,
                emulatorConfiguration: {
                    isEmulator: true,
                    disableEmulatorSecurity: false,
                },
                treeId: `connectionsView/localEmulators/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            expect(model.emulatorConfiguration).toBeDefined();
            expect(model.emulatorConfiguration?.isEmulator).toBe(true);
            expect(model.emulatorConfiguration?.disableEmulatorSecurity).toBe(false);
        });

        it('should not require emulator configuration for non-emulator connections', () => {
            const storageId = 'cloud-connection-uuid';

            const model: TreeCluster<ConnectionClusterModel> = {
                name: 'cloud-connection',
                connectionString: 'mongodb+srv://cluster.mongodb.net/mydb',
                dbExperience: DocumentDBExperience,
                clusterId: storageId,
                storageId: storageId,
                // No emulatorConfiguration
                treeId: `connectionsView/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            expect(model.emulatorConfiguration).toBeUndefined();
        });
    });

    describe('treeId vs clusterId in Connections View', () => {
        it('should use storageId as clusterId for stable caching', () => {
            const storageId = 'stable-uuid-123';

            const clusterAtRoot: TreeCluster<ConnectionClusterModel> = {
                name: 'connection-at-root',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: storageId,
                storageId: storageId,
                treeId: `connectionsView/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            const clusterInFolder: TreeCluster<ConnectionClusterModel> = {
                name: 'connection-at-root',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: storageId, // Same clusterId
                storageId: storageId,
                treeId: `connectionsView/folder1/${storageId}`, // Different treeId
                viewId: Views.ConnectionsView,
            };

            // clusterId remains stable regardless of folder location
            expect(clusterAtRoot.clusterId).toBe(clusterInFolder.clusterId);

            // treeId changes based on parent path
            expect(clusterAtRoot.treeId).not.toBe(clusterInFolder.treeId);
            expect(clusterAtRoot.treeId).toBe(`connectionsView/${storageId}`);
            expect(clusterInFolder.treeId).toBe(`connectionsView/folder1/${storageId}`);
        });

        it('should maintain cache key consistency when moving between folders', () => {
            const storageId = 'moveable-connection-uuid';

            // Simulate moving a connection from root to a folder
            const cacheKey = storageId; // This is what should be used for caching

            const connectionBeforeMove: TreeCluster<ConnectionClusterModel> = {
                name: 'moveable-connection',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: cacheKey,
                storageId: storageId,
                treeId: `connectionsView/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            const connectionAfterMove: TreeCluster<ConnectionClusterModel> = {
                name: 'moveable-connection',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: cacheKey, // SAME cache key
                storageId: storageId,
                treeId: `connectionsView/work/projects/${storageId}`, // DIFFERENT tree path
                viewId: Views.ConnectionsView,
            };

            // Cache should still work after the move
            const mockCache = new Map<string, string>();
            mockCache.set(connectionBeforeMove.clusterId, 'cached-credentials');

            // After move, we can still retrieve from cache using clusterId
            expect(mockCache.get(connectionAfterMove.clusterId)).toBe('cached-credentials');

            // But if we incorrectly used treeId, it would fail
            expect(mockCache.get(connectionAfterMove.treeId)).toBeUndefined();
        });
    });

    describe('nested folder hierarchy', () => {
        it('should construct correct treeId for deeply nested connections', () => {
            const storageId = 'deep-connection-uuid';
            const folderPath = 'connectionsView/work/projects/team-a/dev';

            const nestedConnection: TreeCluster<ConnectionClusterModel> = {
                name: 'dev-database',
                connectionString: 'mongodb://localhost:27017/dev',
                dbExperience: DocumentDBExperience,
                clusterId: storageId,
                storageId: storageId,
                treeId: `${folderPath}/${storageId}`,
                viewId: Views.ConnectionsView,
            };

            expect(nestedConnection.treeId).toBe('connectionsView/work/projects/team-a/dev/deep-connection-uuid');
            expect(nestedConnection.clusterId).toBe(storageId);
        });

        it('should extract viewId from treeId', () => {
            const storageId = 'test-uuid';
            const treeId = 'connectionsView/folder1/folder2/' + storageId;

            // The pattern used in FolderItem.ts
            const extractedViewId = treeId.split('/')[0];

            expect(extractedViewId).toBe('connectionsView');
        });
    });
});
