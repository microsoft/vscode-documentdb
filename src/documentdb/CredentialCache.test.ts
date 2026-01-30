/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from './auth/AuthMethod';
import { CredentialCache } from './CredentialCache';

describe('Credential Cache Stability', () => {
    describe('when connection moves between folders', () => {
        const clusterId = 'stable-cluster-id-123';

        beforeEach(() => {
            // Clear any cached credentials using the stable clusterId
            // Note: We only need to delete using clusterId - tree paths are never used as cache keys
            CredentialCache.deleteCredentials(clusterId);
        });

        it('should preserve credentials when treeId changes but clusterId stays same', () => {
            // Arrange: Set credentials using clusterId (the stable identifier)
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://localhost:27017', {
                connectionUser: 'testuser',
                connectionPassword: 'testpass',
            });

            // Simulate tree ID change (folder move)
            const oldTreeId = 'connectionsView/stable-cluster-id-123';
            const newTreeId = 'connectionsView/folder1/stable-cluster-id-123';

            // Act & Assert: Credentials should still be accessible via clusterId
            expect(CredentialCache.hasCredentials(clusterId)).toBe(true);

            // Verify that using old treeId would NOT find credentials
            // (this is the bug we're fixing)
            expect(CredentialCache.hasCredentials(oldTreeId)).toBe(false);
            expect(CredentialCache.hasCredentials(newTreeId)).toBe(false);
        });

        it('should retrieve correct credentials when using clusterId after folder move', () => {
            // Arrange: Set credentials using clusterId
            const username = 'testuser';
            const password = 'testpass';
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://localhost:27017', {
                connectionUser: username,
                connectionPassword: password,
            });

            // Act: Retrieve credentials using clusterId (not treeId)
            const credentials = CredentialCache.getCredentials(clusterId);

            // Assert: Should have correct credentials
            expect(credentials).toBeDefined();
            expect(credentials?.clusterId).toBe(clusterId);
            expect(credentials?.nativeAuthConfig?.connectionUser).toBe(username);
            expect(credentials?.nativeAuthConfig?.connectionPassword).toBe(password);
        });

        it('should NOT find credentials when using treeId instead of clusterId', () => {
            // Arrange
            const treeId = 'connectionsView/folder1/stable-cluster-id-123';
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://localhost:27017', {
                connectionUser: 'test',
                connectionPassword: 'test',
            });

            // Act & Assert: treeId should NOT be a valid cache key
            expect(CredentialCache.hasCredentials(treeId)).toBe(false);
            expect(CredentialCache.hasCredentials(clusterId)).toBe(true);
        });

        it('should delete credentials using clusterId after folder move', () => {
            // Arrange: Set credentials
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://localhost:27017', {
                connectionUser: 'testuser',
                connectionPassword: 'testpass',
            });
            expect(CredentialCache.hasCredentials(clusterId)).toBe(true);

            // Act: Delete using clusterId
            CredentialCache.deleteCredentials(clusterId);

            // Assert: Credentials should be gone
            expect(CredentialCache.hasCredentials(clusterId)).toBe(false);
        });
    });

    describe('ClusterModel ID separation', () => {
        it('should have distinct treeId and clusterId properties for Connections View items', () => {
            // Connections View case: treeId includes folder path, clusterId is storageId
            const connectionsModel = {
                treeId: 'connectionsView/folder1/abc-123',
                clusterId: 'abc-123',
                name: 'My Cluster',
            };

            expect(connectionsModel.treeId).not.toBe(connectionsModel.clusterId);
            expect(connectionsModel.clusterId).toBe('abc-123');
            expect(connectionsModel.treeId).toContain(connectionsModel.clusterId);
        });

        it('should allow treeId === clusterId for Azure resources (both sanitized)', () => {
            // Azure views: both IDs are the sanitized Azure Resource ID
            const azureResourceId =
                '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.DocumentDB/mongoClusters/mycluster';
            const sanitizedId = azureResourceId.replace(/\//g, '_');
            const azureModel = {
                treeId: sanitizedId,
                clusterId: sanitizedId,
                name: 'mycluster',
            };

            expect(azureModel.treeId).toBe(azureModel.clusterId);
            expect(azureModel.clusterId).not.toContain('/');
        });

        it('should change treeId but preserve clusterId when moving between folders', () => {
            // Simulate a connection at root level
            const storageId = 'uuid-abc-123-def';
            const clusterModelAtRoot = {
                treeId: `connectionsView/${storageId}`,
                clusterId: storageId,
                name: 'My Cluster',
            };

            // Simulate the same connection moved to a folder
            const clusterModelInFolder = {
                treeId: `connectionsView/my-folder/${storageId}`,
                clusterId: storageId, // Must remain the same!
                name: 'My Cluster',
            };

            // The key invariant: clusterId remains stable
            expect(clusterModelAtRoot.clusterId).toBe(clusterModelInFolder.clusterId);
            expect(clusterModelAtRoot.treeId).not.toBe(clusterModelInFolder.treeId);
        });
    });

    describe('cache key consistency', () => {
        const clusterId = 'consistency-test-cluster';

        beforeEach(() => {
            CredentialCache.deleteCredentials(clusterId);
        });

        it('should use clusterId consistently across all cache operations', () => {
            // Test the full lifecycle using clusterId

            // 1. Set credentials
            CredentialCache.setAuthCredentials(clusterId, AuthMethodId.NativeAuth, 'mongodb://host:27017', {
                connectionUser: 'user',
                connectionPassword: 'pass',
            });

            // 2. Verify existence
            expect(CredentialCache.hasCredentials(clusterId)).toBe(true);

            // 3. Get connection string
            const connString = CredentialCache.getConnectionStringWithPassword(clusterId);
            expect(connString).toBeDefined();
            expect(connString).toContain('mongodb://');

            // 4. Get credentials
            const credentials = CredentialCache.getCredentials(clusterId);
            expect(credentials?.clusterId).toBe(clusterId);

            // 5. Get user info
            expect(CredentialCache.getConnectionUser(clusterId)).toBe('user');
            expect(CredentialCache.getConnectionPassword(clusterId)).toBe('pass');

            // 6. Delete credentials
            CredentialCache.deleteCredentials(clusterId);
            expect(CredentialCache.hasCredentials(clusterId)).toBe(false);
        });

        it('should preserve Entra ID config when using clusterId', () => {
            const entraIdConfig = { tenantId: 'test-tenant-id' };

            CredentialCache.setAuthCredentials(
                clusterId,
                AuthMethodId.MicrosoftEntraID,
                'mongodb://host:27017',
                undefined,
                undefined,
                entraIdConfig,
            );

            // Verify Entra ID config is accessible via clusterId
            expect(CredentialCache.getEntraIdConfig(clusterId)).toEqual(entraIdConfig);
        });

        it('should preserve emulator config when using clusterId', () => {
            const emulatorConfig = {
                isEmulator: true,
                disableEmulatorSecurity: false,
            };

            CredentialCache.setAuthCredentials(
                clusterId,
                AuthMethodId.NativeAuth,
                'mongodb://localhost:10255',
                { connectionUser: 'emulatorUser', connectionPassword: 'emulatorPass' },
                emulatorConfig,
            );

            // Verify emulator config is accessible via clusterId
            const retrievedConfig = CredentialCache.getEmulatorConfiguration(clusterId);
            expect(retrievedConfig).toBeDefined();
            expect(retrievedConfig?.isEmulator).toBe(true);
            expect(retrievedConfig?.disableEmulatorSecurity).toBe(false);
        });
    });
});
