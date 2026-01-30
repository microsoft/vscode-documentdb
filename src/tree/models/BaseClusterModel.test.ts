/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { Views } from '../../documentdb/Views';
import { type BaseClusterModel, type ClusterTreeContext, type TreeCluster } from './BaseClusterModel';

describe('BaseClusterModel', () => {
    describe('BaseClusterModel interface', () => {
        it('should create a valid base cluster model', () => {
            const model: BaseClusterModel = {
                name: 'test-cluster',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: 'test-cluster-id-123',
            };

            expect(model.name).toBe('test-cluster');
            expect(model.connectionString).toBe('mongodb://localhost:27017');
            expect(model.dbExperience).toBe(DocumentDBExperience);
            expect(model.clusterId).toBe('test-cluster-id-123');
        });

        it('should allow undefined connectionString for lazy loading', () => {
            const azureResourceId =
                '/subscriptions/xxx/resourceGroups/yyy/providers/Microsoft.DocumentDB/mongoClusters/zzz';
            const sanitizedId = azureResourceId.replace(/\//g, '_');

            const model: BaseClusterModel = {
                name: 'azure-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: sanitizedId,
            };

            expect(model.connectionString).toBeUndefined();
            expect(model.clusterId).toBe(sanitizedId);
            expect(model.clusterId).not.toContain('/');
        });
    });

    describe('ClusterTreeContext interface', () => {
        it('should create a valid tree context', () => {
            const context: ClusterTreeContext = {
                treeId: 'connectionsView/folder1/cluster1',
                viewId: Views.ConnectionsView,
            };

            expect(context.treeId).toBe('connectionsView/folder1/cluster1');
            expect(context.viewId).toBe(Views.ConnectionsView);
        });
    });

    describe('TreeCluster combined type', () => {
        it('should combine BaseClusterModel and ClusterTreeContext', () => {
            const treeCluster: TreeCluster = {
                // BaseClusterModel properties
                name: 'combined-cluster',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: 'stable-id-123',
                // ClusterTreeContext properties
                treeId: 'connectionsView/stable-id-123',
                viewId: Views.ConnectionsView,
            };

            // BaseClusterModel properties
            expect(treeCluster.name).toBe('combined-cluster');
            expect(treeCluster.clusterId).toBe('stable-id-123');

            // ClusterTreeContext properties
            expect(treeCluster.treeId).toBe('connectionsView/stable-id-123');
            expect(treeCluster.viewId).toBe(Views.ConnectionsView);
        });
    });

    describe('ID separation (treeId vs clusterId)', () => {
        it('should maintain separate treeId and clusterId for Connections View', () => {
            // In Connections View, clusterId is the storageId (stable UUID)
            // and treeId includes the parent path
            const storageId = 'uuid-1234-5678-abcd';
            const parentPath = 'connectionsView/folder1';

            const cluster: TreeCluster = {
                name: 'my-connection',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: storageId, // Stable for cache
                treeId: `${parentPath}/${storageId}`, // Includes parent path
                viewId: Views.ConnectionsView,
            };

            expect(cluster.clusterId).toBe(storageId);
            expect(cluster.treeId).toBe('connectionsView/folder1/uuid-1234-5678-abcd');
            expect(cluster.treeId).not.toBe(cluster.clusterId);
        });

        it('should have clusterId === treeId for Discovery View (both sanitized)', () => {
            // In Discovery View, both clusterId and treeId are sanitized
            // The original Azure Resource ID is stored in AzureClusterModel.id
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';
            const sanitizedId = azureResourceId.replace(/\//g, '_');

            const cluster: TreeCluster = {
                name: 'azure-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: sanitizedId, // Sanitized for cache
                treeId: sanitizedId, // Sanitized for tree (same as clusterId)
                viewId: Views.DiscoveryView,
            };

            expect(cluster.clusterId).toBe(sanitizedId);
            expect(cluster.treeId).toBe(sanitizedId);
            expect(cluster.clusterId).toBe(cluster.treeId);
            expect(cluster.treeId).not.toContain('/');
            expect(cluster.clusterId).not.toContain('/');
        });

        it('should have clusterId === treeId for Azure Resources View (both sanitized)', () => {
            // In Azure Resources View, both clusterId and treeId are sanitized
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';
            const sanitizedId = azureResourceId.replace(/\//g, '_');

            const cluster: TreeCluster = {
                name: 'azure-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: sanitizedId, // Sanitized for cache
                treeId: sanitizedId, // Same as clusterId
                viewId: Views.AzureResourcesView,
            };

            expect(cluster.clusterId).toBe(cluster.treeId);
            expect(cluster.clusterId).not.toContain('/');
        });
    });

    describe('cache key usage pattern', () => {
        it('should always use clusterId for cache operations', () => {
            // This test documents the expected pattern for cache key usage
            const cluster: TreeCluster = {
                name: 'test-cluster',
                connectionString: 'mongodb://localhost:27017',
                dbExperience: DocumentDBExperience,
                clusterId: 'stable-cache-key',
                treeId: 'connectionsView/folder/stable-cache-key',
                viewId: Views.ConnectionsView,
            };

            // Simulating cache operations
            const cache = new Map<string, string>();

            // Store using clusterId (correct)
            cache.set(cluster.clusterId, 'credentials');

            // Retrieve using clusterId (correct)
            expect(cache.get(cluster.clusterId)).toBe('credentials');

            // Using treeId would fail (incorrect pattern)
            expect(cache.get(cluster.treeId)).toBeUndefined();
        });
    });
});
