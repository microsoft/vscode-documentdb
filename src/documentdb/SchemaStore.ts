/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SchemaAnalyzer,
    getPropertyNamesAtLevel,
    type FieldEntry,
    type JSONSchema,
} from '@documentdb-js/schema-analyzer';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';

import { type Document, type WithId } from 'mongodb';
import { ext } from '../extensionVariables';

export interface SchemaChangeEvent {
    readonly clusterId: string;
    readonly databaseName: string;
    readonly collectionName: string;
}

export interface SchemaStoreStats {
    /** Number of collections with cached schema. */
    readonly collectionCount: number;
    /** Total documents analyzed across all collections. */
    readonly totalDocuments: number;
    /** Total known fields across all collections. */
    readonly totalFields: number;
    /** Per-collection breakdown. */
    readonly collections: ReadonlyArray<{
        readonly key: string;
        readonly documentCount: number;
        readonly fieldCount: number;
    }>;
}

/**
 * Shared, cluster-scoped schema cache.
 *
 * Accumulates schema data per `{clusterId, databaseName, collectionName}` triple,
 * enabling cross-tab and query playground schema sharing. All schema consumers
 * (Collection View tabs, query playground, future shell) read from and contribute
 * to the same store.
 *
 * Schema change notifications are debounced per key (1 second) to avoid
 * excessive churn when pages are navigated rapidly.
 */
export class SchemaStore implements vscode.Disposable {
    private static _instance: SchemaStore | undefined;
    private readonly _analyzers = new Map<string, SchemaAnalyzer>();
    private readonly _onDidChangeSchema = new vscode.EventEmitter<SchemaChangeEvent>();
    private readonly _pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>();

    /** High-water marks for telemetry — tracks peak usage across the session. */
    private _maxCollectionCount = 0;
    private _maxTotalDocuments = 0;
    private _maxTotalFields = 0;
    private _statsChanged = false;
    private _addDocumentsCalls = 0;

    /** Fires when schema data changes for any collection (debounced, 1 second). */
    public readonly onDidChangeSchema: vscode.Event<SchemaChangeEvent> = this._onDidChangeSchema.event;

    /** Get the singleton instance. */
    public static getInstance(): SchemaStore {
        if (!SchemaStore._instance) {
            SchemaStore._instance = new SchemaStore();
        }
        return SchemaStore._instance;
    }

    // ── Key construction ──

    private static key(clusterId: string, db: string, coll: string): string {
        return `${clusterId}::${db}::${coll}`;
    }

    // ── Read operations ──

    /** Check if schema data exists for a collection. */
    public hasSchema(clusterId: string, db: string, coll: string): boolean {
        const analyzer = this._analyzers.get(SchemaStore.key(clusterId, db, coll));
        return analyzer !== undefined && analyzer.getDocumentCount() > 0;
    }

    /** Get known fields for a collection (empty array if no schema). */
    public getKnownFields(clusterId: string, db: string, coll: string): FieldEntry[] {
        const analyzer = this._analyzers.get(SchemaStore.key(clusterId, db, coll));
        return analyzer?.getKnownFields() ?? [];
    }

    /** Get the raw JSON Schema for a collection (empty schema if none). */
    public getSchema(clusterId: string, db: string, coll: string): JSONSchema {
        const analyzer = this._analyzers.get(SchemaStore.key(clusterId, db, coll));
        return analyzer?.getSchema() ?? { type: 'object' };
    }

    /** Get schema document count for a collection. */
    public getDocumentCount(clusterId: string, db: string, coll: string): number {
        return this._analyzers.get(SchemaStore.key(clusterId, db, coll))?.getDocumentCount() ?? 0;
    }

    /** Get property names at a given schema path (for table headers). */
    public getPropertyNamesAtLevel(clusterId: string, db: string, coll: string, path: string[]): string[] {
        const schema = this.getSchema(clusterId, db, coll);
        return getPropertyNamesAtLevel(schema, path);
    }

    // ── Stats & telemetry ──

    /** Get a snapshot of current schema store statistics. */
    public getStats(): SchemaStoreStats {
        let totalDocuments = 0;
        let totalFields = 0;
        const collections: Array<{ key: string; documentCount: number; fieldCount: number }> = [];

        for (const [key, analyzer] of this._analyzers) {
            const docCount = analyzer.getDocumentCount();
            const fieldCount = analyzer.getKnownFields().length;
            totalDocuments += docCount;
            totalFields += fieldCount;
            collections.push({ key, documentCount: docCount, fieldCount });
        }

        return {
            collectionCount: this._analyzers.size,
            totalDocuments,
            totalFields,
            collections,
        };
    }

    /** Log current stats to the output channel. */
    public logStats(): void {
        const stats = this.getStats();
        ext.outputChannel?.appendLog(
            `[SchemaStore] ${String(stats.collectionCount)} collections cached, ` +
                `${String(stats.totalDocuments)} documents analyzed, ` +
                `${String(stats.totalFields)} fields discovered`,
        );
        for (const c of stats.collections) {
            ext.outputChannel?.trace(
                `[SchemaStore]   ${c.key}: ${String(c.documentCount)} docs, ${String(c.fieldCount)} fields`,
            );
        }
    }

