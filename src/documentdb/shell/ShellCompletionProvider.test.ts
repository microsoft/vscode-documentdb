/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('../ClustersClient');
jest.mock('../SchemaStore');

import { ClustersClient } from '../ClustersClient';
import { SchemaStore } from '../SchemaStore';
import { ShellCompletionProvider, type ShellCompletionContext } from './ShellCompletionProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_CONTEXT: ShellCompletionContext = {
    clusterId: 'test-cluster',
    databaseName: 'testdb',
};

function mockClustersClient(databases: Array<{ name: string }> = [], collections: Array<{ name: string }> = []): void {
    const mockClient = {
        getCachedDatabases: jest.fn().mockReturnValue(databases),
        getCachedCollections: jest.fn().mockReturnValue(collections),
        listDatabases: jest.fn().mockResolvedValue(databases),
        listCollections: jest.fn().mockResolvedValue(collections),
    };
    (ClustersClient.getExistingClient as jest.Mock).mockReturnValue(mockClient);
}

function mockSchemaStore(
    collections: Array<{ key: string; documentCount: number; fieldCount: number }> = [],
    fields: Array<{ path: string; type: string; bsonType: string }> = [],
): void {
    const mockStore = {
        getStats: jest.fn().mockReturnValue({
            collectionCount: collections.length,
            totalDocuments: 0,
            totalFields: 0,
            collections,
        }),
        getKnownFields: jest.fn().mockReturnValue(fields),
    };
    (SchemaStore.getInstance as jest.Mock).mockReturnValue(mockStore);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ShellCompletionProvider', () => {
    let provider: ShellCompletionProvider;

    beforeEach(() => {
        provider = new ShellCompletionProvider();
        jest.clearAllMocks();

        // Default: empty caches
        mockClustersClient();
        mockSchemaStore();
    });

    describe('context detection', () => {
        it('should detect empty buffer as top-level', () => {
            const ctx = provider.detectContext('', 0);
            expect(ctx.kind).toBe('top-level');
        });

        it('should detect whitespace-only buffer as top-level', () => {
            const ctx = provider.detectContext('   ', 3);
            expect(ctx.kind).toBe('top-level');
        });

        it('should detect partial top-level command', () => {
            const ctx = provider.detectContext('sh', 2);
            expect(ctx.kind).toBe('top-level');
            if (ctx.kind === 'top-level') {
                expect(ctx.prefix).toBe('sh');
            }
        });

        it('should detect "show " as show-subcommand', () => {
            const ctx = provider.detectContext('show ', 5);
            expect(ctx.kind).toBe('show-subcommand');
        });

        it('should detect "show d" with prefix', () => {
            const ctx = provider.detectContext('show d', 6);
            expect(ctx.kind).toBe('show-subcommand');
            if (ctx.kind === 'show-subcommand') {
                expect(ctx.prefix).toBe('d');
            }
        });

        it('should detect "use " as use-database', () => {
            const ctx = provider.detectContext('use ', 4);
            expect(ctx.kind).toBe('use-database');
        });

        it('should detect "use my" with prefix', () => {
            const ctx = provider.detectContext('use my', 6);
            expect(ctx.kind).toBe('use-database');
            if (ctx.kind === 'use-database') {
                expect(ctx.prefix).toBe('my');
            }
        });

        it('should detect "db." as db-dot', () => {
            const ctx = provider.detectContext('db.', 3);
            expect(ctx.kind).toBe('db-dot');
            if (ctx.kind === 'db-dot') {
                expect(ctx.prefix).toBe('');
            }
        });

        it('should detect "db.us" as db-dot with prefix', () => {
            const ctx = provider.detectContext('db.us', 5);
            expect(ctx.kind).toBe('db-dot');
            if (ctx.kind === 'db-dot') {
                expect(ctx.prefix).toBe('us');
            }
        });

        it('should detect "db.users." as collection-method', () => {
            const ctx = provider.detectContext('db.users.', 10);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('users');
                expect(ctx.prefix).toBe('');
            }
        });

        it('should detect "db.users.fi" as collection-method with prefix', () => {
            const ctx = provider.detectContext('db.users.fi', 12);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('users');
                expect(ctx.prefix).toBe('fi');
            }
        });

        it('should detect method argument context', () => {
            const ctx = provider.detectContext('db.users.find(', 15);
            expect(ctx.kind).toBe('method-argument');
            if (ctx.kind === 'method-argument') {
                expect(ctx.collectionName).toBe('users');
                expect(ctx.methodName).toBe('find');
            }
        });

        it('should detect method argument with object content', () => {
            const ctx = provider.detectContext('db.users.find({ ', 17);
            expect(ctx.kind).toBe('method-argument');
        });
    });

    describe('top-level completions', () => {
        it('should return all top-level commands for empty buffer', () => {
            const result = provider.getCompletions('', 0, TEST_CONTEXT);
            expect(result.candidates.length).toBeGreaterThan(0);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('show');
            expect(labels).toContain('use');
            expect(labels).toContain('db');
            expect(labels).toContain('exit');
            expect(labels).toContain('help');
        });

        it('should filter by prefix', () => {
            const result = provider.getCompletions('sh', 2, TEST_CONTEXT);
            expect(result.candidates.length).toBe(1);
            expect(result.candidates[0].label).toBe('show');
        });

        it('should return empty for non-matching prefix', () => {
            const result = provider.getCompletions('xyz', 3, TEST_CONTEXT);
            expect(result.candidates.length).toBe(0);
        });
    });

    describe('show subcommands', () => {
        it('should return all show subcommands', () => {
            const result = provider.getCompletions('show ', 5, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('dbs');
            expect(labels).toContain('databases');
            expect(labels).toContain('collections');
        });

        it('should filter by prefix', () => {
            const result = provider.getCompletions('show d', 6, TEST_CONTEXT);
            expect(result.candidates.length).toBe(2);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('dbs');
            expect(labels).toContain('databases');
        });
    });

    describe('use database completions', () => {
        it('should return database names from ClustersClient cache', () => {
            mockClustersClient([{ name: 'admin' }, { name: 'mydb' }, { name: 'testdb' }]);

            const result = provider.getCompletions('use ', 4, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('admin');
            expect(labels).toContain('mydb');
            expect(labels).toContain('testdb');
        });

        it('should merge database names from SchemaStore', () => {
            mockClustersClient([{ name: 'admin' }]);
            mockSchemaStore([{ key: 'test-cluster::otherdb::coll1', documentCount: 10, fieldCount: 5 }]);

            const result = provider.getCompletions('use ', 4, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('admin');
            expect(labels).toContain('otherdb');
        });

        it('should filter by prefix', () => {
            mockClustersClient([{ name: 'admin' }, { name: 'mydb' }, { name: 'testdb' }]);

            const result = provider.getCompletions('use my', 6, TEST_CONTEXT);
            expect(result.candidates.length).toBe(1);
            expect(result.candidates[0].label).toBe('mydb');
        });
    });

    describe('db. completions', () => {
        it('should return collection names from ClustersClient', () => {
            mockClustersClient([], [{ name: 'users' }, { name: 'orders' }]);

            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('users');
            expect(labels).toContain('orders');
        });

        it('should include database methods', () => {
            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('getCollection');
            expect(labels).toContain('createCollection');
        });

        it('should merge collection names from SchemaStore', () => {
            mockClustersClient([], [{ name: 'users' }]);
            mockSchemaStore([{ key: 'test-cluster::testdb::logs', documentCount: 10, fieldCount: 5 }]);

            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('users');
            expect(labels).toContain('logs');
        });

        it('should filter by prefix', () => {
            mockClustersClient([], [{ name: 'users' }, { name: 'orders' }, { name: 'uploads' }]);

            const result = provider.getCompletions('db.us', 5, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('users');
            expect(labels).not.toContain('orders');
        });
    });

    describe('collection method completions', () => {
        it('should return collection methods for db.<collection>.', () => {
            const result = provider.getCompletions('db.users.', 10, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('find');
            expect(labels).toContain('findOne');
            expect(labels).toContain('insertOne');
            expect(labels).toContain('updateOne');
            expect(labels).toContain('deleteOne');
            expect(labels).toContain('aggregate');
        });

        it('should filter by prefix', () => {
            const result = provider.getCompletions('db.users.fi', 12, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('find');
            expect(labels).toContain('findOne');
            expect(labels).not.toContain('insertOne');
        });
    });

    describe('method argument completions', () => {
        it('should return field names from schema inside find()', () => {
            mockSchemaStore(
                [],
                [
                    { path: 'name', type: 'string', bsonType: 'string' },
                    { path: 'age', type: 'number', bsonType: 'int32' },
                    { path: '_id', type: 'string', bsonType: 'objectId' },
                ],
            );

            const result = provider.getCompletions('db.users.find({ ', 17, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('name');
            expect(labels).toContain('age');
            expect(labels).toContain('_id');
        });

        it('should not return operators inside find() without $ prefix', () => {
            const result = provider.getCompletions('db.users.find({ ', 17, TEST_CONTEXT);
            const operatorCandidates = result.candidates.filter((c) => c.kind === 'operator');
            expect(operatorCandidates.length).toBe(0);
        });

        it('should return operators inside find() when $ is typed', () => {
            const result = provider.getCompletions('db.users.find({ $', 18, TEST_CONTEXT);
            const operatorCandidates = result.candidates.filter((c) => c.kind === 'operator');
            expect(operatorCandidates.length).toBeGreaterThan(0);
        });
    });

    describe('cursor chain completions', () => {
        it('should detect cursor chain after find()', () => {
            const input = 'db.users.find({}).';
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('cursor-chain');
            if (ctx.kind === 'cursor-chain') {
                expect(ctx.cursorType).toBe('find');
                expect(ctx.prefix).toBe('');
            }
        });

        it('should return find cursor methods after find().', () => {
            const input = 'db.users.find({}).';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('limit');
            expect(labels).toContain('skip');
            expect(labels).toContain('sort');
            expect(labels).toContain('toArray');
        });

        it('should filter cursor methods by prefix', () => {
            const input = 'db.users.find({}).li';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('limit');
            expect(labels).not.toContain('skip');
        });

        it('should detect cursor chain after chained calls', () => {
            const input = 'db.users.find({}).limit(10).';
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('cursor-chain');
        });

        it('should return cursor methods after chained calls', () => {
            const input = 'db.users.find({}).limit(10).';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('sort');
            expect(labels).toContain('toArray');
        });

        it('should detect aggregate cursor chain', () => {
            const input = 'db.users.aggregate([]).';
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('cursor-chain');
            if (ctx.kind === 'cursor-chain') {
                expect(ctx.cursorType).toBe('aggregate');
            }
        });
    });

    describe('kind differentiation', () => {
        it('should mark db. collection candidates as kind "collection"', () => {
            mockClustersClient([], [{ name: 'users' }, { name: 'orders' }]);

            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const collections = result.candidates.filter((c) => c.kind === 'collection');
            const methods = result.candidates.filter((c) => c.kind === 'method');
            expect(collections.length).toBeGreaterThan(0);
            expect(methods.length).toBeGreaterThan(0);
        });

        it('should mark collection methods as kind "method"', () => {
            const result = provider.getCompletions('db.users.', 10, TEST_CONTEXT);
            const allMethods = result.candidates.every((c) => c.kind === 'method');
            expect(allMethods).toBe(true);
        });
    });

    // ─── Operator vs field separation (Option C) ─────────────────────────────

    describe('operator/field separation at key position', () => {
        beforeEach(() => {
            mockSchemaStore(
                [],
                [
                    { path: 'name', type: 'string', bsonType: 'string' },
                    { path: 'age', type: 'number', bsonType: 'int32' },
                    { path: 'status', type: 'string', bsonType: 'string' },
                ],
            );
        });

        it('should show only fields (no operators) at key position with empty prefix', () => {
            const result = provider.getCompletions('db.users.find({ ', 17, TEST_CONTEXT);
            const fields = result.candidates.filter((c) => c.kind === 'field');
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(fields.length).toBe(3);
            expect(operators.length).toBe(0);
        });

        it('should show only fields when prefix is a plain identifier', () => {
            const input = 'db.users.find({ na';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('name');
            expect(labels).not.toContain('$ne');
        });

        it('should show only operators when prefix starts with $', () => {
            const input = 'db.users.find({ $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const fields = result.candidates.filter((c) => c.kind === 'field');
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(fields.length).toBe(0);
            expect(operators.length).toBeGreaterThan(0);
        });

        it('should filter operators by prefix after $', () => {
            const input = 'db.users.find({ $g';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('$gt');
            expect(labels).toContain('$gte');
            expect(labels).not.toContain('$lt');
        });

        it('should show operators at value position (after colon)', () => {
            const input = 'db.users.find({ age: { $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(operators.length).toBeGreaterThan(0);
        });

        it('should show operators at operator position', () => {
            const input = 'db.users.find({ age: { $gt: 5, $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(operators.length).toBeGreaterThan(0);
        });

        it('should show only fields after comma at key position', () => {
            const input = 'db.users.find({ name: "alice", ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const fields = result.candidates.filter((c) => c.kind === 'field');
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(fields.length).toBe(3);
            expect(operators.length).toBe(0);
        });

        it('should show only operators after comma when $ typed', () => {
            const input = 'db.users.find({ name: "alice", $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const fields = result.candidates.filter((c) => c.kind === 'field');
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(fields.length).toBe(0);
            expect(operators.length).toBeGreaterThan(0);
        });
    });

    // ─── Nested field prefix extraction ──────────────────────────────────────

    describe('nested field path completions', () => {
        beforeEach(() => {
            mockSchemaStore(
                [],
                [
                    { path: 'name', type: 'string', bsonType: 'string' },
                    { path: 'address', type: 'object', bsonType: 'object' },
                    { path: 'address.city', type: 'string', bsonType: 'string' },
                    { path: 'address.state', type: 'string', bsonType: 'string' },
                    { path: 'address.zip', type: 'string', bsonType: 'string' },
                    { path: 'toplevel', type: 'object', bsonType: 'object' },
                    { path: 'toplevel.isEnabled', type: 'boolean', bsonType: 'bool' },
                    { path: 'toplevel.isActive', type: 'boolean', bsonType: 'bool' },
                    { path: 'toplevel.itemCount', type: 'number', bsonType: 'int32' },
                    { path: 'settings.theme.color', type: 'string', bsonType: 'string' },
                ],
            );
        });

        it('should match nested field by dotted prefix', () => {
            const input = 'db.users.find({ address.ci';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('address.city');
            expect(labels).not.toContain('address.state');
        });

        it('should match all sub-fields of a parent path', () => {
            const input = 'db.users.find({ address.';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('address.city');
            expect(labels).toContain('address.state');
            expect(labels).toContain('address.zip');
            expect(labels).not.toContain('name');
        });

        it('should not match ISODate for toplevel.is prefix', () => {
            const input = 'db.users.find({ toplevel.is';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('toplevel.isEnabled');
            expect(labels).toContain('toplevel.isActive');
            expect(labels).not.toContain('toplevel.itemCount');
            // Must NOT match BSON constructors
            const bsonCandidates = result.candidates.filter((c) => c.kind === 'bson');
            expect(bsonCandidates.length).toBe(0);
        });

        it('should not match unrelated top-level fields for nested prefix', () => {
            const input = 'db.users.find({ toplevel.';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('toplevel.isEnabled');
            expect(labels).toContain('toplevel.isActive');
            expect(labels).toContain('toplevel.itemCount');
            expect(labels).not.toContain('name');
            expect(labels).not.toContain('address');
        });

        it('should match deeply nested fields', () => {
            const input = 'db.users.find({ settings.theme.';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('settings.theme.color');
        });

        it('should match full dotted path with partial last segment', () => {
            const input = 'db.users.find({ settings.theme.co';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('settings.theme.color');
        });

        it('should return all fields when no prefix is typed', () => {
            const input = 'db.users.find({ ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const fields = result.candidates.filter((c) => c.kind === 'field');
            expect(fields.length).toBe(10); // all fields from mock
        });

        it('should handle prefix that matches top-level and nested', () => {
            const input = 'db.users.find({ top';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('toplevel');
            expect(labels).toContain('toplevel.isEnabled');
            expect(labels).toContain('toplevel.isActive');
            expect(labels).toContain('toplevel.itemCount');
        });

        it('should produce correct replacementStart for dotted prefix', () => {
            const input = 'db.users.find({ address.ci';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            // replacementStart should point to 'a' in 'address.ci'
            expect(result.prefix).toBe('address.ci');
            // The replacement should cover the entire dotted path
            const expectedStart = input.indexOf('address.ci');
            expect(result.replacementStart).toBe(expectedStart);
        });

        it('should not break $ operator prefix with dot inclusion', () => {
            const input = 'db.users.find({ $g';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            expect(result.prefix).toBe('$g');
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('$gt');
            expect(labels).toContain('$gte');
        });

        it('should not break simple field prefix', () => {
            const input = 'db.users.find({ na';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            expect(result.prefix).toBe('na');
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('name');
        });
    });

    // ─── Dotted field quoting ────────────────────────────────────────────────

    describe('dotted field quoting', () => {
        beforeEach(() => {
            mockSchemaStore(
                [],
                [
                    { path: 'name', type: 'string', bsonType: 'string' },
                    { path: 'address', type: 'object', bsonType: 'object' },
                    { path: 'address.city', type: 'string', bsonType: 'string' },
                    { path: 'address.state', type: 'string', bsonType: 'string' },
                    { path: 'toplevel.isEnabled', type: 'boolean', bsonType: 'bool' },
                    { path: 'settings.theme.color', type: 'string', bsonType: 'string' },
                ],
            );
        });

        it('should quote dotted field paths in insertText', () => {
            const input = 'db.users.find({ ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const addressCity = result.candidates.find((c) => c.label === 'address.city');
            expect(addressCity).toBeDefined();
            expect(addressCity!.insertText).toBe('"address.city"');
        });

        it('should not quote simple field paths', () => {
            const input = 'db.users.find({ ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const name = result.candidates.find((c) => c.label === 'name');
            expect(name).toBeDefined();
            expect(name!.insertText).toBe('name');
        });

        it('should quote deeply nested field paths', () => {
            const input = 'db.users.find({ ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const deep = result.candidates.find((c) => c.label === 'settings.theme.color');
            expect(deep).toBeDefined();
            expect(deep!.insertText).toBe('"settings.theme.color"');
        });

        it('should filter quoted candidates by dotted prefix', () => {
            const input = 'db.users.find({ address.ci';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            expect(result.candidates.length).toBe(1);
            expect(result.candidates[0].label).toBe('address.city');
            expect(result.candidates[0].insertText).toBe('"address.city"');
        });

        it('should filter by label not insertText', () => {
            // Prefix 'address.' should match fields with dotted label, not the quoted insertText
            const input = 'db.users.find({ address.';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('address.city');
            expect(labels).toContain('address.state');
            expect(labels).not.toContain('name');
        });
    });

    // ─── Bracket notation completions ────────────────────────────────────────

    describe('db[ bracket notation completions', () => {
        beforeEach(() => {
            mockClustersClient([], [{ name: 'restaurants' }, { name: 'orders' }, { name: 'users' }]);
        });

        it('should detect "db[" as db-bracket context with no quote', () => {
            const ctx = provider.detectContext('db[', 3);
            expect(ctx.kind).toBe('db-bracket');
            if (ctx.kind === 'db-bracket') {
                expect(ctx.prefix).toBe('');
                expect(ctx.quote).toBe('');
            }
        });

        it('should detect "db[\'" as db-bracket context with single quote', () => {
            const ctx = provider.detectContext("db['", 4);
            expect(ctx.kind).toBe('db-bracket');
            if (ctx.kind === 'db-bracket') {
                expect(ctx.prefix).toBe('');
                expect(ctx.quote).toBe("'");
            }
        });

        it("should detect 'db[\"' as db-bracket context with double quote", () => {
            const ctx = provider.detectContext('db["', 4);
            expect(ctx.kind).toBe('db-bracket');
            if (ctx.kind === 'db-bracket') {
                expect(ctx.prefix).toBe('');
                expect(ctx.quote).toBe('"');
            }
        });

        it('should detect "db[\'res" as db-bracket with prefix', () => {
            const ctx = provider.detectContext("db['res", 7);
            expect(ctx.kind).toBe('db-bracket');
            if (ctx.kind === 'db-bracket') {
                expect(ctx.prefix).toBe('res');
                expect(ctx.quote).toBe("'");
            }
        });

        it('should return collection names for "db["', () => {
            const result = provider.getCompletions('db["', 4, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('restaurants');
            expect(labels).toContain('orders');
            expect(labels).toContain('users');
        });

        it('should not include database methods for bracket notation', () => {
            const result = provider.getCompletions('db["', 4, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).not.toContain('getCollection');
            expect(labels).not.toContain('createCollection');
        });

        it("should wrap insertText with closing quote and bracket for db['", () => {
            const result = provider.getCompletions("db['", 4, TEST_CONTEXT);
            const restaurants = result.candidates.find((c) => c.label === 'restaurants');
            expect(restaurants).toBeDefined();
            expect(restaurants!.insertText).toBe("restaurants']");
        });

        it('should wrap insertText with closing double quote and bracket for db["', () => {
            const result = provider.getCompletions('db["', 4, TEST_CONTEXT);
            const restaurants = result.candidates.find((c) => c.label === 'restaurants');
            expect(restaurants).toBeDefined();
            expect(restaurants!.insertText).toBe('restaurants"]');
        });

        it('should add opening quote when no quote typed (db[)', () => {
            const result = provider.getCompletions('db[', 3, TEST_CONTEXT);
            const restaurants = result.candidates.find((c) => c.label === 'restaurants');
            expect(restaurants).toBeDefined();
            expect(restaurants!.insertText).toBe("'restaurants']");
        });

        it("should filter by prefix for db['res", () => {
            const result = provider.getCompletions("db['res", 7, TEST_CONTEXT);
            expect(result.candidates.length).toBe(1);
            expect(result.candidates[0].label).toBe('restaurants');
            expect(result.candidates[0].insertText).toBe("restaurants']");
        });

        it('should return empty for non-matching prefix', () => {
            const result = provider.getCompletions("db['xyz", 7, TEST_CONTEXT);
            expect(result.candidates.length).toBe(0);
        });
    });

    // ─── Value-position operator filtering ───────────────────────────────────

    describe('value-position operator filtering', () => {
        beforeEach(() => {
            mockSchemaStore(
                [],
                [
                    { path: '_id', type: 'objectId', bsonType: 'objectId' },
                    { path: 'name', type: 'string', bsonType: 'string' },
                    { path: 'age', type: 'number', bsonType: 'int32' },
                ],
            );
        });

        it('should not show query operators in value position', () => {
            const input = 'db.restaurants.find({_id: $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(operators.length).toBe(0);
        });

        it('should show BSON constructors in value position', () => {
            const input = 'db.restaurants.find({_id: ';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const bson = result.candidates.filter((c) => c.kind === 'bson');
            expect(bson.length).toBeGreaterThan(0);
        });

        it('should still show operators at operator position (inside nested object)', () => {
            const input = 'db.restaurants.find({age: { $';
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const operators = result.candidates.filter((c) => c.kind === 'operator');
            expect(operators.length).toBeGreaterThan(0);
        });
    });

    // ─── Bracket notation method completions ─────────────────────────────────

    describe("db['collection']. method completions", () => {
        it("should detect db['restaurants']. as collection-method", () => {
            const input = "db['restaurants'].";
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('restaurants');
                expect(ctx.prefix).toBe('');
            }
        });

        it('should detect db["restaurants"]. as collection-method', () => {
            const input = 'db["restaurants"].';
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('restaurants');
                expect(ctx.prefix).toBe('');
            }
        });

        it("should detect db['restaurants'].fi as collection-method with prefix", () => {
            const input = "db['restaurants'].fi";
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('restaurants');
                expect(ctx.prefix).toBe('fi');
            }
        });

        it("should return collection methods for db['restaurants'].", () => {
            const input = "db['restaurants'].";
            const result = provider.getCompletions(input, input.length, TEST_CONTEXT);
            const labels = result.candidates.map((c) => c.label);
            expect(labels).toContain('find');
            expect(labels).toContain('insertOne');
            expect(labels).toContain('aggregate');
        });

        it("should detect method argument for db['restaurants'].find(", () => {
            const input = "db['restaurants'].find(";
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('method-argument');
            if (ctx.kind === 'method-argument') {
                expect(ctx.collectionName).toBe('restaurants');
                expect(ctx.methodName).toBe('find');
            }
        });

        it("should handle special-char collection names: db['stores (10)'].", () => {
            const input = "db['stores (10)'].";
            const ctx = provider.detectContext(input, input.length);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('stores (10)');
            }
        });
    });

    // ─── Special-char collection bracket notation switch ─────────────────────

    describe('special-char collection auto-switch to bracket notation', () => {
        beforeEach(() => {
            mockClustersClient([], [{ name: 'restaurants' }, { name: 'stores (10)' }, { name: 'my-collection' }]);
        });

        it('should use dot notation insertText for normal collection names', () => {
            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const restaurants = result.candidates.find((c) => c.label === 'restaurants');
            expect(restaurants).toBeDefined();
            expect(restaurants!.insertText).toBe('restaurants');
        });

        it('should use bracket notation insertText for special-char names', () => {
            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const stores = result.candidates.find((c) => c.label === 'stores (10)');
            expect(stores).toBeDefined();
            expect(stores!.insertText).toBe("['stores (10)']");
        });

        it('should use bracket notation for hyphenated names', () => {
            const result = provider.getCompletions('db.', 3, TEST_CONTEXT);
            const coll = result.candidates.find((c) => c.label === 'my-collection');
            expect(coll).toBeDefined();
            expect(coll!.insertText).toBe("['my-collection']");
        });

        it('should filter bracket-notation candidates by label prefix', () => {
            const result = provider.getCompletions('db.sto', 6, TEST_CONTEXT);
            expect(result.candidates.length).toBe(1);
            expect(result.candidates[0].label).toBe('stores (10)');
            expect(result.candidates[0].insertText).toBe("['stores (10)']");
        });
    });
});
