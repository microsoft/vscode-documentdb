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
                clusterId: sanitizeAzureResourceIdForTreeId(azureResourceId),
                // AzureClusterModel properties
                id: azureResourceId,
                resourceGroup: 'rg1',
                location: 'eastus',
                serverVersion: '6.0',
                // TreeContext properties
                treeId: sanitizeAzureResourceIdForTreeId(azureResourceId),
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
                clusterId: sanitizeAzureResourceIdForTreeId(azureResourceId),
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
                treeId: sanitizeAzureResourceIdForTreeId(azureResourceId),
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
        it('should replace all forward slashes with underscores', () => {
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';
            const result = sanitizeAzureResourceIdForTreeId(azureResourceId);

            expect(result).toBe(
                '_subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1',
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
            expect(sanitizeAzureResourceIdForTreeId('/')).toBe('_');
        });

        it('should handle consecutive slashes', () => {
            expect(sanitizeAzureResourceIdForTreeId('a//b///c')).toBe('a__b___c');
        });
    });

    describe('Discovery View vs Azure Resources View', () => {
        const azureResourceId =
            '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/cluster1';

        it('should sanitize both clusterId and treeId for Discovery View', () => {
            const sanitizedId = sanitizeAzureResourceIdForTreeId(azureResourceId);
            const discoveryCluster: TreeCluster<AzureClusterModel> = {
                name: 'discovery-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: sanitizedId, // Sanitized - clusterId must NEVER contain '/'
                id: azureResourceId, // Original Azure Resource ID preserved for Azure API calls
                treeId: sanitizedId, // Sanitized for tree structure
                viewId: Views.DiscoveryView,
            };

            // clusterId is sanitized (no '/' characters)
            expect(discoveryCluster.clusterId).toBe(sanitizedId);
            expect(discoveryCluster.clusterId).not.toContain('/');

            // treeId is also sanitized for tree structure
            expect(discoveryCluster.treeId).not.toContain('/');
            expect(discoveryCluster.treeId).toBe(
                '_subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1',
            );

            // Original Azure Resource ID preserved in 'id' for Azure API calls
            expect(discoveryCluster.id).toBe(azureResourceId);
            expect(discoveryCluster.id).toContain('/');
        });

        it('should sanitize both clusterId and treeId for Azure Resources View', () => {
            const sanitizedId = sanitizeAzureResourceIdForTreeId(azureResourceId);
            const azureResourcesCluster: TreeCluster<AzureClusterModel> = {
                name: 'azure-resources-cluster',
                connectionString: undefined,
                dbExperience: DocumentDBExperience,
                clusterId: sanitizedId, // Sanitized - clusterId must NEVER contain '/'
                id: azureResourceId, // Original Azure Resource ID preserved for Azure API calls
                treeId: sanitizedId, // Sanitized for consistency
                viewId: Views.AzureResourcesView,
            };

            // clusterId and treeId are both sanitized and equal
            expect(azureResourcesCluster.clusterId).toBe(sanitizedId);
            expect(azureResourcesCluster.treeId).toBe(sanitizedId);
            expect(azureResourcesCluster.clusterId).toBe(azureResourcesCluster.treeId);
            expect(azureResourcesCluster.clusterId).not.toContain('/');
            expect(azureResourcesCluster.treeId).not.toContain('/');

            // Original Azure Resource ID preserved in 'id' for Azure API calls
            expect(azureResourcesCluster.id).toBe(azureResourceId);
            expect(azureResourcesCluster.id).toContain('/');
        });
    });
});
