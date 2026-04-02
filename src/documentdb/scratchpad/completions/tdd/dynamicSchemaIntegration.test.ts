/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — Dynamic Schema Integration (WI-3)
 *
 * These tests define the expected behavior CONTRACT for dynamic data
 * integration in the scratchpad completion system:
 * - Collection name discovery via ClustersClient (Phase 3.1)
 * - Schema-driven field completions from SchemaStore (Phase 3.2)
 * - "Scan Schema…" action completion fallback (Phase 3.3)
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 */

// ClustersClient is mocked at module level — its deep dependencies
// (MongoClient, @microsoft/vscode-azext-utils) are not needed for cache tests.
jest.mock('../../../ClustersClient');

import { ClustersClient } from '../../../ClustersClient';
import { SchemaStore } from '../../../SchemaStore';
import { CollectionNameCache } from '../CollectionNameCache';

// =====================================================================
// Helpers
// =====================================================================

const TEST_CONNECTION = {
    clusterId: 'test-cluster-id',
    clusterDisplayName: 'TestCluster',
    databaseName: 'testdb',
};

// =====================================================================
// Tests: CollectionNameCache
// =====================================================================

describe('TDD: CollectionNameCache', () => {
    let cache: CollectionNameCache;

    beforeEach(() => {
        // Reset singleton for isolation
        CollectionNameCache.getInstance().dispose();
        cache = CollectionNameCache.getInstance();
        SchemaStore.getInstance().reset();
        jest.clearAllMocks();
    });

    afterAll(() => {
        cache.dispose();
        SchemaStore.getInstance().reset();
    });

    /**
     * Helper: set up ClustersClient mocks so that:
     * - getClient() returns a client with listCollections() (async path)
     * - getExistingClient() returns a client with getCachedCollections() (sync path)
     *
     * After the async fetch completes, getCachedCollections() returns the
     * same data that listCollections() resolved with — mimicking how
     * ClustersClient._collectionsCache works in production.
     */
    function mockClustersClient(collections: Array<{ name: string }>): {
        listCollections: jest.Mock;
        getCachedCollections: jest.Mock;
    } {
        const mockListCollections = jest.fn().mockResolvedValue(collections);
        const mockGetCachedCollections = jest.fn().mockReturnValue(undefined);

        (ClustersClient.getClient as jest.Mock).mockResolvedValue({
            listCollections: async (...args: unknown[]): Promise<Array<{ name: string }>> => {
                const result = (await mockListCollections(...args)) as Array<{ name: string }>;
                // After listCollections populates the real cache, getCachedCollections
                // returns the same data on subsequent sync reads.
                mockGetCachedCollections.mockReturnValue(result);
                return result;
            },
        });
        (ClustersClient.getExistingClient as jest.Mock).mockReturnValue({
            getCachedCollections: mockGetCachedCollections,
        });

        return { listCollections: mockListCollections, getCachedCollections: mockGetCachedCollections };
    }

    // -----------------------------------------------------------------
    // Phase 3.1: Collection name discovery
    // -----------------------------------------------------------------
    describe('Phase 3.1: Collection name discovery from ClustersClient', () => {
        test('returns empty array when no connection and no SchemaStore data', () => {
            const names = cache.getCollectionNames('unknown-cluster', 'unknowndb');
            expect(names).toEqual([]);
        });

        test('returns SchemaStore collection names while server fetch is pending', () => {
            // Populate SchemaStore with a collection
            SchemaStore.getInstance().addDocuments(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName, 'users', [
                { _id: 'doc1' as never, name: 'Alice' },
            ]);

            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toContain('users');
        });

        test('returns server-fetched collection names after fetch completes', async () => {
            mockClustersClient([{ name: 'orders' }, { name: 'products' }, { name: 'users' }]);

            // First call triggers fetch, returns SchemaStore-only (empty)
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);

            // Wait for async fetch to complete (populates ClustersClient cache)
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Second call reads from ClustersClient's cache synchronously
            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toContain('orders');
            expect(names).toContain('products');
            expect(names).toContain('users');
        });

        test('merges server names with SchemaStore names', async () => {
            // SchemaStore has a collection the server may not know about
            SchemaStore.getInstance().addDocuments(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
                'newCollection',
                [{ _id: 'doc1' as never, x: 1 }],
            );

            mockClustersClient([{ name: 'orders' }, { name: 'users' }]);

            // Trigger fetch
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toContain('orders');
            expect(names).toContain('users');
            expect(names).toContain('newCollection');
        });

        test('names are sorted alphabetically', async () => {
            mockClustersClient([{ name: 'zebra' }, { name: 'alpha' }, { name: 'middle' }]);

            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toEqual(['alpha', 'middle', 'zebra']);
        });

        test('reads from ClustersClient cache without triggering network calls when data is warm', () => {
            // Simulate ClustersClient already having cached data (from tree expansion)
            (ClustersClient.getExistingClient as jest.Mock).mockReturnValue({
                getCachedCollections: jest.fn().mockReturnValue([{ name: 'orders' }, { name: 'users' }]),
            });

            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toContain('orders');
            expect(names).toContain('users');

            // No async fetch should have been triggered
            expect(ClustersClient.getClient).not.toHaveBeenCalled();
        });

        test('gracefully handles ClustersClient errors', async () => {
            // Ensure no cached data is available
            (ClustersClient.getExistingClient as jest.Mock).mockReturnValue(undefined);
            (ClustersClient.getClient as jest.Mock).mockRejectedValue(new Error('Connection lost'));

            // Should not throw
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            // Falls back to SchemaStore (empty)
            expect(names).toEqual([]);
        });

        test('does not make duplicate server requests for same key', async () => {
            const { listCollections } = mockClustersClient([{ name: 'coll1' }]);

            // Call twice quickly
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Should only have fetched once
            expect(listCollections).toHaveBeenCalledTimes(1);
        });
    });
});
