/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { escapeMarkdown } from '../../webviews/utils/escapeMarkdown';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { IndexItem } from './IndexItem';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (values: string[]) => values.join(';'),
    createGenericElement: (value: unknown) => value,
}));

jest.mock('../../documentdb/SchemaStore', () => ({ SchemaStore: jest.fn() }));

const cluster = {
    treeId: 'tree',
    clusterId: 'cluster',
    dbExperience: { api: 'MongoDB' } as unknown as Experience,
} as TreeCluster<BaseClusterModel>;
const database: DatabaseItemModel = { name: 'database' };
const collection: CollectionItemModel = { name: 'collection' };

function createItem(overrides: Partial<IndexItemModel>): IndexItem {
    return new IndexItem(cluster, database, collection, {
        name: 'test_index',
        type: 'traditional',
        key: { customerId: 1 },
        ...overrides,
    });
}

describe('IndexItem copy presentation', () => {
    it('marks hidden ordinary indexes as copyable', () => {
        const item = createItem({ hidden: true });

        expect(item.contextValue).toContain('state_copyable');
        expect(item.contextValue).toContain('state_hidden');
        expect(item.getTreeItem().description).toBe('(hidden)');
    });

    it('keeps the built-in _id index out of the copyable state', () => {
        const item = createItem({ name: '_id_', key: { _id: 1 } });

        expect(item.contextValue).toContain('state_default');
        expect(item.contextValue).not.toContain('state_copyable');
    });

    it('explains and collapses a keyless vector search index', async () => {
        const item = createItem({
            type: 'vectorSearch',
            key: undefined,
            hidden: true,
            status: 'READY',
            queryable: true,
        });
        const treeItem = item.getTreeItem();
        const tooltip = treeItem.tooltip as vscode.MarkdownString;

        expect(item.contextValue).not.toContain('state_copyable');
        expect(treeItem.description).toBe('(vector search, hidden)');
        expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect(tooltip.value).toContain('This vector search index cannot be copied by Copy/Paste Indexes\\.');
        expect(tooltip.value).toContain('**Status:** READY');
        expect(tooltip.value).toContain('**Queryable:** Yes');
        await expect(item.getChildren()).resolves.toEqual([]);
    });
});

