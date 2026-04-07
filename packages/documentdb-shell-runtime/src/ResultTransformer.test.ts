/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResultTransformer, type ShellResultLike } from './ResultTransformer';

describe('ResultTransformer', () => {
    let transformer: ResultTransformer;

    beforeEach(() => {
        transformer = new ResultTransformer();
    });

    describe('transform', () => {
        it('passes through simple string results', () => {
            const shellResult: ShellResultLike = {
                type: 'string',
                printable: 'hello world',
            };
            const result = transformer.transform(shellResult, 42);

            expect(result.type).toBe('string');
            expect(result.printable).toBe('hello world');
            expect(result.durationMs).toBe(42);
            expect(result.source).toBeUndefined();
        });

        it('passes through numeric results', () => {
            const shellResult: ShellResultLike = {
                type: 'number',
                printable: 123,
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toBe(123);
        });

        it('passes through object results', () => {
            const doc = { _id: 'abc', name: 'test' };
            const shellResult: ShellResultLike = {
                type: 'Document',
                printable: doc,
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toEqual(doc);
        });

        it('passes through null printable', () => {
            const shellResult: ShellResultLike = {
                type: null,
                printable: null,
            };
            const result = transformer.transform(shellResult, 0);

            expect(result.type).toBeNull();
            expect(result.printable).toBeNull();
        });

        it('extracts source namespace when present', () => {
            const shellResult: ShellResultLike = {
                type: 'Cursor',
                printable: [],
                source: {
                    namespace: {
                        db: 'testdb',
                        collection: 'users',
                    },
                },
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.source).toEqual({
                namespace: { db: 'testdb', collection: 'users' },
            });
        });

        it('returns undefined source when namespace is absent', () => {
            const shellResult: ShellResultLike = {
                type: 'string',
                printable: 'hello',
                source: {},
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.source).toBeUndefined();
        });
    });

    describe('cursor result normalization', () => {
        it('unwraps { cursorHasMore, documents } cursor results', () => {
            const docs = [{ _id: 1 }, { _id: 2 }, { _id: 3 }];
            const shellResult: ShellResultLike = {
                type: 'Cursor',
                printable: { cursorHasMore: false, documents: docs },
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toEqual(docs);
            expect(Array.isArray(result.printable)).toBe(true);
        });

        it('unwraps cursor result with cursorHasMore: true', () => {
            const docs = [{ _id: 1 }];
            const shellResult: ShellResultLike = {
                type: 'Cursor',
                printable: { cursorHasMore: true, documents: docs },
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toEqual(docs);
        });

        it('normalizes Array subclass to plain Array', () => {
            // Simulate CursorIterationResult (Array subclass)
            class CursorIterationResult extends Array<unknown> {}
            const arr = new CursorIterationResult();
            arr.push({ _id: 1 }, { _id: 2 });

            const shellResult: ShellResultLike = {
                type: 'Cursor',
                printable: arr,
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toEqual([{ _id: 1 }, { _id: 2 }]);
            expect(Array.isArray(result.printable)).toBe(true);
            // Should be a plain Array, not a CursorIterationResult
            expect((result.printable as unknown[]).constructor).toBe(Array);
        });

        it('normalizes regular arrays to plain Array', () => {
            const shellResult: ShellResultLike = {
                type: 'Cursor',
                printable: [{ _id: 1 }],
            };
            const result = transformer.transform(shellResult, 10);

            expect(result.printable).toEqual([{ _id: 1 }]);
        });

        it('does not unwrap non-Cursor type even with documents field', () => {
            const shellResult: ShellResultLike = {
                type: 'Document',
                printable: { documents: [{ _id: 1 }] },
            };
            const result = transformer.transform(shellResult, 10);

            // Should not unwrap because type is not 'Cursor'
            expect(result.printable).toEqual({ documents: [{ _id: 1 }] });
        });
    });
});
