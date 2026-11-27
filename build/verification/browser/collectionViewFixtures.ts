/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentViewMode } from '../../../src/documentdb/DocumentViewMode';
import {
    fieldColumnKey,
    ROOT_ID_COLUMN_KEY,
    type TablePage,
    type TableRow,
    type TreeNode,
} from '../../../src/utils/documentGrid/types';
import { type CollectionViewWebviewConfigurationType } from '../../../src/webviews/documentdb/collectionView/collectionViewController';
import { type FixtureOutputs, type TypedRpcFixtures } from './core/fixtures';

type CollectionOutputs = FixtureOutputs['mongoClusters']['collectionView'];
type TablePageOutput = CollectionOutputs['getCurrentPageAsTable'];
type CollectionViewFixture = {
    readonly config?: Partial<CollectionViewWebviewConfigurationType>;
    readonly rpc: TypedRpcFixtures;
    readonly readiness?: {
        readonly selectors?: readonly string[];
        readonly noProgressbar?: boolean;
    };
} & (
    | {
          readonly tablePage: TablePage;
          readonly treeNodes?: never;
      }
    | {
          readonly tablePage?: never;
          readonly treeNodes: readonly TreeNode[];
      }
);

const mixedTypesPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('text'), label: 'text' },
        { key: fieldColumnKey('count'), label: 'count' },
        { key: fieldColumnKey('active'), label: 'active' },
        { key: fieldColumnKey('created'), label: 'created' },
        { key: fieldColumnKey('amount'), label: 'amount' },
        { key: fieldColumnKey('objectId'), label: 'objectId' },
        { key: fieldColumnKey('uuid'), label: 'uuid' },
        { key: fieldColumnKey('binary'), label: 'binary' },
        { key: fieldColumnKey('array'), label: 'array' },
        { key: fieldColumnKey('object'), label: 'object' },
        { key: fieldColumnKey('legacyUuid'), label: 'legacyUuid' },
    ],
    rows: [
        {
            rowKey: 'id:{"$oid":"000000000000000000000001"}',
            documentId: '{"$oid":"000000000000000000000001"}',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: '000000000000000000000001', type: 'objectid' },
                [fieldColumnKey('text')]: { display: 'fixture text', type: 'string' },
                [fieldColumnKey('count')]: { display: '7', type: 'int32' },
                [fieldColumnKey('active')]: { display: 'true', type: 'boolean' },
                [fieldColumnKey('created')]: { display: '2026-01-02T03:04:05.000Z', type: 'date' },
                [fieldColumnKey('amount')]: { display: '12.50', type: 'decimal128' },
                [fieldColumnKey('objectId')]: { display: '000000000000000000000002', type: 'objectid' },
                [fieldColumnKey('uuid')]: {
                    display: '00112233-4455-6677-8899-aabbccddeeff',
                    type: 'uuid',
                },
                [fieldColumnKey('binary')]: { display: 'AQI=', type: 'binary' },
                [fieldColumnKey('array')]: { display: 'array[3]', type: 'array' },
                [fieldColumnKey('object')]: { display: '{...}', type: 'object' },
                [fieldColumnKey('legacyUuid')]: {
                    display: '00112233-4455-6677-8899-aabbccddeeff',
                    type: 'uuid-legacy',
                },
            },
        },
        {
            rowKey: 'id:{"$binary":{"base64":"ABEiM0RVZneImaq7zN3u/w==","subType":"04"}}',
            documentId: '{"$binary":{"base64":"ABEiM0RVZneImaq7zN3u/w==","subType":"04"}}',
            cells: {
                [ROOT_ID_COLUMN_KEY]: {
                    display: '00112233-4455-6677-8899-aabbccddeeff',
                    type: 'uuid',
                },
                [fieldColumnKey('text')]: { display: '', type: 'string' },
                [fieldColumnKey('count')]: { display: '-4.5', type: 'double' },
                [fieldColumnKey('active')]: { display: 'false', type: 'boolean' },
                [fieldColumnKey('created')]: { display: '2026-01-03T00:00:00.000Z', type: 'date' },
                [fieldColumnKey('amount')]: { display: '0', type: 'long' },
                [fieldColumnKey('objectId')]: { display: '000000000000000000000003', type: 'objectid' },
                [fieldColumnKey('uuid')]: {
                    display: '00112233-4455-6677-8899-aabbccddee00',
                    type: 'uuid',
                },
                [fieldColumnKey('binary')]: { display: 'AwQ=', type: 'binary' },
                [fieldColumnKey('array')]: { display: 'array[0]', type: 'array' },
                [fieldColumnKey('object')]: { display: '{...}', type: 'object' },
            },
        },
    ],
};

const missingVsNullPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('value'), label: 'value' },
    ],
    rows: [
        {
            rowKey: 'id:"missing-value"',
            documentId: '"missing-value"',
            cells: { [ROOT_ID_COLUMN_KEY]: { display: 'missing-value', type: 'string' } },
        },
        {
            rowKey: 'id:"null-value"',
            documentId: '"null-value"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'null-value', type: 'string' },
                [fieldColumnKey('value')]: { display: 'null', type: 'null' },
            },
        },
        ...[
            { id: 'empty-string', display: '', type: 'string' },
            { id: 'false-value', display: 'false', type: 'boolean' },
            { id: 'zero-value', display: '0', type: 'int32' },
        ].map(({ id, display, type }): TablePageOutput['rows'][number] => ({
            rowKey: `id:${JSON.stringify(id)}`,
            documentId: JSON.stringify(id),
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: id, type: 'string' },
                [fieldColumnKey('value')]: { display, type },
            },
        })),
    ],
};

const heterogeneousPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('name'), label: 'name' },
        { key: fieldColumnKey('quantity'), label: 'quantity' },
        { key: fieldColumnKey('details'), label: 'details' },
        { key: fieldColumnKey('tags'), label: 'tags' },
    ],
    rows: [
        {
            rowKey: 'id:"heterogeneous-1"',
            documentId: '"heterogeneous-1"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'heterogeneous-1', type: 'string' },
                [fieldColumnKey('name')]: { display: 'Alpha', type: 'string' },
                [fieldColumnKey('quantity')]: { display: '4', type: 'int32' },
                [fieldColumnKey('tags')]: { display: 'array[2]', type: 'array' },
            },
        },
        {
            rowKey: 'id:"heterogeneous-2"',
            documentId: '"heterogeneous-2"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'heterogeneous-2', type: 'string' },
                [fieldColumnKey('name')]: { display: 'Beta', type: 'string' },
                [fieldColumnKey('details')]: { display: '{...}', type: 'object' },
            },
        },
        {
            rowKey: 'id:"heterogeneous-3"',
            documentId: '"heterogeneous-3"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'heterogeneous-3', type: 'string' },
                [fieldColumnKey('quantity')]: { display: 'unavailable', type: 'string' },
                [fieldColumnKey('details')]: { display: 'null', type: 'null' },
            },
        },
    ],
};

const deepRowKey = 'id:"deep-root"';
const deepRootKey = JSON.stringify([deepRowKey]);
const deepProfileKey = JSON.stringify([deepRowKey, 'profile']);
const deepAddressKey = JSON.stringify([deepRowKey, 'profile', 'address']);
const deepLocationKey = JSON.stringify([deepRowKey, 'profile', 'address', 'location']);
const deepNestingNodes: CollectionOutputs['getCurrentPageAsTree'] = [
    {
        key: deepRootKey,
        parentKey: null,
        depth: 0,
        field: '"deep-root"',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: JSON.stringify([deepRowKey, '_id']),
        parentKey: deepRootKey,
        depth: 1,
        field: '_id',
        value: { display: 'deep-root', type: 'string' },
        expandable: false,
    },
    {
        key: deepProfileKey,
        parentKey: deepRootKey,
        depth: 1,
        field: 'profile',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: deepAddressKey,
        parentKey: deepProfileKey,
        depth: 2,
        field: 'address',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: deepLocationKey,
        parentKey: deepAddressKey,
        depth: 3,
        field: 'location',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: JSON.stringify([deepRowKey, 'profile', 'address', 'location', 'coordinates']),
        parentKey: deepLocationKey,
        depth: 4,
        field: 'coordinates',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: JSON.stringify([deepRowKey, 'profile', 'address', 'location', 'coordinates', 'latitude']),
        parentKey: JSON.stringify([deepRowKey, 'profile', 'address', 'location', 'coordinates']),
        depth: 5,
        field: 'latitude',
        value: { display: '47.6062', type: 'double' },
        expandable: false,
    },
    {
        key: JSON.stringify([deepRowKey, 'profile', 'address', 'location', 'coordinates', 'longitude']),
        parentKey: JSON.stringify([deepRowKey, 'profile', 'address', 'location', 'coordinates']),
        depth: 5,
        field: 'longitude',
        value: { display: '-122.3321', type: 'double' },
        expandable: false,
    },
    {
        key: JSON.stringify(['id:"second-root"']),
        parentKey: null,
        depth: 0,
        field: '"second-root"',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: JSON.stringify(['id:"second-root"', '_id']),
        parentKey: JSON.stringify(['id:"second-root"']),
        depth: 1,
        field: '_id',
        value: { display: 'second-root', type: 'string' },
        expandable: false,
    },
];