describe('IndexItem tooltip metadata', () => {
    it('explicitly disables command trust, HTML, and theme icons', () => {
        const tooltip = createItem({}).getTreeItem().tooltip as vscode.MarkdownString;

        expect(tooltip.isTrusted).toBe(false);
        expect(tooltip.supportHtml).toBe(false);
        expect(tooltip.supportThemeIcons).toBe(false);
    });

    it('escapes bare URLs and theme icon syntax in names and statuses', () => {
        const name = 'https://example.invalid/login $(warning)';
        const status = 'ftp://example.invalid $(pass) READY';
        const tooltip = createItem({ name, status }).getTreeItem().tooltip as vscode.MarkdownString;

        expect(tooltip.value).toContain('### https\\://example\\.invalid/login $\\(warning\\)\n\n');
        expect(tooltip.value).toContain('**Status:** ftp\\://example\\.invalid $\\(pass\\) READY  \n');
        expect(tooltip.value).not.toContain('https://');
        expect(tooltip.value).not.toContain('ftp://');
        expect(tooltip.supportThemeIcons).toBe(false);
    });

    it('escapes link and HTML syntax in names and statuses without changing the model', () => {
        const name = '[example](command:example.inspect) <b>index</b> & `name`';
        const status = '[example](https://example.invalid/status) <i>ready</i> & `status`';
        const item = createItem({ name, status });
        const treeItem = item.getTreeItem();
        const tooltip = treeItem.tooltip as vscode.MarkdownString;

        expect(tooltip.value).toContain(`### ${escapeMarkdown(name)}\n\n`);
        expect(tooltip.value).toContain(`**Status:** ${escapeMarkdown(status)}  \n`);
        expect(tooltip.value).not.toContain(name);
        expect(tooltip.value).not.toContain(status);
        expect(treeItem.label).toBe(name);
        expect(item.indexInfo.name).toBe(name);
        expect(item.indexInfo.status).toBe(status);
        expect(item.contextValue).toContain('state_copyable');
    });

    it('escapes converted runtime strings in property values', () => {
        const value = '[example](command:example.inspect) <b>value</b>';
        const tooltip = createItem({
            version: value as unknown as number,
            expireAfterSeconds: value as unknown as number,
        }).getTreeItem().tooltip as vscode.MarkdownString;

        expect(tooltip.value).toContain(`**Version:** ${escapeMarkdown(`v${value}`)}  \n`);
        expect(tooltip.value).toContain(`**TTL:** ${escapeMarkdown(`${value}s`)}  \n`);
        expect(tooltip.value).not.toContain(value);
    });

    it('retains ordinary inline keys, orders, badges, and properties', async () => {
        const item = createItem({
            name: 'ordinary',
            key: { customerId: 1, createdAt: -1, location: '2dsphere' },
            version: 2,
            status: 'READY',
            queryable: true,
            unique: true,
            sparse: true,
            hidden: true,
            expireAfterSeconds: 60,
        });
        const treeItem = item.getTreeItem();
        const tooltip = treeItem.tooltip as vscode.MarkdownString;

        expect(tooltip.value).toContain('### ordinary\n\n');
        expect(tooltip.value).toContain('`traditional` | `unique` | `sparse` | `hidden`');
        expect(tooltip.value).toContain('`customerId`: asc, `createdAt`: desc, `location`: 2dsphere');
        expect(tooltip.value).toContain('**Version:** v2');
        expect(tooltip.value).toContain('**Status:** READY');
        expect(tooltip.value).toContain('**Queryable:** Yes');
        expect(tooltip.value).toContain('**TTL:** 60s');
        expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
        expect(item.contextValue).toContain('state_copyable');
        const children = (await item.getChildren()).map((child) => child as unknown as vscode.TreeItem);
        expect(children.map((child) => [child.label, child.description])).toEqual([
            ['customerId', 'asc'],
            ['createdAt', 'desc'],
            ['location', '2dsphere'],
        ]);
    });

    it.each([
        ['tick`field', '``tick`field``'],
        ['`edge`', '`` `edge` ``'],
        ['field```ticks', '````field```ticks````'],
        [' spaced field ', '`  spaced field  `'],
        ['   ', '`   `'],
        ['line\n\n```\nfield', '````"line\\n\\n```\\nfield"````'],
        ['line\r\nfield', '`"line\\r\\nfield"`'],
        ['[example](command:example.inspect)', '`[example](command:example.inspect)`'],
    ])('safely delimits the inline key %j', (field, rendered) => {
        const order = '[example](command:example.inspect) <b>order</b> `ticks`\n\n```\nend';
        const key = { [field]: order };
        const item = createItem({ key });
        const tooltip = item.getTreeItem().tooltip as vscode.MarkdownString;

        expect(tooltip.value).toContain(`${rendered}: ${escapeMarkdown(order)}\n\n`);
        expect(tooltip.value).not.toContain(order);
        expect(item.indexInfo.key).toBe(key);
    });

    it.each(['definition', 'partial filter', 'search fields'] as const)(
        'keeps synthetic fence-like metadata within the %s JSON block',
        (section) => {
            const field = 'line\n\n```\n[example](command:example.inspect)';
            const value = 'text\n`````\n<b>example</b>';
            const definition = { [field]: value, ordinary: 1, descending: -1, text: 'text' };
            const partialFilterExpression = { [field]: { $eq: value } };
            const fields = [{ name: field, definition: { value } }];
            let overrides: Partial<IndexItemModel>;
            let expected: object;
            let heading: string;
            switch (section) {
                case 'definition':
                    overrides = { key: definition };
                    expected = definition;
                    heading = '**Index Definition**';
                    break;
                case 'partial filter':
                    overrides = { partialFilterExpression };
                    expected = partialFilterExpression;
                    heading = '**Partial Filter Expression**';
                    break;
                case 'search fields':
                    overrides = { type: 'search', key: undefined, fields };
                    expected = fields;
                    heading = '**Search Fields**';
                    break;
            }
            const item = createItem(overrides);
            const tooltip = item.getTreeItem().tooltip as vscode.MarkdownString;
            const block = tooltip.value.match(/(`{3,})json\n([\s\S]*?)\n\1\n\n/);

            expect(tooltip.value).toContain(heading);
            expect(block).not.toBeNull();
            const [, , json] = block!;
            expect(json).toBe(JSON.stringify(expected, null, 2));
            expect(JSON.parse(json) as unknown).toEqual(expected);
            expect(json).not.toContain(field);
            expect(json).not.toContain(value);
            expect(json.split('\n').some((line) => /^\s*`{3,}/.test(line))).toBe(false);
            expect(tooltip.isTrusted).toBe(false);
            expect(tooltip.supportHtml).toBe(false);
        },
    );

    it('retains ordinary JSON presentation for definitions, partial filters, and search fields', () => {
        const key = { first: 1, second: -1, third: 'text', fourth: 1 };
        const partialFilterExpression = { enabled: true };
        const fields = [{ name: 'title', type: 'string' }];
        const tooltip = createItem({ key, partialFilterExpression, fields }).getTreeItem()
            .tooltip as vscode.MarkdownString;

        for (const value of [key, partialFilterExpression, fields]) {
            expect(tooltip.value).toContain(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n`);
        }
    });
});
