/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { meterSilentCatch } from '../../../utils/callWithAccumulatingTelemetry';
import { ClustersClient } from '../../ClustersClient';
import { SchemaStore } from '../../SchemaStore';
import { PlaygroundService } from '../../playground/PlaygroundService';

/**
 * Provides collection names for query playground completions.
 *
 * Uses a two-tier strategy with NO local (L1) cache:
 *
 * 1. **Synchronous read from ClustersClient** — `getCachedCollections()` returns
 *    data already fetched by the tree view or a prior query playground session. This is
 *    the hot path and never triggers a network call.
 *
 * 2. **One-time async bootstrap** — if ClustersClient has no cached data (user
 *    hasn't expanded the database in the tree yet), a single background
 *    `listCollections()` call populates the cache. Subsequent calls read from
 *    ClustersClient synchronously.
 *
 * Collection names from SchemaStore are always merged in, so collections
 * discovered through query execution appear even if the tree hasn't been
 * refreshed.
 *
 * **Cache refresh strategy:** The tree view's refresh button / expand action
 * calls `listCollections()` on ClustersClient, which overwrites its cache.
 * This class reads that cache synchronously, so it always picks up fresh data
 * after a tree refresh — no separate invalidation needed.
 */
export class CollectionNameCache implements vscode.Disposable {
    private static _instance: CollectionNameCache | undefined;
    private readonly _disposables: vscode.Disposable[] = [];
    private _pendingFetches = new Map<string, Promise<void>>();

    private constructor() {
        // On connection change, trigger a background fetch so that
        // ClustersClient's cache is warm for the active editor's connection.
        this._disposables.push(
            PlaygroundService.getInstance().onDidChangeState(() => {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const connection = PlaygroundService.getInstance().getConnection(activeEditor.document.uri);
                    if (connection) {
                        this.ensureFetched(connection.clusterId, connection.databaseName);
                    }
                }
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
     * Reads synchronously from ClustersClient's cache (populated by tree
     * expansion, refresh, or a prior background fetch). If no cached data
     * exists, triggers a one-time async fetch and returns SchemaStore-only
     * names in the meantime.
     */
    getCollectionNames(clusterId: string, databaseName: string): string[] {
        const clientNames = this.readFromClient(clusterId, databaseName);

        // If ClustersClient has no data yet, trigger a background fetch
        if (clientNames.length === 0) {
            this.ensureFetched(clusterId, databaseName);
        }

        return this.mergeWithSchemaStore(clientNames, clusterId, databaseName);
    }

    /**
     * Invalidate all pending fetches — used on connection change.
     */
    invalidateAll(): void {
        this._pendingFetches.clear();
    }

    /**
     * Invalidate a specific pending fetch.
     */
    invalidate(clusterId: string, databaseName: string): void {
        this._pendingFetches.delete(this.makeCacheKey(clusterId, databaseName));
    }

    dispose(): void {
        this._pendingFetches.clear();
        this._disposables.forEach((d) => {
            d.dispose();
        });
        CollectionNameCache._instance = undefined;
    }

    // ───────────────────────────────────────────────────────────────────

    /**
     * Read collection names from ClustersClient's in-memory cache.
     * Fully synchronous — no network requests.
     */
    private readFromClient(clusterId: string, databaseName: string): string[] {
        const client = ClustersClient.getExistingClient(clusterId);
        if (!client) return [];
        const cached = client.getCachedCollections(databaseName);
        if (!cached) return [];
        return cached.map((c) => c.name).sort();
    }

    /**
     * Ensure ClustersClient's cache has collection data for this database.
     * If a fetch is already pending for this key, this is a no-op.
     * The fetch populates ClustersClient's own cache — subsequent
     * synchronous reads via `readFromClient()` will return the data.
     */
    private ensureFetched(clusterId: string, databaseName: string): void {
        const key = this.makeCacheKey(clusterId, databaseName);
        if (this._pendingFetches.has(key)) return;

        const fetchPromise = (async (): Promise<void> => {
            try {
                const client = await ClustersClient.getClient(clusterId);
                // This call populates ClustersClient._collectionsCache
                await client.listCollections(databaseName);
            } catch (error) {
                meterSilentCatch('CollectionNameCache_listCollections');
                ext.outputChannel?.trace(
                    `[CollectionNameCache] Failed to fetch collections for ${databaseName}: ${error instanceof Error ? error.message : String(error)}`,
                );
            } finally {
                this._pendingFetches.delete(key);
            }
        })();

        this._pendingFetches.set(key, fetchPromise);
    }

    /**
     * Merge ClustersClient names with names from SchemaStore.
     * SchemaStore may have collections not returned by listCollections
     * (e.g., freshly created in the query playground session).
     */
    private mergeWithSchemaStore(clientNames: string[], clusterId: string, databaseName: string): string[] {
        const schemaNames = this.getSchemaStoreCollectionNames(clusterId, databaseName);
        if (schemaNames.length === 0) {
            return clientNames;
        }

        const merged = new Set(clientNames);
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
