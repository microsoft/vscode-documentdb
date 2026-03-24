/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SchemaAnalyzer,
    getPropertyNamesAtLevel,
    type FieldEntry,
    type JSONSchema,
} from '@vscode-documentdb/schema-analyzer';
import * as vscode from 'vscode';

import type { Document, WithId } from 'mongodb';

export interface SchemaChangeEvent {
    readonly clusterId: string;
    readonly databaseName: string;
    readonly collectionName: string;
}

/**
 * Shared, cluster-scoped schema cache.
 *
 * Accumulates schema data per `{clusterId, databaseName, collectionName}` triple,
 * enabling cross-tab and scratchpad schema sharing. All schema consumers
 * (Collection View tabs, scratchpad, future shell) read from and contribute
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

    // ── Write operations ──

    /** Feed documents to the schema store (from any source). */
    public addDocuments(
        clusterId: string,
        db: string,
        coll: string,
        documents: ReadonlyArray<WithId<Document>>,
    ): void {
        if (documents.length === 0) return;

        const key = SchemaStore.key(clusterId, db, coll);
        let analyzer = this._analyzers.get(key);
        if (!analyzer) {
            analyzer = new SchemaAnalyzer();
            this._analyzers.set(key, analyzer);
        }

        analyzer.addDocuments(documents);
        this._fireSchemaChanged(key, { clusterId, databaseName: db, collectionName: coll });
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
