/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

const { client } = vi.hoisted(() => ({
    client: {
        runFindQuery: vi.fn(),
        estimateDocumentCount: vi.fn(),
        aggregateRows: vi.fn(),
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: vi.fn(async () => ({
            ...client,
            getMongoClient: () => ({
                db: () => ({ collection: () => ({ aggregate: () => ({ toArray: client.aggregateRows }) }) }),
            }),
        })),
    },
}));

vi.mock('../../commands/openCollectionView/openCollectionView', () => ({ openCollectionViewInternal: vi.fn() }));

import { openCollectionViewInternal } from '../../commands/openCollectionView/openCollectionView';
import { parseSpell, type Spell } from './wishEngine';
import { createWishPowers, documentsText, grantConfirmation } from './wishPowers';
import { type WishScope } from './wishScope';

const shop: WishScope = {
    cluster: { clusterId: 'c1', clusterDisplayName: 'prod', viewId: 'connectionsView' },
    databaseName: 'shop',
};

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
        expect(client.runFindQuery).toHaveBeenLastCalledWith('shop', 'orders', expect.objectContaining({ limit: 21 }));
        expect(result).toMatchObject({ count: 20, capped: true, truncated: false });
    });

    it('takes a limit the wish asked for as the answer, not as a cap', async () => {
        client.runFindQuery.mockResolvedValueOnce(rows(5));
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 5, title: 't', message: 'm' },
            shop,
        );
        expect(client.runFindQuery).toHaveBeenLastCalledWith('shop', 'orders', expect.objectContaining({ limit: 5 }));
        expect(result).toMatchObject({ count: 5, capped: false });
    });

    it('says more rows exist when the wish asked for more than the cap', async () => {
        client.runFindQuery.mockResolvedValueOnce(rows(51));
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 100, title: 't', message: 'm' },
            shop,
        );
        expect(client.runFindQuery).toHaveBeenLastCalledWith('shop', 'orders', expect.objectContaining({ limit: 51 }));
        expect(result).toMatchObject({ count: 50, capped: true });
    });

    it('marks a read whose document had to be summarized as cut', async () => {
        client.runFindQuery.mockResolvedValueOnce([{ _id: 1, blob: 'x'.repeat(20_000) }]);
        const result = await createWishPowers().read(
            { kind: 'find', collection: 'orders', limit: 1, title: 't', message: 'm' },
            shop,
        );
        expect(result).toMatchObject({ count: 1, truncated: true });
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
