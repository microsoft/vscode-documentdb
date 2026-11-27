/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { ObjectId, type Document, type WithId } from 'mongodb';
import { toTreeNodes } from './toTreeNodes';

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

describe('toTreeNodes', () => {
    it('1 doc -> tree data', () => {
        const tree = toTreeNodes([documents[0]], true);

        // 1 root node for 1 document
        expect(tree.filter((node) => node.parentKey === null)).toHaveLength(1);
        expect(tree).toHaveLength(11);
    });

    it('n docs -> tree data', () => {
        const tree = toTreeNodes(documents, true);

        // 4 root nodes for 4 documents
        expect(tree.filter((node) => node.parentKey === null)).toHaveLength(4);
        expect(tree).toHaveLength(39);
    });

    it('preserves root labels and retains _id fields in the tree', () => {
        const objectId = new ObjectId('000000000000000000000001');
        const tree = toTreeNodes(
            [{ _id: null }, {}, { _id: objectId }, { _id: false, nested: { _id: 'child' } }],
            true,
        );
        expect(tree.filter((node) => node.parentKey === null).map((node) => node.field)).toEqual([
            'null',
            '',
            objectId.toHexString(),
            'false',
        ]);
        expect(tree.filter((node) => node.field === '_id')).toHaveLength(4);
        expect(tree.find((node) => node.field === '_id' && node.depth === 2)?.value.display).toBe('child');
        expect(tree.find((node) => node.value.type === 'null')?.value.display).toBe('null');
    });

    it('emits unambiguous path keys in preorder, independent of root document position', () => {
        const document = { _id: 'stable', 'a.b': { '': null }, a: { b: false }, values: [{ x: 0 }] };
        const tree = toTreeNodes([document], true);
        expect(new Set(tree.map((node) => node.key)).size).toBe(tree.length);
        const rootKey = 'id:"stable"';
        expect(tree.find((node) => node.depth === 2 && node.field === '')?.key).toBe(
            JSON.stringify([rootKey, 'a.b', '']),
        );
        expect(tree.find((node) => node.field === 'x')?.key).toBe(JSON.stringify([rootKey, 'values', 0, 'x']));
        tree.forEach((node, index) => {
            if (node.parentKey !== null) {
                const parentIndex = tree.findIndex((parent) => parent.key === node.parentKey);
                expect(parentIndex).toBeLessThan(index);
                expect(tree[parentIndex].depth + 1).toBe(node.depth);
            }
        });
        const reordered = toTreeNodes([{ _id: 'other' }, document], true);
        expect(reordered.filter((node) => (JSON.parse(node.key) as readonly unknown[])[0] === rootKey)).toEqual(tree);
        expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
    });

    it('expands arrays only at the existing bound, with typed index segments and current labels', () => {
        const tree = toTreeNodes(
            [
                {
                    _id: 'root',
                    empty: [],
                    ten: Array.from({ length: 10 }, (_, i) => i),
                    eleven: Array(11).fill(null),
                },
            ],
            true,
        );
        const empty = tree.find((node) => node.field === 'empty');
        const ten = tree.find((node) => node.field === 'ten');
        const eleven = tree.find((node) => node.field === 'eleven');
        expect(empty).toMatchObject({ expandable: false, value: { display: '(elements: 0)', type: 'array' } });
        expect(ten).toMatchObject({ expandable: true, value: { display: '(elements: 10)', type: 'array' } });
        expect(eleven).toMatchObject({ expandable: false, value: { display: '(elements: 11)', type: 'array' } });
        expect(tree.filter((node) => node.parentKey === ten?.key)).toHaveLength(10);
        expect(tree.find((node) => node.field === 'ten[0]')?.key).toBe(JSON.stringify(['id:"root"', 'ten', 0]));
        expect(tree.filter((node) => node.parentKey === eleven?.key)).toHaveLength(0);
    });

    it('keeps all roots distinct for missing, duplicate and untrusted identities', () => {
        for (const trusted of [true, false]) {
            const tree = toTreeNodes([{ _id: 'same' }, { _id: 'same' }, {}], trusted);
            const roots = tree.filter((node) => node.parentKey === null);
            expect(roots.map((node) => node.key)).toEqual(['["pos:0"]', '["pos:1"]', '["pos:2"]']);
            expect(roots[2].expandable).toBe(false);
            expect(new Set(tree.map((node) => node.key)).size).toBe(tree.length);
        }
    });
});
