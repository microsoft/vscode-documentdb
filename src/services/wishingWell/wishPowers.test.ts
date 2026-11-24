/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

const { client, schema } = vi.hoisted(() => ({
    client: {
        runFindQuery: vi.fn(),
        estimateDocumentCount: vi.fn(),
        aggregateRows: vi.fn(),
        listCollections: vi.fn(),
        getSampleDocuments: vi.fn(),
        listDatabases: vi.fn(),
    },
    /** Known field paths by "database.collection", standing in for the SchemaStore cache. */
    schema: new Map<string, string[]>(),
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: vi.fn(async () => ({
            ...client,
            getMongoClient: () => ({
                db: () => ({
                    collection: (collection: string) => ({
                        aggregate: (pipeline: Document[], options: unknown) => ({
                            toArray: () => client.aggregateRows(collection, pipeline, options),
                        }),
                    }),
                }),
            }),
        })),
    },
}));

vi.mock('../../documentdb/SchemaStore', () => ({
    SchemaStore: {
        getInstance: () => ({
            getKnownFields: (_clusterId: string, database: string, collection: string) =>
                (schema.get(`${database}.${collection}`) ?? []).map((path) => ({ path, type: 'string' })),
            addDocuments: (_clusterId: string, database: string, collection: string, documents: Document[]) =>
                schema.set(`${database}.${collection}`, Object.keys(documents[0] ?? {})),
        }),
    },
}));

vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: { error: vi.fn() } } }));
vi.mock('../../commands/openCollectionView/openCollectionView', () => ({ openCollectionViewInternal: vi.fn() }));
vi.mock('../../commands/playground/newPlayground', () => ({
    newPlaygroundWithContent: vi.fn(),
    newUnboundPlayground: vi.fn(),
}));
vi.mock('../../webviews/documentdb/clusterDashboard/resolveNamespaceNode', () => ({
    resolveClusterNode: vi.fn(),
    resolveNamespaceNode: vi.fn(),
}));
vi.mock('../../tree/connections-view/connectionsViewHelpers', () => ({ revealInConnectionsView: vi.fn() }));

import { openCollectionViewInternal } from '../../commands/openCollectionView/openCollectionView';
import { newPlaygroundWithContent } from '../../commands/playground/newPlayground';
import { toFilterQueryObj } from '../../documentdb/utils/toFilterQuery';
import { ext } from '../../extensionVariables';
import { resolveNamespaceNode } from '../../webviews/documentdb/clusterDashboard/resolveNamespaceNode';
import { parseSpell, type Spell } from './wishEngine';
import { createWishPowers, documentsText, grantConfirmation } from './wishPowers';
import { type WishScope } from './wishScope';

const shop: WishScope = {
    cluster: { clusterId: 'c1', clusterDisplayName: 'prod', viewId: 'connectionsView' },
    databaseName: 'shop',
};

/** `true` once the promise settles, `false` if it is still pending a moment later. */
async function settlesSoon(promise: Promise<unknown>): Promise<boolean> {
    const pending = Symbol('pending');
    const first = await Promise.race([
        promise.then(
            () => undefined,
            () => undefined,
        ),
        new Promise((resolve) => setTimeout(() => resolve(pending), 50)),
    ]);
    return first !== pending;
}

describe('documentsText', () => {
    const documents = Array.from({ length: 10 }, (_, index) => ({ _id: index, note: 'x'.repeat(40) }));

    it('formats like EJSON.stringify when everything fits', () => {
        expect(documentsText(documents)).toEqual({
            text: EJSON.stringify(documents, undefined, 2, { relaxed: true }),
            shown: 10,
            summarized: false,
        });
        expect(documentsText([])).toEqual({ text: '[]', shown: 0, summarized: false });
    });

    it('cuts on a document boundary within the cap, so the text still parses', () => {
        const { text, shown } = documentsText(documents, 300);
        expect(text.length).toBeLessThanOrEqual(300);
        expect(shown).toBeGreaterThan(0);
        expect(shown).toBeLessThan(10);
        expect(JSON.parse(text)).toEqual(documents.slice(0, shown));
    });

    it('keeps the first document whole even when it alone is over the cap', () => {
        const big = [{ big: 'y'.repeat(500) }, { small: 1 }];
        const { text, shown } = documentsText(big, 100);
        expect(shown).toBe(1);
        expect(JSON.parse(text)).toEqual([big[0]]);
    });
});

