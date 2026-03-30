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

import { CollectionNameCache } from '../CollectionNameCache';
import { SchemaStore } from '../../../SchemaStore';
import { ClustersClient } from '../../../ClustersClient';

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
            SchemaStore.getInstance().addDocuments(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
                'users',
                [{ _id: 'doc1' as unknown as import('mongodb').ObjectId, name: 'Alice' }],
            );

            const names = cache.getCollectionNames(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
            );
            expect(names).toContain('users');
        });

        test('returns server-fetched collection names after fetch completes', async () => {
            const mockListCollections = jest.fn().mockResolvedValue([
                { name: 'orders' },
                { name: 'products' },
                { name: 'users' },
            ]);
            (ClustersClient.getClient as jest.Mock).mockResolvedValue({
                listCollections: mockListCollections,
            });

            // First call triggers fetch, returns SchemaStore-only (empty)
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);

            // Wait for async fetch to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Second call returns cached server data
            const names = cache.getCollectionNames(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
            );
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
                [{ _id: 'doc1' as unknown as import('mongodb').ObjectId, x: 1 }],
            );

            const mockListCollections = jest.fn().mockResolvedValue([
                { name: 'orders' },
                { name: 'users' },
            ]);
            (ClustersClient.getClient as jest.Mock).mockResolvedValue({
                listCollections: mockListCollections,
            });

            // Trigger fetch
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
            );
            expect(names).toContain('orders');
            expect(names).toContain('users');
            expect(names).toContain('newCollection');
        });

        test('names are sorted alphabetically', async () => {
            const mockListCollections = jest.fn().mockResolvedValue([
                { name: 'zebra' },
                { name: 'alpha' },
                { name: 'middle' },
            ]);
            (ClustersClient.getClient as jest.Mock).mockResolvedValue({
                listCollections: mockListCollections,
            });

            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
            );
            expect(names).toEqual(['alpha', 'middle', 'zebra']);
        });

        test('invalidateAll clears all cached data', async () => {
            const mockListCollections = jest.fn().mockResolvedValue([{ name: 'orders' }]);
            (ClustersClient.getClient as jest.Mock).mockResolvedValue({
                listCollections: mockListCollections,
            });

            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Verify cache is populated
            let names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toContain('orders');

            // Invalidate
            cache.invalidateAll();

            // Next call should trigger a new fetch (returns empty since no SchemaStore data)
            names = cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            expect(names).toEqual([]);
        });

        test('gracefully handles ClustersClient errors', async () => {
            (ClustersClient.getClient as jest.Mock).mockRejectedValue(new Error('Connection lost'));

            // Should not throw
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            const names = cache.getCollectionNames(
                TEST_CONNECTION.clusterId,
                TEST_CONNECTION.databaseName,
            );
            // Falls back to SchemaStore (empty)
            expect(names).toEqual([]);
        });

        test('does not make duplicate server requests for same key', async () => {
            const mockListCollections = jest.fn().mockResolvedValue([{ name: 'coll1' }]);
            (ClustersClient.getClient as jest.Mock).mockResolvedValue({
                listCollections: mockListCollections,
            });

            // Call twice quickly
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            cache.getCollectionNames(TEST_CONNECTION.clusterId, TEST_CONNECTION.databaseName);
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Should only have fetched once
            expect(ClustersClient.getClient).toHaveBeenCalledTimes(1);
        });
    });
});
