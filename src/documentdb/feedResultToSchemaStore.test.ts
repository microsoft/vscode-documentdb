/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('./SchemaStore');

import { ObjectId } from 'mongodb';
import {
    deserializeResultForSchema,
    feedResultToSchemaStore,
    type SchemaFeedableResult,
} from './feedResultToSchemaStore';
import { SchemaStore } from './SchemaStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_CLUSTER_ID = 'test-cluster';

function mockSchemaStore(): jest.Mock {
    const addDocumentsMock = jest.fn();
    const mockStore = {
        addDocuments: addDocumentsMock,
    };
    (SchemaStore.getInstance as jest.Mock).mockReturnValue(mockStore);
    return addDocumentsMock;
}

function makeResult(overrides: Partial<SchemaFeedableResult> = {}): SchemaFeedableResult {
    return {
        type: 'Cursor',
        printable: [{ _id: new ObjectId(), name: 'Alice', age: 30 }],
        source: { namespace: { db: 'testdb', collection: 'users' } },
        ...overrides,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('feedResultToSchemaStore', () => {
    let addDocumentsMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        addDocumentsMock = mockSchemaStore();
    });

    describe('result type filtering', () => {
        it('should feed Cursor results to SchemaStore', () => {
            feedResultToSchemaStore(makeResult({ type: 'Cursor' }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledTimes(1);
        });

        it('should feed Document results to SchemaStore', () => {
            const doc = { _id: new ObjectId(), name: 'Bob' };
            feedResultToSchemaStore(makeResult({ type: 'Document', printable: doc }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledTimes(1);
        });

        it('should skip string results', () => {
            feedResultToSchemaStore(makeResult({ type: 'string' }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should skip null type results', () => {
            feedResultToSchemaStore(makeResult({ type: null }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should skip exit results', () => {
            feedResultToSchemaStore(makeResult({ type: 'exit' }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should skip clear results', () => {
            feedResultToSchemaStore(makeResult({ type: 'clear' }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });
    });

    describe('namespace validation', () => {
        it('should skip results without namespace', () => {
            feedResultToSchemaStore(makeResult({ source: undefined }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should skip results without collection name', () => {
            feedResultToSchemaStore(
                makeResult({ source: { namespace: { db: 'testdb', collection: '' } } }),
                TEST_CLUSTER_ID,
            );
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should pass correct cluster/db/collection to SchemaStore', () => {
            feedResultToSchemaStore(makeResult(), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledWith(
                TEST_CLUSTER_ID,
                'testdb',
                'users',
                expect.any(Array) as unknown[],
            );
        });
    });

    describe('printable extraction', () => {
        it('should skip null printable', () => {
            feedResultToSchemaStore(makeResult({ printable: null }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should skip undefined printable', () => {
            feedResultToSchemaStore(makeResult({ printable: undefined }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });

        it('should handle array of documents', () => {
            const docs = [
                { _id: new ObjectId(), name: 'Alice' },
                { _id: new ObjectId(), name: 'Bob' },
            ];
            feedResultToSchemaStore(makeResult({ printable: docs }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledWith(TEST_CLUSTER_ID, 'testdb', 'users', docs);
        });

        it('should handle single document (non-array)', () => {
            const doc = { _id: new ObjectId(), name: 'Alice' };
            feedResultToSchemaStore(makeResult({ type: 'Document', printable: doc }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledWith(TEST_CLUSTER_ID, 'testdb', 'users', [doc]);
        });

        it('should unwrap CursorIterationResult wrapper', () => {
            const docs = [
                { _id: new ObjectId(), name: 'Alice' },
                { _id: new ObjectId(), name: 'Bob' },
            ];
            const wrapper = { cursorHasMore: true, documents: docs };
            feedResultToSchemaStore(makeResult({ printable: wrapper }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledWith(TEST_CLUSTER_ID, 'testdb', 'users', docs);
        });

        it('should unwrap CursorIterationResult with cursorHasMore=false', () => {
            const docs = [{ _id: new ObjectId(), name: 'Alice' }];
            const wrapper = { cursorHasMore: false, documents: docs };
            feedResultToSchemaStore(makeResult({ printable: wrapper }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).toHaveBeenCalledWith(TEST_CLUSTER_ID, 'testdb', 'users', docs);
        });

        it('should not unwrap objects that only have documents (no cursorHasMore)', () => {
            // User doc that happens to have a "documents" field but no cursorHasMore
            const doc = { _id: new ObjectId(), documents: [{ nested: true }] };
            feedResultToSchemaStore(makeResult({ type: 'Document', printable: doc }), TEST_CLUSTER_ID);
            // Should wrap the doc itself, not unwrap its documents field
            expect(addDocumentsMock).toHaveBeenCalledWith(TEST_CLUSTER_ID, 'testdb', 'users', [doc]);
        });
    });

    describe('document filtering', () => {
        it('should filter out primitives from arrays', () => {
            const mixed = [{ _id: new ObjectId(), name: 'Alice' }, 42, 'hello', null, true];
            feedResultToSchemaStore(makeResult({ printable: mixed }), TEST_CLUSTER_ID);
            const fedDocs = addDocumentsMock.mock.calls[0][3] as unknown[];
            expect(fedDocs).toHaveLength(1);
        });

        it('should filter out nested arrays', () => {
            const mixed = [{ _id: new ObjectId(), name: 'Alice' }, [1, 2, 3]];
            feedResultToSchemaStore(makeResult({ printable: mixed }), TEST_CLUSTER_ID);
            const fedDocs = addDocumentsMock.mock.calls[0][3] as unknown[];
            expect(fedDocs).toHaveLength(1);
        });

        it('should filter out objects without _id (projection with _id: 0)', () => {
            const docs = [
                { _id: new ObjectId(), name: 'Alice' },
                { name: 'Bob' }, // projected away _id
            ];
            feedResultToSchemaStore(makeResult({ printable: docs }), TEST_CLUSTER_ID);
            const fedDocs = addDocumentsMock.mock.calls[0][3] as unknown[];
            expect(fedDocs).toHaveLength(1);
        });

        it('should skip entirely if all items are non-documents', () => {
            feedResultToSchemaStore(makeResult({ printable: [42, 'hello', true] }), TEST_CLUSTER_ID);
            expect(addDocumentsMock).not.toHaveBeenCalled();
        });
    });

    describe('document cap', () => {
        it('should cap at 100 documents', () => {
            const docs = Array.from({ length: 200 }, (_, i) => ({
                _id: new ObjectId(),
                index: i,
            }));
            feedResultToSchemaStore(makeResult({ printable: docs }), TEST_CLUSTER_ID);
            const fedDocs = addDocumentsMock.mock.calls[0][3] as unknown[];
            expect(fedDocs).toHaveLength(100);
        });

        it('should pass all documents when under the cap', () => {
            const docs = Array.from({ length: 50 }, (_, i) => ({
                _id: new ObjectId(),
                index: i,
            }));
            feedResultToSchemaStore(makeResult({ printable: docs }), TEST_CLUSTER_ID);
            const fedDocs = addDocumentsMock.mock.calls[0][3] as unknown[];
            expect(fedDocs).toHaveLength(50);
        });
    });
});

describe('deserializeResultForSchema', () => {
    it('should deserialize EJSON string to raw objects', async () => {
        const serResult = {
            type: 'Cursor' as const,
            printable: '[{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"Alice"}]',
            source: { namespace: { db: 'testdb', collection: 'users' } },
        };
        const deserialized = await deserializeResultForSchema(serResult);
        expect(deserialized.type).toBe('Cursor');
        expect(Array.isArray(deserialized.printable)).toBe(true);
        const docs = deserialized.printable as unknown[];
        expect(docs).toHaveLength(1);
        expect((docs[0] as Record<string, unknown>).name).toBe('Alice');
    });

    it('should preserve source namespace', async () => {
        const serResult = {
            type: 'Document' as const,
            printable: '{"_id":{"$oid":"507f1f77bcf86cd799439011"}}',
            source: { namespace: { db: 'mydb', collection: 'orders' } },
        };
        const deserialized = await deserializeResultForSchema(serResult);
        expect(deserialized.source?.namespace?.db).toBe('mydb');
        expect(deserialized.source?.namespace?.collection).toBe('orders');
    });

    it('should fall back to JSON.parse if EJSON fails', async () => {
        const serResult = {
            type: 'Cursor' as const,
            printable: '[{"_id":"simple","name":"Bob"}]',
            source: { namespace: { db: 'testdb', collection: 'users' } },
        };
        const deserialized = await deserializeResultForSchema(serResult);
        expect(Array.isArray(deserialized.printable)).toBe(true);
    });

    it('should fall back to raw string if all parsing fails', async () => {
        const serResult = {
            type: 'string' as const,
            printable: 'not valid json at all {{{',
            source: { namespace: { db: 'testdb', collection: 'users' } },
        };
        const deserialized = await deserializeResultForSchema(serResult);
        expect(deserialized.printable).toBe('not valid json at all {{{');
    });
});