const arraysRowKey = 'id:"arrays-root"';
const arraysRootKey = JSON.stringify([arraysRowKey]);
const emptyArrayKey = JSON.stringify([arraysRowKey, 'empty']);
const tenArrayKey = JSON.stringify([arraysRowKey, 'ten']);
const elevenArrayKey = JSON.stringify([arraysRowKey, 'eleven']);
const arrayNodes: CollectionOutputs['getCurrentPageAsTree'] = [
    {
        key: arraysRootKey,
        parentKey: null,
        depth: 0,
        field: '"arrays-root"',
        value: { display: '{...}', type: 'object' },
        expandable: true,
    },
    {
        key: JSON.stringify([arraysRowKey, '_id']),
        parentKey: arraysRootKey,
        depth: 1,
        field: '_id',
        value: { display: 'arrays-root', type: 'string' },
        expandable: false,
    },
    {
        key: emptyArrayKey,
        parentKey: arraysRootKey,
        depth: 1,
        field: 'empty',
        value: { display: '(elements: 0)', type: 'array' },
        expandable: false,
    },
    {
        key: tenArrayKey,
        parentKey: arraysRootKey,
        depth: 1,
        field: 'ten',
        value: { display: '(elements: 10)', type: 'array' },
        expandable: true,
    },
    ...Array.from(
        { length: 10 },
        (_, index): TreeNode => ({
            key: JSON.stringify([arraysRowKey, 'ten', index]),
            parentKey: tenArrayKey,
            depth: 2,
            field: `ten[${index}]`,
            value: { display: `${index}`, type: 'int32' },
            expandable: false,
        }),
    ),
    {
        key: elevenArrayKey,
        parentKey: arraysRootKey,
        depth: 1,
        field: 'eleven',
        value: { display: '(elements: 11)', type: 'array' },
        expandable: false,
    },
];

const page500Rows: TableRow[] = Array.from({ length: 500 }, (_, index): TableRow => {
    const documentId = JSON.stringify(`page-${index.toString().padStart(3, '0')}`);
    return {
        rowKey: `id:${documentId}`,
        documentId,
        cells: {
            [ROOT_ID_COLUMN_KEY]: { display: `page-${index.toString().padStart(3, '0')}`, type: 'string' },
            [fieldColumnKey('position')]: { display: `${index}`, type: 'int32' },
        },
    };
});
const page500: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('position'), label: 'position' },
    ],
    rows: page500Rows,
};

const htmlValuesPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('displayText'), label: 'displayText' },
    ],
    rows: [
        {
            rowKey: 'id:"html-looking"',
            documentId: '"html-looking"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'html-looking', type: 'string' },
                [fieldColumnKey('displayText')]: {
                    display: '<strong>display-only text</strong> &amp; literal angle brackets < >',
                    type: 'string',
                },
            },
        },
    ],
};

const emptyPage: TablePageOutput = {
    path: [],
    columns: [{ key: ROOT_ID_COLUMN_KEY, label: '_id' }],
    rows: [],
};

const noIdPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('name'), label: 'name' },
    ],
    rows: [
        {
            rowKey: 'pos:0',
            cells: {
                [fieldColumnKey('name')]: { display: 'Browse only', type: 'string' },
            },
        },
        {
            rowKey: 'id:"ordinary-target"',
            documentId: '"ordinary-target"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'ordinary-target', type: 'string' },
                [fieldColumnKey('name')]: { display: 'Ordinary target', type: 'string' },
            },
        },
    ],
};