    /** Report peak usage to telemetry (called on dispose or periodically). */
    private _reportTelemetry(): void {
        if (!this._statsChanged) {
            return;
        }
        this._statsChanged = false;

        void callWithTelemetryAndErrorHandling('schemaStore.stats', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.errorHandling.rethrow = false;
            ctx.telemetry.measurements.maxCollectionCount = this._maxCollectionCount;
            ctx.telemetry.measurements.maxTotalDocuments = this._maxTotalDocuments;
            ctx.telemetry.measurements.maxTotalFields = this._maxTotalFields;

            // Current snapshot
            const stats = this.getStats();
            ctx.telemetry.measurements.currentCollectionCount = stats.collectionCount;
            ctx.telemetry.measurements.currentTotalDocuments = stats.totalDocuments;
            ctx.telemetry.measurements.currentTotalFields = stats.totalFields;

            // Distinct cluster count
            const clusterIds = new Set<string>();
            for (const key of this._analyzers.keys()) {
                const clusterId = key.split('::')[0];
                if (clusterId) {
                    clusterIds.add(clusterId);
                }
            }
            ctx.telemetry.measurements.distinctClusterCount = clusterIds.size;
        });
    }

    /** Update high-water marks after schema changes. */
    private _updateMaxStats(): void {
        const stats = this.getStats();
        if (
            stats.collectionCount > this._maxCollectionCount ||
            stats.totalDocuments > this._maxTotalDocuments ||
            stats.totalFields > this._maxTotalFields
        ) {
            this._maxCollectionCount = Math.max(this._maxCollectionCount, stats.collectionCount);
            this._maxTotalDocuments = Math.max(this._maxTotalDocuments, stats.totalDocuments);
            this._maxTotalFields = Math.max(this._maxTotalFields, stats.totalFields);
            this._statsChanged = true;
        }
    }

    // ── Write operations ──

    /** Feed documents to the schema store (from any source). */
    public addDocuments(clusterId: string, db: string, coll: string, documents: ReadonlyArray<WithId<Document>>): void {
        if (documents.length === 0) return;

        const key = SchemaStore.key(clusterId, db, coll);
        let analyzer = this._analyzers.get(key);
        if (!analyzer) {
            analyzer = new SchemaAnalyzer();
            this._analyzers.set(key, analyzer);
        }

        analyzer.addDocuments(documents);
        this._updateMaxStats();
        this._fireSchemaChanged(key, { clusterId, databaseName: db, collectionName: coll });

        // Report telemetry periodically: every call for the first 10, then every 5th
        this._addDocumentsCalls++;
        if (this._addDocumentsCalls <= 10 || this._addDocumentsCalls % 5 === 0) {
            this._reportTelemetry();
        }
    }

    // ── Lifecycle ──

    /** Clear schema for a specific collection (e.g., after collection drop). Fires immediately (not debounced). */
    public clearSchema(clusterId: string, db: string, coll: string): void {
        const key = SchemaStore.key(clusterId, db, coll);
        if (this._analyzers.delete(key)) {
            // Cancel any pending debounced notification for this key
            const pending = this._pendingNotifications.get(key);
            if (pending !== undefined) {
                clearTimeout(pending);
                this._pendingNotifications.delete(key);
            }
            this._onDidChangeSchema.fire({ clusterId, databaseName: db, collectionName: coll });
        }
    }

    /** Clear all schemas for a cluster (e.g., on disconnect). */
    public clearCluster(clusterId: string): void {
        const prefix = `${clusterId}::`;
        for (const key of this._analyzers.keys()) {
            if (key.startsWith(prefix)) {
                this._analyzers.delete(key);
                const pending = this._pendingNotifications.get(key);
                if (pending !== undefined) {
                    clearTimeout(pending);
                    this._pendingNotifications.delete(key);
                }
            }
        }
    }

    /** Clear all schemas for a database within a cluster (e.g., on database drop). */
    public clearDatabase(clusterId: string, db: string): void {
        const prefix = `${clusterId}::${db}::`;
        for (const key of this._analyzers.keys()) {
            if (key.startsWith(prefix)) {
                this._analyzers.delete(key);
                const pending = this._pendingNotifications.get(key);
                if (pending !== undefined) {
                    clearTimeout(pending);
                    this._pendingNotifications.delete(key);
                }
            }
        }
    }

    /** Clear all schemas (e.g., for testing). */
    public reset(): void {
        this._analyzers.clear();
        for (const timer of this._pendingNotifications.values()) {
            clearTimeout(timer);
        }
        this._pendingNotifications.clear();
    }

    public dispose(): void {
        // Report peak stats to telemetry before teardown
        this._reportTelemetry();
        this.logStats();

        for (const timer of this._pendingNotifications.values()) {
            clearTimeout(timer);
        }
        this._pendingNotifications.clear();
        this._onDidChangeSchema.dispose();
        this._analyzers.clear();
        SchemaStore._instance = undefined;
    }

    // ── Debounced notification (1 second per key) ──

    private _fireSchemaChanged(key: string, event: SchemaChangeEvent): void {
        const existing = this._pendingNotifications.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        this._pendingNotifications.set(
            key,
            setTimeout(() => {
                this._pendingNotifications.delete(key);
                this._onDidChangeSchema.fire(event);
            }, 1000),
        );
    }
}
