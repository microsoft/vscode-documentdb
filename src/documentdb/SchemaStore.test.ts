/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId } from 'bson';
import { SchemaStore, type SchemaChangeEvent } from './SchemaStore';

describe('SchemaStore', () => {
    let store: SchemaStore;

    beforeEach(() => {
        // Reset singleton between tests
        SchemaStore.getInstance().dispose();
        store = SchemaStore.getInstance();
    });

    afterEach(() => {
        store.dispose();
        jest.useRealTimers();
    });

    // ── Helpers ──

    const clusterId = 'cluster-1';
    const db = 'testDb';
    const coll = 'testColl';

    function makeDocs(fields: Record<string, unknown>[]) {
        return fields.map((f) => ({ _id: new ObjectId(), ...f }));
    }

    // ── Read/Write operations ──

    it('returns empty results for unknown keys', () => {
        expect(store.hasSchema(clusterId, db, coll)).toBe(false);
        expect(store.getKnownFields(clusterId, db, coll)).toEqual([]);
        expect(store.getDocumentCount(clusterId, db, coll)).toBe(0);
        expect(store.getSchema(clusterId, db, coll)).toEqual({ type: 'object' });
        expect(store.getPropertyNamesAtLevel(clusterId, db, coll, [])).toEqual([]);
    });

    it('creates analyzer and exposes fields after addDocuments', () => {
        const docs = makeDocs([{ name: 'Alice', age: 30 }]);
        store.addDocuments(clusterId, db, coll, docs);

        expect(store.hasSchema(clusterId, db, coll)).toBe(true);
        expect(store.getDocumentCount(clusterId, db, coll)).toBe(1);

        const fields = store.getKnownFields(clusterId, db, coll);
        const fieldNames = fields.map((f) => f.path);
        expect(fieldNames).toContain('_id');
        expect(fieldNames).toContain('name');
        expect(fieldNames).toContain('age');
    });

    it('accumulates schema across multiple addDocuments calls', () => {
        store.addDocuments(clusterId, db, coll, makeDocs([{ name: 'Alice' }]));
        store.addDocuments(clusterId, db, coll, makeDocs([{ email: 'a@b.com' }]));

        const fields = store.getKnownFields(clusterId, db, coll);
        const fieldNames = fields.map((f) => f.path);
        expect(fieldNames).toContain('name');
        expect(fieldNames).toContain('email');
        expect(store.getDocumentCount(clusterId, db, coll)).toBe(2);
    });

    it('does not create analyzer for empty document array', () => {
        store.addDocuments(clusterId, db, coll, []);
        expect(store.hasSchema(clusterId, db, coll)).toBe(false);
    });

    it('returns property names at root level', () => {
        store.addDocuments(clusterId, db, coll, makeDocs([{ name: 'Alice', age: 30 }]));
        const props = store.getPropertyNamesAtLevel(clusterId, db, coll, []);
        expect(props).toContain('_id');
        expect(props).toContain('name');
        expect(props).toContain('age');
    });

    it('returns property names at nested level', () => {
        store.addDocuments(clusterId, db, coll, makeDocs([{ address: { city: 'NYC', zip: '10001' } }]));
        const props = store.getPropertyNamesAtLevel(clusterId, db, coll, ['address']);
        expect(props).toContain('city');
        expect(props).toContain('zip');
    });

    // ── Multiple keys are independent ──

    it('keeps schemas independent per collection', () => {
        store.addDocuments(clusterId, db, 'users', makeDocs([{ name: 'Alice' }]));
        store.addDocuments(clusterId, db, 'orders', makeDocs([{ total: 99 }]));

        const userFields = store.getKnownFields(clusterId, db, 'users').map((f) => f.path);
        const orderFields = store.getKnownFields(clusterId, db, 'orders').map((f) => f.path);

        expect(userFields).toContain('name');
        expect(userFields).not.toContain('total');
        expect(orderFields).toContain('total');
        expect(orderFields).not.toContain('name');
    });

    it('keeps schemas independent per cluster', () => {
        store.addDocuments('cluster-a', db, coll, makeDocs([{ fieldA: 1 }]));
        store.addDocuments('cluster-b', db, coll, makeDocs([{ fieldB: 2 }]));

        const fieldsA = store.getKnownFields('cluster-a', db, coll).map((f) => f.path);
        const fieldsB = store.getKnownFields('cluster-b', db, coll).map((f) => f.path);

        expect(fieldsA).toContain('fieldA');
        expect(fieldsA).not.toContain('fieldB');
        expect(fieldsB).toContain('fieldB');
        expect(fieldsB).not.toContain('fieldA');
    });

    // ── Clear operations ──

    it('clearSchema removes a single collection', () => {
        store.addDocuments(clusterId, db, 'users', makeDocs([{ name: 'Alice' }]));
        store.addDocuments(clusterId, db, 'orders', makeDocs([{ total: 99 }]));

        store.clearSchema(clusterId, db, 'users');

        expect(store.hasSchema(clusterId, db, 'users')).toBe(false);
        expect(store.hasSchema(clusterId, db, 'orders')).toBe(true);
    });

    it('clearSchema is a no-op for unknown keys', () => {
        // Should not throw
        store.clearSchema(clusterId, db, 'nonexistent');
        expect(store.hasSchema(clusterId, db, 'nonexistent')).toBe(false);
    });

    it('clearCluster removes all schemas for a cluster', () => {
        store.addDocuments(clusterId, db, 'users', makeDocs([{ name: 'Alice' }]));
        store.addDocuments(clusterId, db, 'orders', makeDocs([{ total: 99 }]));
        store.addDocuments('other-cluster', db, 'users', makeDocs([{ name: 'Bob' }]));

        store.clearCluster(clusterId);

        expect(store.hasSchema(clusterId, db, 'users')).toBe(false);
        expect(store.hasSchema(clusterId, db, 'orders')).toBe(false);
        expect(store.hasSchema('other-cluster', db, 'users')).toBe(true);
    });

    it('reset clears everything', () => {
        store.addDocuments('c1', db, 'a', makeDocs([{ x: 1 }]));
        store.addDocuments('c2', db, 'b', makeDocs([{ y: 2 }]));

        store.reset();

        expect(store.hasSchema('c1', db, 'a')).toBe(false);
        expect(store.hasSchema('c2', db, 'b')).toBe(false);
    });

    // ── Singleton ──

    it('getInstance returns the same instance', () => {
        const a = SchemaStore.getInstance();
        const b = SchemaStore.getInstance();
        expect(a).toBe(b);
    });

    it('dispose resets the singleton', () => {
        const before = SchemaStore.getInstance();
        before.dispose();
        const after = SchemaStore.getInstance();
        expect(after).not.toBe(before);
    });

    // ── Events (debounced) ──

    describe('onDidChangeSchema', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        it('fires after debounce delay on addDocuments', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.addDocuments(clusterId, db, coll, makeDocs([{ name: 'Alice' }]));

            // Should not have fired yet
            expect(events).toHaveLength(0);

            // Advance past the 1-second debounce
            jest.advanceTimersByTime(1000);

            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                clusterId,
                databaseName: db,
                collectionName: coll,
            });
        });

        it('coalesces rapid addDocuments calls into a single event', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            // Rapid successive calls
            store.addDocuments(clusterId, db, coll, makeDocs([{ a: 1 }]));
            store.addDocuments(clusterId, db, coll, makeDocs([{ b: 2 }]));
            store.addDocuments(clusterId, db, coll, makeDocs([{ c: 3 }]));

            jest.advanceTimersByTime(1000);

            // Only one event, not three
            expect(events).toHaveLength(1);
        });

        it('fires separate events for different collections', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.addDocuments(clusterId, db, 'users', makeDocs([{ name: 'Alice' }]));
            store.addDocuments(clusterId, db, 'orders', makeDocs([{ total: 99 }]));

            jest.advanceTimersByTime(1000);

            expect(events).toHaveLength(2);
            expect(events.map((e) => e.collectionName)).toEqual(expect.arrayContaining(['users', 'orders']));
        });

        it('fires immediately on clearSchema (not debounced)', () => {
            store.addDocuments(clusterId, db, coll, makeDocs([{ name: 'Alice' }]));
            jest.advanceTimersByTime(1000); // flush addDocuments event

            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.clearSchema(clusterId, db, coll);

            // Should fire immediately, not after debounce
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({
                clusterId,
                databaseName: db,
                collectionName: coll,
            });
        });

        it('does not fire clearSchema for unknown keys', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.clearSchema(clusterId, db, 'nonexistent');

            expect(events).toHaveLength(0);
        });

        it('does not fire on addDocuments with empty array', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.addDocuments(clusterId, db, coll, []);

            jest.advanceTimersByTime(1000);

            expect(events).toHaveLength(0);
        });

        it('cancels pending debounced event when clearSchema is called', () => {
            const events: SchemaChangeEvent[] = [];
            store.onDidChangeSchema((e) => events.push(e));

            store.addDocuments(clusterId, db, coll, makeDocs([{ name: 'Alice' }]));
            // Pending debounced event exists
            store.clearSchema(clusterId, db, coll);

            // clearSchema fires immediately
            expect(events).toHaveLength(1);

            // Advance timers — no additional event from the cancelled addDocuments debounce
            jest.advanceTimersByTime(1000);
            expect(events).toHaveLength(1);
        });
    });
});
