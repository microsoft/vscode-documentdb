/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { ObjectId, type Document, type WithId } from 'mongodb';
import { ext } from '../../extensionVariables';
import { resolveDocumentTargets } from '../../webviews/documentdb/collectionView/collectionViewContext';
import { toGridCellValue, toTablePage } from './toTablePage';
import { fieldColumnKey, getCell, ROOT_ID_COLUMN_KEY } from './types';

vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));

const jsonDocuments = [
    {
        name: 'Document 1',
        nestedDocument: {
            key: 'value',
            anotherKey: 'anotherValue',
        },
        array: [
            'value1',
            'value2',
            {
                key: 'value',
            },
        ],
    },
    {
        name: 'Document 1',
        nestedDocument: {
            key: 'value',
            subNestedDocument: {
                a_key: false,
            },
        },
        array: [
            'value1',
            'value2',
            {
                key: 'value',
            },
        ],
    },
    {
        title: 'The Favourite',
        genres: ['Drama', 'History'],
        runtime: 121,
        rated: 'R',
        year: 2018,
        directors: ['Yorgos Lanthimos'],
        cast: ['Olivia Colman', 'Emma Stone', 'Rachel Weisz'],
        type: 'movie',
    },
    {
        songName: 'There goes my baby',
        firstName: 'Murray',
        genre: 'Hip Hop',
        recent: '2024-08-20T21:29:34.957Z',
    },
    {
        songName: 'With Or Without You',
        firstName: 'Anastacio',
        genre: 'Non Music',
        recent: '2024-08-21T02:49:29.160Z',
    },
];

const documents: WithId<Document>[] = jsonDocuments.map((doc) => {
    return {
        _id: new ObjectId(),
        ...doc,
    };
});

