/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type AzureClusterModel, sanitizeAzureResourceIdForTreeId } from './AzureClusterModel';

describe('AzureClusterModel', () => {
    describe('AzureClusterModel interface', () => {
        it('should create a valid Azure cluster model', () => {
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';

            const model: TreeCluster<AzureClusterModel> = {
                // BaseClusterModel properties
                name: 'azure-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: azureResourceId,
                // AzureClusterModel properties
                id: azureResourceId,
                resourceGroup: 'rg1',
                location: 'eastus',
                serverVersion: '6.0',
                // TreeContext properties
                treeId: azureResourceId,
                viewId: Views.AzureResourcesView,
            };

            expect(model.name).toBe('azure-cluster');
            expect(model.id).toBe(azureResourceId);
            expect(model.resourceGroup).toBe('rg1');
            expect(model.location).toBe('eastus');
            expect(model.serverVersion).toBe('6.0');
        });

        it('should include optional Azure metadata', () => {
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';

            const model: TreeCluster<AzureClusterModel> = {
                name: 'full-azure-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: azureResourceId,
                id: azureResourceId,
                resourceGroup: 'rg1',
                location: 'westeurope',
                serverVersion: '7.0',
                systemData: {
                    createdAt: new Date('2024-01-01'),
                },
                sku: 'M30',
                nodeCount: 3,
                diskSize: 128,
                enableHa: true,
                capabilities: 'EnableServerless',
                treeId: azureResourceId,
                viewId: Views.AzureResourcesView,
            };

            expect(model.systemData?.createdAt).toEqual(new Date('2024-01-01'));
            expect(model.sku).toBe('M30');
            expect(model.nodeCount).toBe(3);
            expect(model.diskSize).toBe(128);
            expect(model.enableHa).toBe(true);
            expect(model.capabilities).toBe('EnableServerless');
        });
    });

    describe('sanitizeAzureResourceIdForTreeId', () => {
        it('should replace all forward slashes with hyphens', () => {
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';
            const result = sanitizeAzureResourceIdForTreeId(azureResourceId);

            expect(result).toBe(
                '-subscriptions-sub1-resourceGroups-rg1-providers-Microsoft.DocumentDB-mongoClusters-cluster1',
            );
            expect(result).not.toContain('/');
        });

        it('should handle empty string', () => {
            expect(sanitizeAzureResourceIdForTreeId('')).toBe('');
        });

        it('should handle string without slashes', () => {
            expect(sanitizeAzureResourceIdForTreeId('no-slashes-here')).toBe('no-slashes-here');
        });

        it('should handle single slash', () => {
            expect(sanitizeAzureResourceIdForTreeId('/')).toBe('-');
        });

        it('should handle consecutive slashes', () => {
            expect(sanitizeAzureResourceIdForTreeId('a//b///c')).toBe('a--b---c');
        });
    });

    describe('Discovery View vs Azure Resources View', () => {
        const azureResourceId =
            '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';

        it('should sanitize treeId for Discovery View', () => {
            const discoveryCluster: TreeCluster<AzureClusterModel> = {
                name: 'discovery-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: azureResourceId, // Original Azure Resource ID
                id: azureResourceId,
                treeId: sanitizeAzureResourceIdForTreeId(azureResourceId), // Sanitized
                viewId: Views.DiscoveryView,
            };

            // clusterId keeps original format for cache
            expect(discoveryCluster.clusterId).toBe(azureResourceId);
            expect(discoveryCluster.clusterId).toContain('/');

            // treeId is sanitized for tree structure
            expect(discoveryCluster.treeId).not.toContain('/');
            expect(discoveryCluster.treeId).toBe(
                '-subscriptions-sub1-resourceGroups-rg1-providers-Microsoft.DocumentDB-mongoClusters-cluster1',
            );
        });

        it('should NOT sanitize treeId for Azure Resources View', () => {
            const azureResourcesCluster: TreeCluster<AzureClusterModel> = {
                name: 'azure-resources-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: azureResourceId,
                id: azureResourceId,
                treeId: azureResourceId, // NOT sanitized - flat tree
                viewId: Views.AzureResourcesView,
            };

            // Both should be identical in Azure Resources View
            expect(azureResourcesCluster.clusterId).toBe(azureResourceId);
            expect(azureResourcesCluster.treeId).toBe(azureResourceId);
            expect(azureResourcesCluster.clusterId).toBe(azureResourcesCluster.treeId);
        });
    });
});