const stepInPage: TablePageOutput = {
    ...heterogeneousPage,
    rows: heterogeneousPage.rows.map((row, index): TablePageOutput['rows'][number] => ({
        ...row,
        cells: {
            [ROOT_ID_COLUMN_KEY]: row.cells[ROOT_ID_COLUMN_KEY],
            [fieldColumnKey('name')]: row.cells[fieldColumnKey('name')],
            [fieldColumnKey('details')]: index === 0 ? { display: '{...}', type: 'object' } : undefined,
            [fieldColumnKey('tags')]: { display: index === 0 ? 'array[2]' : 'array[0]', type: 'array' },
        },
    })),
};
const nestedPage: TablePageOutput = {
    path: ['details'],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('nestedName'), label: 'nestedName' },
        { key: fieldColumnKey('child'), label: 'child' },
    ],
    rows: stepInPage.rows.map((row, index): TablePageOutput['rows'][number] => ({
        rowKey: row.rowKey,
        documentId: row.documentId,
        cells:
            index === 0
                ? {
                      [ROOT_ID_COLUMN_KEY]: row.cells[ROOT_ID_COLUMN_KEY],
                      [fieldColumnKey('nestedName')]: { display: 'nested Alpha', type: 'string' },
                      [fieldColumnKey('child')]: { display: '{...}', type: 'object' },
                  }
                : { [ROOT_ID_COLUMN_KEY]: row.cells[ROOT_ID_COLUMN_KEY] },
    })),
};
const leafPage: TablePageOutput = {
    ...nestedPage,
    path: ['details', 'child'],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('leafName'), label: 'leafName' },
    ],
    rows: nestedPage.rows.map((row, index): TablePageOutput['rows'][number] => ({
        rowKey: row.rowKey,
        documentId: row.documentId,
        cells: {
            [ROOT_ID_COLUMN_KEY]: row.cells[ROOT_ID_COLUMN_KEY],
            ...(index === 0 ? { [fieldColumnKey('leafName')]: { display: 'leaf Alpha', type: 'string' } } : {}),
        },
    })),
};
const stepInRpc = {
    'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 3 }] },
    'mongoClusters.collectionView.getCurrentPageAsTable': {
        type: 'query',
        results: [stepInPage],
        cases: [
            { input: ['details'], results: [nestedPage] },
            { input: ['details', 'child'], results: [leafPage] },
        ],
    },
} satisfies TypedRpcFixtures;

const identityPage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('name'), label: 'name' },
    ],
    rows: [
        { id: 'null', display: 'null', type: 'null', name: 'Null ID' },
        { id: '{"$numberInt":"0"}', display: '0', type: 'int32', name: 'Zero ID' },
        { id: 'false', display: 'false', type: 'boolean', name: 'False ID' },
        { id: '""', display: '', type: 'string', name: 'Empty ID' },
        { id: '{"tenant":{"$numberInt":"1"}}', display: '{...}', type: 'object', name: 'Composite ID' },
    ].map(({ id, display, type, name }): TablePageOutput['rows'][number] => ({
        rowKey: `id:${id}`,
        documentId: id,
        cells: {
            [ROOT_ID_COLUMN_KEY]: { display, type },
            [fieldColumnKey('name')]: { display: name, type: 'string' },
        },
    })),
};

const arrayTablePage: TablePageOutput = {
    path: [],
    columns: [
        { key: ROOT_ID_COLUMN_KEY, label: '_id' },
        { key: fieldColumnKey('ten'), label: 'ten' },
    ],
    rows: [
        {
            rowKey: arraysRowKey,
            documentId: '"arrays-root"',
            cells: {
                [ROOT_ID_COLUMN_KEY]: { display: 'arrays-root', type: 'string' },
                [fieldColumnKey('ten')]: { display: 'array[10]', type: 'array' },
            },
        },
    ],
};
const arrayJsonDocuments: CollectionOutputs['getCurrentPageAsJson'] = [
    JSON.stringify({
        _id: 'arrays-root',
        empty: [],
        ten: Array.from({ length: 10 }, (_, index): number => index),
        eleven: Array.from({ length: 11 }, (_, index): number => index),
    }),
];
const heterogeneousTreeNodes: CollectionOutputs['getCurrentPageAsTree'] = heterogeneousPage.rows.flatMap(
    (row): CollectionOutputs['getCurrentPageAsTree'] => [
        {
            key: JSON.stringify([row.rowKey]),
            parentKey: null,
            depth: 0,
            field: row.documentId ?? '',
            value: { display: '{...}', type: 'object' },
            expandable: true,
        },
        {
            key: JSON.stringify([row.rowKey, '_id']),
            parentKey: JSON.stringify([row.rowKey]),
            depth: 1,
            field: '_id',
            value: { display: row.cells[ROOT_ID_COLUMN_KEY]?.display ?? '', type: 'string' },
            expandable: false,
        },
    ],
);