describe('toTablePage', () => {
    it('at the root', () => {
        const page = toTablePage(documents, [], ['name', 'nestedDocument', 'array'], true);
        expect(page.rows).toHaveLength(5);
    });

    it('at a nested level', () => {
        const page = toTablePage(documents, ['nestedDocument'], ['key', 'anotherKey', 'subNestedDocument'], true);

        expect(page.rows).toHaveLength(5);
        expect(getCell(page.rows[0], fieldColumnKey('key'))).toBeDefined();
        expect(getCell(page.rows[1], fieldColumnKey('key'))).toEqual({ display: 'value', type: 'string' });
        expect(getCell(page.rows[0], fieldColumnKey('anotherKey'))).toBeDefined();
        expect(getCell(page.rows[1], fieldColumnKey('subNestedDocument'))).toBeDefined();
    });

    it('at a 2nd nested level', () => {
        const page = toTablePage(documents, ['nestedDocument', 'subNestedDocument'], ['a_key'], true);
        expect(page.rows).toHaveLength(5);
        expect(getCell(page.rows[1], fieldColumnKey('a_key'))).toEqual({ display: 'false', type: 'boolean' });
    });

    it('preserves heterogeneous fields, falsy values, arrays and missing versus null', () => {
        const page = toTablePage(
            [{ _id: 0, value: null, array: [false, null], empty: '' }, { _id: false, value: 0 }, { _id: '' }],
            [],
            ['_id', 'value', 'array', 'empty', 'knownElsewhere'],
            true,
        );
        expect(page.columns.map((column) => column.key)).toEqual([
            ROOT_ID_COLUMN_KEY,
            'field:value',
            'field:array',
            'field:empty',
            'field:knownElsewhere',
        ]);
        expect(getCell(page.rows[0], fieldColumnKey('value'))).toEqual({ display: 'null', type: 'null' });
        expect(getCell(page.rows[1], fieldColumnKey('value'))).toEqual({ display: '0', type: 'double' });
        expect(getCell(page.rows[2], fieldColumnKey('value'))).toBeUndefined();
        expect(getCell(page.rows[0], fieldColumnKey('empty'))).toEqual({ display: '', type: 'string' });
        expect(getCell(page.rows[0], fieldColumnKey('array'))).toEqual({ display: 'array[2]', type: 'array' });
        expect(page.rows.every((row) => row.documentId !== undefined)).toBe(true);
    });

    it('retains root IDs at nested and missing paths while hiding nested _id and inherited fields', () => {
        const nested: Document = Object.create({ inherited: 'hidden' }) as Document;
        nested._id = 'nested';
        nested.value = null;
        const page = toTablePage(
            [{ _id: 'root', nested }, { _id: null, nested: null }, { _id: false }],
            ['nested'],
            ['_id', 'value', 'inherited'],
            true,
        );
        expect(getCell(page.rows[0], ROOT_ID_COLUMN_KEY)).toEqual({ display: 'root', type: 'string' });
        expect(getCell(page.rows[0], fieldColumnKey('_id'))).toBeUndefined();
        expect(getCell(page.rows[0], fieldColumnKey('inherited'))).toBeUndefined();
        expect(getCell(page.rows[0], fieldColumnKey('value'))).toEqual({ display: 'null', type: 'null' });
        expect(page.rows[1].cells).toEqual({ [ROOT_ID_COLUMN_KEY]: { display: 'null', type: 'null' } });
        expect(page.rows[2].cells).toEqual({ [ROOT_ID_COLUMN_KEY]: { display: 'false', type: 'boolean' } });
        const inheritedPath = toTablePage([{ _id: 'root', nested }], ['nested', 'inherited'], ['value'], true);
        expect(Object.keys(inheritedPath.rows[0].cells)).toEqual([ROOT_ID_COLUMN_KEY]);
    });

    it('isolates document metadata from reserved and prototype-like field names', () => {
        const document: Document = JSON.parse(
            '{"_id":"root","id":"user","x-objectid":"user","__proto__":null,"constructor":false,"root:_id":0,"":""}',
        ) as Document;
        const page = toTablePage([document], [], Object.keys(document), true);
        expect(page.rows[0].documentId).toBe('"root"');
        expect(getCell(page.rows[0], fieldColumnKey('x-objectid'))?.display).toBe('user');
        expect(getCell(page.rows[0], fieldColumnKey('__proto__'))).toEqual({ display: 'null', type: 'null' });
        expect(getCell(page.rows[0], fieldColumnKey('constructor'))?.type).toBe('boolean');
        expect(getCell(page.rows[0], fieldColumnKey('root:_id'))?.type).toBe('double');
        expect(getCell(page.rows[0], fieldColumnKey(''))?.display).toBe('');
        expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    });

    it('keeps cells visible when projection or duplicate IDs withhold actions', () => {
        const projected = toTablePage([{ _id: 'computed', value: 1 }], [], ['value'], false);
        expect(projected.rows[0]).toMatchObject({ rowKey: 'pos:0' });
        expect(projected.rows[0]).not.toHaveProperty('documentId');
        expect(getCell(projected.rows[0], ROOT_ID_COLUMN_KEY)?.display).toBe('computed');
        const duplicate = toTablePage([{ _id: 'same' }, { _id: 'same' }], [], [], true);
        expect(duplicate.rows.map((row) => row.rowKey)).toEqual(['pos:0', 'pos:1']);
        expect(duplicate.rows.every((row) => !Object.hasOwn(row, 'documentId'))).toBe(true);
    });

    it('keeps display cells visible when an unsafe object ID withholds actions', () => {
        const page = toTablePage([{ _id: { '1': 2, b: 3 }, value: 'kept' }], [], ['value'], true);

        expect(page.rows[0]).toMatchObject({ rowKey: 'pos:0' });
        expect(page.rows[0]).not.toHaveProperty('documentId');
        expect(getCell(page.rows[0], ROOT_ID_COLUMN_KEY)).toBeDefined();
        expect(getCell(page.rows[0], fieldColumnKey('value'))).toEqual({ display: 'kept', type: 'string' });
    });

    it('leaves formatter failures blank without failing the page or logging the user value', () => {
        const page = toTablePage(
            [{ _id: 'root', invalidDate: new Date(NaN), explicitUndefined: undefined }],
            [],
            [],
            true,
        );
        expect(getCell(page.rows[0], fieldColumnKey('invalidDate'))).toEqual({ display: '', type: 'date' });
        expect(getCell(page.rows[0], fieldColumnKey('explicitUndefined'))).toEqual({ display: '', type: 'undefined' });
        expect(ext.outputChannel.warn).toHaveBeenCalledWith('[DocumentGrid] Failed to format a cell value');
        expect(toGridCellValue(null)).toEqual({ display: 'null', type: 'null' });
    });

    it('resolves the whole selection or fails closed for stale or non-actionable keys', () => {
        const page = toTablePage([{ _id: 'safe' }, {}], [], [], true);
        const safeKey = page.rows[0].rowKey;
        expect(resolveDocumentTargets(page, [safeKey])).toEqual([{ rowKey: safeKey, documentId: '"safe"' }]);
        expect(resolveDocumentTargets(page, [safeKey, 'pos:1'])).toBeUndefined();
        expect(resolveDocumentTargets(page, [safeKey, 'stale'])).toBeUndefined();
        expect(resolveDocumentTargets(undefined, [safeKey])).toBeUndefined();
        expect(resolveDocumentTargets(page, [])).toEqual([]);
    });
});