describe('grantConfirmation', () => {
    it('names the exact link, not what the agent says about it', () => {
        expect(
            grantConfirmation({ kind: 'link', url: 'https://example.com/x', title: 'Docs', message: 'Read the docs' }),
        ).toEqual({
            message: 'An agent wants to open a web page in your browser: https://example.com/x',
            detail: 'The agent says: Read the docs',
            label: 'Open link',
        });
    });

    it('shows the prompt handed to Copilot and the command an agent runs', () => {
        expect(grantConfirmation({ kind: 'agent', prompt: 'rm the repo', title: 't', message: 'm' })).toMatchObject({
            detail: 'rm the repo',
            label: 'Hand to Copilot',
        });
        expect(
            grantConfirmation({
                kind: 'command',
                commandId: 'workbench.extensions.search',
                argument: 'Prettier',
                title: 't',
                message: 'm',
            }).message,
        ).toBe('An agent wants to run "Search extensions" with "Prettier" in VS Code.');
    });
});

describe('confirmGrant', () => {
    const link = { kind: 'link', url: 'https://example.com', title: 't', message: 'm' } as const;

    it('asks with a modal and grants only on its own button', async () => {
        const ask = vi.mocked(vscode.window.showWarningMessage);
        ask.mockResolvedValueOnce('Open link' as never);
        await expect(createWishPowers().confirmGrant(link)).resolves.toBe(true);
        expect(ask).toHaveBeenLastCalledWith(
            'An agent wants to open a web page in your browser: https://example.com',
            { modal: true, detail: 'The agent says: m' },
            'Open link',
        );

        ask.mockResolvedValueOnce(undefined);
        await expect(createWishPowers().confirmGrant(link)).resolves.toBe(false);
    });
});

