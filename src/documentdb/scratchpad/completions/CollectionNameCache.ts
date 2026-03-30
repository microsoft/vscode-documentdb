/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ClustersClient } from '../../ClustersClient';
import { SchemaStore } from '../../SchemaStore';
import { ScratchpadService } from '../ScratchpadService';

/**
 * Cached entry for collection names.
 */
interface CacheEntry {
    /** Collection names fetched from the server. */
    readonly names: readonly string[];
    /** Timestamp when fetched. */
    readonly fetchedAt: number;
}

/**
 * Caches collection names per `{clusterId, databaseName}` pair.
 *
 * Fetches from `ClustersClient.listCollections()` on the first request,
 * then serves from cache until invalidated by:
 * - Connection change (via `ScratchpadService.onDidChangeState`)
 * - Schema change (via `SchemaStore.onDidChangeSchema` — new collections may appear)
 * - Manual invalidation (e.g., after collection create/drop)
 *
 * Also merges collection names from SchemaStore so that collections
 * discovered through query execution are included even if not returned
 * by `listCollections()` (e.g., freshly created in the scratchpad).
 */
export class CollectionNameCache implements vscode.Disposable {
    private static _instance: CollectionNameCache | undefined;
    private readonly _cache = new Map<string, CacheEntry>();
    private readonly _disposables: vscode.Disposable[] = [];
    private _pendingFetches = new Map<string, Promise<readonly string[]>>();

    private constructor() {
        // Invalidate on connection change and eagerly prefetch for new connection
        this._disposables.push(
            ScratchpadService.getInstance().onDidChangeState(() => {
                this.invalidateAll();

                // Eagerly prefetch collection names for the new connection
                const connection = ScratchpadService.getInstance().getConnection();
                if (connection) {
                    this.getCollectionNames(connection.clusterId, connection.databaseName);
                }
            }),
        );

        // Invalidate on schema change — a new collection may have appeared
        this._disposables.push(
            SchemaStore.getInstance().onDidChangeSchema((event) => {
                const key = this.makeCacheKey(event.clusterId, event.databaseName);
                this._cache.delete(key);
                this._pendingFetches.delete(key);
            }),
        );
    }

    static getInstance(): CollectionNameCache {
        if (!CollectionNameCache._instance) {
            CollectionNameCache._instance = new CollectionNameCache();
        }
        return CollectionNameCache._instance;
    }

    /**
     * Get collection names for the given connection.
     *
     * Returns cached names if available, otherwise triggers an async fetch.
     * The first call for a given `{clusterId, databaseName}` returns an empty
     * array while the fetch is in progress — subsequent completion triggers
     * will pick up the cached result.
     */
    getCollectionNames(clusterId: string, databaseName: string): string[] {
        const key = this.makeCacheKey(clusterId, databaseName);

        // Return cached result if available
        const cached = this._cache.get(key);
        if (cached) {
            return this.mergeWithSchemaStore(cached.names, clusterId, databaseName);
        }

        // Trigger async fetch if not already in progress
        if (!this._pendingFetches.has(key)) {
            this._pendingFetches.set(key, this.fetchCollectionNames(clusterId, databaseName, key));
        }

        // While fetch is in progress, return SchemaStore-only names
        return this.getSchemaStoreCollectionNames(clusterId, databaseName);
    }

    /**
     * Invalidate all cached entries.
     */
    invalidateAll(): void {
        this._cache.clear();
        this._pendingFetches.clear();
    }

    /**
     * Invalidate cache for a specific database.
     */
    invalidate(clusterId: string, databaseName: string): void {
        const key = this.makeCacheKey(clusterId, databaseName);
        this._cache.delete(key);
        this._pendingFetches.delete(key);
    }

    dispose(): void {
        this._cache.clear();
        this._pendingFetches.clear();
        this._disposables.forEach((d) => {
            d.dispose();
        });
        CollectionNameCache._instance = undefined;
    }

    // ───────────────────────────────────────────────────────────────────

    private async fetchCollectionNames(
        clusterId: string,
        databaseName: string,
        key: string,
    ): Promise<readonly string[]> {
        try {
            const client = await ClustersClient.getClient(clusterId);
            const collections = await client.listCollections(databaseName);
            const names = collections.map((c) => c.name).sort();

            this._cache.set(key, { names, fetchedAt: Date.now() });
            return names;
        } catch {
            // Non-critical — completions degrade gracefully to SchemaStore-only
            return [];
        } finally {
            this._pendingFetches.delete(key);
        }
    }

    /**
     * Merge server-fetched collection names with names from SchemaStore.
     * SchemaStore may have collections not returned by listCollections
     * (e.g., freshly created in the scratchpad session).
     */
    private mergeWithSchemaStore(serverNames: readonly string[], clusterId: string, databaseName: string): string[] {
        const schemaNames = this.getSchemaStoreCollectionNames(clusterId, databaseName);
        if (schemaNames.length === 0) {
            return [...serverNames];
        }

        const merged = new Set(serverNames);
        for (const name of schemaNames) {
            merged.add(name);
        }
        return [...merged].sort();
    }

    /**
     * Get collection names known only through SchemaStore
     * (populated by prior query execution).
     */
    private getSchemaStoreCollectionNames(clusterId: string, databaseName: string): string[] {
        const store = SchemaStore.getInstance();
        const stats = store.getStats();
        const prefix = `${clusterId}::${databaseName}::`;
        const names: string[] = [];
        for (const coll of stats.collections) {
            if (coll.key.startsWith(prefix)) {
                const collName = coll.key.substring(prefix.length);
                if (collName) names.push(collName);
            }
        }
        return names.sort();
    }

    private makeCacheKey(clusterId: string, databaseName: string): string {
        return `${clusterId}::${databaseName}`;
    }
}