export const collectionViewFixtures = {
    'mixed-types': {
        tablePage: mixedTypesPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: mixedTypesPage.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [mixedTypesPage],
            },
        },
    },
    'missing-vs-null': {
        tablePage: missingVsNullPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: missingVsNullPage.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [missingVsNullPage],
            },
        },
    },
    heterogeneous: {
        tablePage: heterogeneousPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: heterogeneousPage.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [heterogeneousPage],
            },
        },
    },
    'deep-nesting': {
        config: { initialDocumentView: DocumentViewMode.TREE },
        treeNodes: deepNestingNodes,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 2 }] },
            'mongoClusters.collectionView.getCurrentPageAsTree': {
                type: 'query',
                results: [deepNestingNodes],
            },
        },
    },
    arrays: {
        config: { initialDocumentView: DocumentViewMode.TREE },
        treeNodes: arrayNodes,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 1 }] },
            'mongoClusters.collectionView.getCurrentPageAsTree': {
                type: 'query',
                results: [arrayNodes],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [arrayTablePage] },
            'mongoClusters.collectionView.getCurrentPageAsJson': {
                type: 'query',
                results: [arrayJsonDocuments],
            },
        },
    },
    'page-500': {
        config: { defaultPageSize: 500 },
        tablePage: page500,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: page500.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [page500],
            },
        },
    },
    'html-values': {
        tablePage: htmlValuesPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: htmlValuesPage.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [htmlValuesPage],
            },
        },
    },
    empty: {
        tablePage: emptyPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 0 }] },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [emptyPage],
            },
        },
    },
    'no-id': {
        tablePage: noIdPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: noIdPage.rows.length }],
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [noIdPage],
            },
        },
    },
    'first-load': {
        tablePage: emptyPage,
        readiness: {
            selectors: ['.collectionView', '.monaco-editor'],
            noProgressbar: false,
        },
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [],
                keepOpen: true,
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                type: 'query',
                results: [emptyPage],
            },
        },
    },
    'step-in': { tablePage: stepInPage, rpc: stepInRpc },
    selection: {
        tablePage: heterogeneousPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 3 }] },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [heterogeneousPage] },
            'mongoClusters.collectionView.getCurrentPageAsTree': { type: 'query', results: [heterogeneousTreeNodes] },
        },
    },
    identity: {
        tablePage: identityPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 5 }] },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [identityPage] },
        },
    },
    'late-delete': {
        tablePage: heterogeneousPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 3 }] },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [heterogeneousPage] },
            'mongoClusters.collectionView.deleteDocumentsById': {
                type: 'mutation',
                results: [true],
                hold: 'delete-alpha',
            },
        },
    },
    'late-query': {
        tablePage: stepInPage,
        rpc: {
            ...stepInRpc,
            'mongoClusters.collectionView.getCurrentPageAsTable': {
                ...stepInRpc['mongoClusters.collectionView.getCurrentPageAsTable'],
                cases: [{ input: ['details'], results: [nestedPage], hold: 'old-details' }],
            },
        },
    },
    'loading-to-results': {
        tablePage: heterogeneousPage,
        readiness: { selectors: ['.collectionView', '.monaco-editor'], noProgressbar: false },
        rpc: {
            'mongoClusters.collectionView.runFindQuery': {
                type: 'query',
                results: [{ documentCount: 3 }],
                hold: 'initial-results',
            },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [heterogeneousPage] },
        },
    },
    paging: {
        config: { defaultPageSize: 10 },
        tablePage: heterogeneousPage,
        rpc: {
            'mongoClusters.collectionView.runFindQuery': { type: 'query', results: [{ documentCount: 3 }] },
            'mongoClusters.collectionView.getCurrentPageAsTable': { type: 'query', results: [heterogeneousPage] },
            'mongoClusters.collectionView.getCurrentPageAsTree': { type: 'query', results: [heterogeneousTreeNodes] },
        },
    },
} as const satisfies Readonly<
    Record<
        | 'mixed-types'
        | 'missing-vs-null'
        | 'heterogeneous'
        | 'deep-nesting'
        | 'arrays'
        | 'page-500'
        | 'html-values'
        | 'empty'
        | 'no-id'
        | 'first-load'
        | 'step-in'
        | 'selection'
        | 'identity'
        | 'late-delete'
        | 'late-query'
        | 'loading-to-results'
        | 'paging',
        CollectionViewFixture
    >
>;