describe('read', () => {
    const rows = (count: number, size = 1): Document[] =>
        Array.from({ length: count }, (_, index) => ({ _id: index, note: 'x'.repeat(size) }));

    it('reads one row past the default for a find without a limit, to tell whether the cap cut it', async () => {
        client.runFindQuery.mockResolvedValueOnce(rows(21));
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', title: 't', message: 'm' },
            shop,
        );
        expect(client.runFindQuery).toHaveBeenLastCalledWith(
            'shop',
            'orders',
            expect.objectContaining({ limit: 21 }),
            expect.anything(),
        );
        expect(result).toMatchObject({ count: 20, capped: true, truncated: false });
    });

    it('takes a limit the wish asked for as the answer, not as a cap', async () => {
        client.runFindQuery.mockResolvedValueOnce(rows(5));
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 5, title: 't', message: 'm' },
            shop,
        );
        expect(client.runFindQuery).toHaveBeenLastCalledWith(
            'shop',
            'orders',
            expect.objectContaining({ limit: 5 }),
            expect.anything(),
        );
        expect(result).toMatchObject({ count: 5, capped: false });
    });

    it('says more rows exist when the wish asked for more than the cap', async () => {
        client.runFindQuery.mockResolvedValueOnce(rows(51));
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 100, title: 't', message: 'm' },
            shop,
        );
        expect(client.runFindQuery).toHaveBeenLastCalledWith(
            'shop',
            'orders',
            expect.objectContaining({ limit: 51 }),
            expect.anything(),
        );
        expect(result).toMatchObject({ count: 50, capped: true });
    });

    it('marks a read whose document had to be summarized as cut', async () => {
        client.runFindQuery.mockResolvedValueOnce([{ _id: 1, blob: 'x'.repeat(20_000) }]);
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 1, title: 't', message: 'm' },
            shop,
        );
        expect(result).toMatchObject({ count: 1, truncated: true, summarized: true });
    });

    it('says apart whether the rows hit the cap and whether the text was cut', async () => {
        const aggregate = {
            kind: 'aggregate',
            collection: 'orders',
            pipeline: '[]',
            title: 't',
            message: 'm',
        } as const;

        client.aggregateRows.mockResolvedValueOnce(rows(51));
        await expect(createWishPowers().read(aggregate, shop)).resolves.toMatchObject({
            count: 50,
            capped: true,
            truncated: false,
        });

        client.aggregateRows.mockResolvedValueOnce(rows(3, 4000));
        const result = await createWishPowers().read(aggregate, shop);
        expect(result).toMatchObject({ count: 3, capped: false, truncated: true });
        expect(JSON.parse(result.text)).toEqual(rows(1, 4000));
    });

    it('gives a find the same time limit and cancel signal as an aggregate', async () => {
        client.runFindQuery.mockResolvedValueOnce([]);
        const signal = new AbortController().signal;
        await createWishPowers().read({ kind: 'find', collection: 'orders', title: 't', message: 'm' }, shop, signal);
        expect(client.runFindQuery).toHaveBeenLastCalledWith('shop', 'orders', expect.anything(), {
            maxTimeMS: 20_000,
            signal,
        });
    });

    it.each(['find', 'aggregate'] as const)('says in plain words that the %s ran out of time', async (kind) => {
        const timedOut = Object.assign(new Error('Executor error :: caused by :: operation exceeded time limit'), {
            code: 50,
        });
        const spell =
            kind === 'find'
                ? ({ kind, collection: 'orders', title: 't', message: 'm' } as const)
                : ({ kind, collection: 'orders', pipeline: '[]', title: 't', message: 'm' } as const);
        (kind === 'find' ? client.runFindQuery : client.aggregateRows).mockRejectedValueOnce(timedOut);
        await expect(createWishPowers().read(spell, shop)).rejects.toThrow(
            'The read ran longer than 20 seconds, so the server stopped it.',
        );
    });

    it('passes any other read error through as it is', async () => {
        client.runFindQuery.mockRejectedValueOnce(new Error('Invalid filter syntax'));
        await expect(
            createWishPowers().read({ kind: 'find', collection: 'orders', title: 't', message: 'm' }, shop),
        ).rejects.toThrow('Invalid filter syntax');
    });

    it('reads Extended JSON dates and ids as dates and ids, even from a spell no parser saw', async () => {
        client.runFindQuery.mockResolvedValueOnce([]);
        await createWishPowers().read(
            {
                kind: 'find',
                collection: 'orders',
                filter: '{"at":{"$gte":{"$date":"2024-01-01T00:00:00Z"}},"_id":{"$oid":"6b04df29e0e56cfc21895da6"}}',
                sort: '{"at":-1}',
                title: 't',
                message: 'm',
            },
            shop,
        );
        const [, , query] = client.runFindQuery.mock.lastCall as [string, string, { filter: string; sort: string }];
        const filter = toFilterQueryObj(query.filter) as unknown as {
            at: { $gte: unknown };
            _id: { toHexString(): string };
        };
        expect(filter.at.$gte).toEqual(new Date('2024-01-01T00:00:00Z'));
        expect(filter._id.toHexString()).toBe('6b04df29e0e56cfc21895da6');
        expect(query.sort).toBe('{"at":-1}');
    });
});

describe('drawFromCluster', () => {
    it('shows a fished document whole when it fits, and summarizes long values when it does not', async () => {
        const small = { _id: 1, note: 'z'.repeat(100) };
        const big = { _id: 2, note: 'z'.repeat(10_000) };
        client.estimateDocumentCount.mockResolvedValue(1);
        client.runFindQuery.mockResolvedValueOnce([small]).mockResolvedValueOnce([big]);
        const scope = { ...shop, collectionName: 'orders' };
        const first = await createWishPowers().drawFromCluster('document', scope, () => 0);
        expect(JSON.parse(first?.detail ?? '')).toEqual(small);
        const second = await createWishPowers().drawFromCluster('document', scope, () => 0);
        const parsed = JSON.parse(second?.detail ?? '') as { _id: number; note: string };
        expect(parsed._id).toBe(2);
        expect(parsed.note).toContain('characters not shown');
    });
});

describe('cast', () => {
    const context = { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;
    const find = (fields: string): Spell => {
        const spell = parseSpell(`{"spell":"find","collection":"orders",${fields}"title":"t","message":"m"}`);
        if (!spell) {
            throw new Error('the find spell did not parse');
        }
        return spell;
    };

    it.each([
        ['', undefined],
        ['"filter":{"a":1},', { filter: '{"a":1}', project: undefined, sort: undefined, limit: undefined }],
        ['"limit":5,', { filter: undefined, project: undefined, sort: undefined, limit: 5 }],
    ])('opens the collection view with a limit only when the wish named one: %s', async (fields, initialQuery) => {
        await createWishPowers().cast(find(fields), shop, context);
        expect(vi.mocked(openCollectionViewInternal)).toHaveBeenLastCalledWith(
            context,
            expect.objectContaining({ databaseName: 'shop', collectionName: 'orders', initialQuery }),
        );
    });

    it('opens the collection view with ids it can parse, even from a spell no parser saw', async () => {
        const spell: Spell = {
            kind: 'collectionView',
            collection: 'orders',
            filter: '{"_id":{"$oid":"6b04df29e0e56cfc21895da6"}}',
            title: 't',
            message: 'm',
        };
        await createWishPowers().cast(spell, shop, context);
        expect(vi.mocked(openCollectionViewInternal)).toHaveBeenLastCalledWith(
            context,
            expect.objectContaining({
                initialQuery: expect.objectContaining({ filter: '{"_id":ObjectId("6b04df29e0e56cfc21895da6")}' }),
            }),
        );
    });

    it('opens an aggregate in a playground with shell dates, not $date sub-documents', async () => {
        const spell: Spell = {
            kind: 'aggregate',
            collection: 'orders',
            pipeline: '[{"$match":{"at":{"$gte":{"$date":"2024-01-01T00:00:00Z"}}}}]',
            title: 't',
            message: 'm',
        };
        await createWishPowers().cast(spell, shop, context);
        const content = vi.mocked(newPlaygroundWithContent).mock.lastCall?.[1]?.content ?? '';
        const prefix = "db.getCollection('orders').aggregate(";
        expect(content.startsWith(prefix)).toBe(true);
        const pipeline = parseShellBSON(content.slice(prefix.length, -1), { mode: ParseMode.Loose }) as [
            { $match: { at: { $gte: unknown } } },
        ];
        expect(pipeline[0].$match.at.$gte).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('opens a pipeline shell syntax cannot write through EJSON.parse, so it finds what the read found', async () => {
        const pipeline =
            '[{"$match":{"ts":{"$gte":{"$timestamp":{"t":1700000000,"i":0}}},"at":{"$gte":{"$date":"2024-01-01T00:00:00Z"}}}}]';
        await createWishPowers().cast(
            { kind: 'aggregate', collection: 'orders', pipeline, title: 't', message: 'm' },
            shop,
            context,
        );
        const content = vi.mocked(newPlaygroundWithContent).mock.lastCall?.[1]?.content ?? '';
        const literal =
            /^db\.getCollection\('orders'\)\.aggregate\(EJSON\.parse\((".*"), \{ relaxed: false \}\)\)$/s.exec(
                content,
            )?.[1];
        expect(literal).toBeDefined();
        expect(EJSON.parse(JSON.parse(literal ?? '""') as string, { relaxed: false })).toEqual(
            EJSON.parse(pipeline, { relaxed: false }),
        );
    });

    describe('a grant that waits on the user', () => {
        const executeCommand = vi.mocked(vscode.commands.executeCommand);
        const exportOrders: Spell = { kind: 'tool', tool: 'export', collection: 'orders', title: 't', message: 'm' };
        const pickTheme: Spell = {
            kind: 'command',
            commandId: 'workbench.action.selectTheme',
            title: 't',
            message: 'm',
        };

        beforeEach(() => {
            executeCommand.mockReset();
            vi.mocked(resolveNamespaceNode).mockReset();
            vi.mocked(ext.outputChannel.error).mockClear();
            vi.mocked(vscode.window.showErrorMessage).mockClear();
        });

        it('starts a wizard on the tree node and returns before the user finishes it', async () => {
            vi.mocked(resolveNamespaceNode).mockResolvedValueOnce({ id: 'orders' } as never);
            executeCommand.mockReturnValueOnce(new Promise(() => undefined));
            expect(await settlesSoon(createWishPowers().cast(exportOrders, shop, context))).toBe(true);
            expect(executeCommand).toHaveBeenCalledWith('vscode-documentdb.command.exportDocuments', { id: 'orders' });
        });

        it('starts a command and returns before its picker closes', async () => {
            executeCommand.mockReturnValueOnce(new Promise(() => undefined));
            expect(await settlesSoon(createWishPowers().cast(pickTheme, shop, context))).toBe(true);
            expect(executeCommand).toHaveBeenCalledWith('workbench.action.selectTheme');
        });

        it('still fails, and starts nothing, when the tree node cannot be found', async () => {
            await expect(createWishPowers().cast(exportOrders, shop, context)).rejects.toThrow(
                'Expand prod in the DocumentDB side bar, then grant the wish again.',
            );
            expect(executeCommand).not.toHaveBeenCalled();
        });

        it('logs a command that fails after it started and shows no second error', async () => {
            executeCommand.mockRejectedValueOnce(new Error('boom'));
            await createWishPowers().cast(pickTheme, shop, context);
            await vi.waitFor(() =>
                expect(ext.outputChannel.error).toHaveBeenCalledWith(
                    '[Wishing Well] workbench.action.selectTheme failed: boom',
                ),
            );
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        });

        it('still waits for the new-document editor, which returns once it is open', async () => {
            let opened: () => void = () => undefined;
            executeCommand.mockReturnValueOnce(new Promise<void>((resolve) => (opened = resolve)));
            const cast = createWishPowers().cast(
                { kind: 'newDocument', collection: 'orders', title: 't', message: 'm' },
                shop,
                context,
            );
            expect(await settlesSoon(cast)).toBe(false);
            opened();
            await expect(cast).resolves.toBeUndefined();
        });
    });
});

describe('describeScope', () => {
    const names = ['customers', 'orders', 'products', 'reviews', 'wishes', 'carts'];
    const listCollections = (list: string[]): void => {
        client.listCollections.mockResolvedValue(list.map((name) => ({ name, type: 'collection' })));
    };

    beforeEach(() => {
        schema.clear();
        listCollections(names);
        client.listDatabases.mockResolvedValue([{ name: 'shop' }]);
        client.getSampleDocuments.mockReset();
        client.getSampleDocuments.mockImplementation(async (_database: string, collection: string) => [
            { _id: 1, [`${collection}Field`]: 'x' },
        ]);
        // Named collections are sampled with a server-side time limit, not through getSampleDocuments.
        client.aggregateRows.mockReset();
        client.aggregateRows.mockImplementation(async (collection: string) => [
            { _id: 1, [`${collection}Field`]: 'x' },
        ]);
    });

    it('describes the collections a wish names, from the schema cache first and a sample on a miss', async () => {
        schema.set('shop.orders', ['_id', 'customerId', 'total']);
        const described = await createWishPowers().describeScope(shop, 'count orders per customer');
        expect(described.fieldsByCollection).toEqual({
            orders: ['_id: string', 'customerId: string', 'total: string'],
            customers: ['_id: string', 'customersField: string'],
        });
        expect(client.aggregateRows).toHaveBeenCalledTimes(1);
        expect(client.aggregateRows).toHaveBeenCalledWith('customers', [{ $sample: { size: 10 } }], {
            maxTimeMS: 3000,
        });
    });

    it('describes at most three named collections', async () => {
        const described = await createWishPowers().describeScope(
            shop,
            'join customers, orders, products, reviews and wishes',
        );
        expect(Object.keys(described.fieldsByCollection ?? {})).toEqual(['customers', 'orders', 'products']);
        expect(client.aggregateRows).toHaveBeenCalledTimes(3);
    });

    it('describes every collection of a small database, even when the wish names none, sampling them together', async () => {
        listCollections(['customers', 'orders', 'products', 'reviews', 'wishes']);
        schema.set('shop.orders', ['_id', 'customerId', 'total']);
        const started: string[] = [];
        const release: Array<() => void> = [];
        client.aggregateRows.mockImplementation(
            (collection: string) =>
                new Promise((resolve) => {
                    started.push(collection);
                    release.push(() => resolve([{ _id: 1, [`${collection}Field`]: 'x' }]));
                }),
        );
        const described = createWishPowers().describeScope(shop, 'who spent the most?');
        await vi.waitFor(() => expect(started).toEqual(['customers', 'products', 'reviews', 'wishes']));
        release.forEach((done) => done());
        expect((await described).fieldsByCollection).toEqual({
            customers: ['_id: string', 'customersField: string'],
            orders: ['_id: string', 'customerId: string', 'total: string'],
            products: ['_id: string', 'productsField: string'],
            reviews: ['_id: string', 'reviewsField: string'],
            wishes: ['_id: string', 'wishesField: string'],
        });
    });

    it('leaves the current collection to "fields"', async () => {
        const described = await createWishPowers().describeScope(
            { ...shop, collectionName: 'orders' },
            'orders of each customer',
        );
        expect(described.fields).toEqual(['_id: string', 'ordersField: string']);
        expect(Object.keys(described.fieldsByCollection ?? {})).toEqual(['customers']);
    });

    it('samples no other collection without a wish, or at cluster scope', async () => {
        await expect(createWishPowers().describeScope(shop)).resolves.not.toHaveProperty('fieldsByCollection');
        listCollections(['customers', 'orders']);
        await expect(createWishPowers().describeScope(shop)).resolves.not.toHaveProperty('fieldsByCollection');
        await expect(
            createWishPowers().describeScope({ cluster: shop.cluster }, 'count orders per customer'),
        ).resolves.not.toHaveProperty('fieldsByCollection');
        expect(client.getSampleDocuments).not.toHaveBeenCalled();
        expect(client.aggregateRows).not.toHaveBeenCalled();
    });

    it('samples nothing without a wish, not even the current collection, and reads its cached fields', async () => {
        schema.set('shop.orders', ['_id', 'total']);
        await expect(createWishPowers().describeScope({ ...shop, collectionName: 'orders' })).resolves.toMatchObject({
            fields: ['_id: string', 'total: string'],
        });
        await expect(createWishPowers().describeScope({ ...shop, collectionName: 'customers' })).resolves.toMatchObject(
            { fields: [] },
        );
        listCollections(['only']);
        await expect(createWishPowers().describeScope(shop)).resolves.toMatchObject({
            collectionName: 'only',
            fields: [],
        });
        expect(client.getSampleDocuments).not.toHaveBeenCalled();
        expect(client.aggregateRows).not.toHaveBeenCalled();
    });

    it('gives the current collection the same time limit as the others', async () => {
        vi.useFakeTimers();
        try {
            client.aggregateRows.mockImplementation(() => new Promise(() => undefined));
            let settled = false;
            const described = createWishPowers().describeScope({ ...shop, collectionName: 'orders' }, 'x');
            void described.then(() => (settled = true));
            await vi.advanceTimersByTimeAsync(2900);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(100);
            await expect(described).resolves.toMatchObject({ collectionName: 'orders', fields: [] });
            expect(client.aggregateRows).toHaveBeenCalledWith('orders', [{ $sample: { size: 10 } }], {
                maxTimeMS: 3000,
            });
            expect(client.getSampleDocuments).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves out a named collection whose sample is slow or fails, without holding up the wish', async () => {
        vi.useFakeTimers();
        try {
            client.aggregateRows.mockImplementation((collection: string) => {
                if (collection === 'orders') {
                    return new Promise(() => undefined);
                }
                if (collection === 'products') {
                    return Promise.reject(new Error('not allowed'));
                }
                return Promise.resolve([{ _id: 1, name: 'x' }]);
            });
            let settled = false;
            const described = createWishPowers().describeScope(shop, 'customers with orders of products');
            void described.then(() => (settled = true));
            await vi.advanceTimersByTimeAsync(2900);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(100);
            await expect(described).resolves.toMatchObject({
                fieldsByCollection: { customers: ['_id: string', 'name: string'] },
            });
            expect(Object.keys((await described).fieldsByCollection ?? {})).toEqual(['customers']);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('documentsText for a very wide document', () => {
    it('drops the fields past the size and says how many', () => {
        const wide: Document = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`field${i}`, i]));
        const { text, summarized } = documentsText([wide]);
        expect(summarized).toBe(true);
        expect(text.length).toBeLessThan(7_000);
        const [document] = JSON.parse(text) as Record<string, unknown>[];
        expect(String(document['…'])).toMatch(/^\d+ more fields not shown$/);
    });
});

describe('documentsText for an oversized document', () => {
    it('keeps every field name, summarizes long values and stays valid JSON', () => {
        const huge: Document = { _id: 1, name: 'Ada', blob: 'x'.repeat(50_000) };
        const { text, shown } = documentsText([huge]);
        expect(shown).toBe(1);
        expect(text.length).toBeLessThan(2_000);
        const [document] = JSON.parse(text) as Record<string, unknown>[];
        expect(Object.keys(document)).toEqual(['_id', 'name', 'blob']);
        expect(document.name).toBe('Ada');
        expect(String(document.blob)).toContain('characters not shown');
    });
});
