/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

import { WishScopeError } from './wishEngine';
import { WishingWellService } from './WishingWellService';
import { type WishPowers } from './wishPowers';
import { type WishScope } from './wishScope';

const shop: WishScope = {
    cluster: { clusterId: 'c1', clusterDisplayName: 'prod', viewId: 'connectionsView' },
    databaseName: 'shop',
};

function powers(overrides: Partial<WishPowers> = {}): WishPowers {
    return {
        isCopilotAvailable: vi.fn(async () => false),
        askCopilot: vi.fn(async () => ''),
        isChatAvailable: vi.fn(async () => true),
        describeScope: vi.fn(async (scope: WishScope) =>
            scope.cluster
                ? { connectionName: 'prod', databaseName: 'shop', collectionNames: ['orders', 'customers'] }
                : {},
        ),
        read: vi.fn(async () => ({
            count: 2,
            text: '[{"a":1},{"a":2}]',
            documents: [{ a: 1 }, { a: 2 }],
            truncated: false,
        })),
        drawFromCluster: vi.fn(async () => undefined),
        cast: vi.fn(async () => undefined),
        listDatabases: vi.fn(async () => ['shop', 'blog']),
        listCollections: vi.fn(async () => ['orders', 'customers']),
        confirmGrant: vi.fn(async () => true),
        ...overrides,
    };
}

function context(): IActionContext & {
    telemetry: { properties: Record<string, string>; measurements: Record<string, number> };
} {
    return { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext & {
        telemetry: { properties: Record<string, string>; measurements: Record<string, number> };
    };
}

describe('WishingWellService', () => {
    it('answers a data question with a read-only query and offers to open it', async () => {
        const wishPowers = powers({
            isCopilotAvailable: vi.fn(async () => true),
            askCopilot: vi.fn(
                async () =>
                    '{"spell":"find","collection":"orders","filter":{"total":{"$gt":100}},"title":"Big orders","message":"Orders over 100."}',
            ),
        });
        const well = new WishingWellService(wishPowers);
        const ctx = context();

        const outcome = await well.makeWish('orders over 100', shop, ctx, 'webview');

        expect(wishPowers.read).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'find', filter: '{"total":{"$gt":100}}' }),
            shop,
            undefined,
        );
        expect(outcome).toMatchObject({
            kind: 'query',
            status: 'answered',
            wish: 'orders over 100',
            interpretedBy: 'copilot',
            resultCount: 2,
            truncated: false,
            detail: '[{"a":1},{"a":2}]',
            message: 'Found 2 documents in orders.',
            actionLabel: expect.any(String),
        });
        expect(vi.mocked(wishPowers.askCopilot).mock.calls[0][0]).toContain('"orders"');
        expect(wishPowers.cast).not.toHaveBeenCalled();

        await expect(well.grant(outcome.id, ctx, 'webview')).resolves.toBe('granted');
        expect(wishPowers.cast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'find' }), shop, ctx);
        // One grant per wish.
        await expect(well.grant(outcome.id, ctx, 'webview')).resolves.toBe('unknown');
    });

    it('writes a receipt for an aggregation and passes truncation on', async () => {
        const well = new WishingWellService(
            powers({
                read: vi.fn(async () => ({ count: 3, text: '[]', documents: [], truncated: true })),
            }),
        );
        const outcome = await well.makeWish('count orders', shop, context(), 'mcp', undefined, {
            kind: 'aggregate',
            collection: 'orders',
            pipeline: '[{"$count":"n"}]',
            title: 't',
            message: 'm',
        });
        expect(outcome).toMatchObject({
            status: 'answered',
            message: 'Aggregation on orders: 3 result rows.',
            resultCount: 3,
            truncated: true,
            interpretedBy: 'agent',
        });
    });

    it.each([
        ['needs more scope', new WishScopeError('This wish needs a collection.')],
        ['is refused', new Error('The well only reads. $out and $merge write, so it will not run them.')],
    ])('refuses a read that %s and offers nothing to grant', async (_case, error) => {
        const well = new WishingWellService(
            powers({
                isCopilotAvailable: vi.fn(async () => true),
                askCopilot: vi.fn(async () => '{"spell":"find","title":"t","message":"m"}'),
                read: vi.fn(async () => Promise.reject(error)),
            }),
        );
        const outcome = await well.makeWish('show stuff', shop, context(), 'mcp');
        expect(outcome).toMatchObject({ status: 'refused', message: `The well could not read this: ${error.message}` });
        expect(outcome.actionLabel).toBeUndefined();
        expect(well.describeGrant(outcome.id)).toBeUndefined();
        await expect(well.grant(outcome.id, context(), 'mcp')).resolves.toBe('unknown');
    });

    it('keeps the wish text out of telemetry', async () => {
        const ctx = context();
        await new WishingWellService(powers()).makeWish('my secret plan for a pony', {}, ctx, 'shell');
        expect(JSON.stringify(ctx.telemetry)).not.toContain('pony');
        expect(ctx.telemetry.measurements.wishLength).toBe('my secret plan for a pony'.length);
        expect(ctx.telemetry.properties.wishSource).toBe('shell');
    });

    it('falls back to keywords when Copilot replies with nonsense', async () => {
        const ctx = context();
        const well = new WishingWellService(
            powers({ isCopilotAvailable: vi.fn(async () => true), askCopilot: vi.fn(async () => 'sure!') }),
        );
        await expect(well.makeWish('open the dashboard', shop, ctx, 'webview')).resolves.toMatchObject({
            kind: 'view',
            interpretedBy: 'well',
        });
        expect(ctx.telemetry.properties.copilot).toBe('unparsable');
    });

    it('hands an unknown wish to Copilot agent mode only with Copilot and Chat', async () => {
        await expect(
            new WishingWellService(
                powers({ isCopilotAvailable: vi.fn(async () => true), askCopilot: vi.fn(async () => 'no idea') }),
            ).makeWish('a pony', {}, context(), 'webview'),
        ).resolves.toMatchObject({ kind: 'agent', status: 'proposed' });
    });

    it.each([
        ['Copilot is not signed in', false, true],
        ['Chat is missing', true, false],
    ])('says what it can do instead when %s, and never goes online', async (_case, copilot, chat) => {
        const wishPowers = powers({
            isCopilotAvailable: vi.fn(async () => copilot),
            askCopilot: vi.fn(async () => 'no idea'),
            isChatAvailable: vi.fn(async () => chat),
        });
        const well = new WishingWellService(wishPowers);
        const outcome = await well.makeWish('a pony', {}, context(), 'webview');
        expect(outcome).toMatchObject({ kind: 'answer', status: 'info', wish: 'a pony' });
        expect(outcome.actionLabel).toBeUndefined();
        expect(JSON.stringify(outcome)).not.toContain('duckduckgo');
    });

    it('offers to install Copilot when the model picks agent mode but Chat is missing', async () => {
        const well = new WishingWellService(
            powers({
                isCopilotAvailable: vi.fn(async () => true),
                askCopilot: vi.fn(async () => '{"spell":"agent","prompt":"write a README","title":"t","message":"m"}'),
                isChatAvailable: vi.fn(async () => false),
            }),
        );
        await expect(well.makeWish('write a README', {}, context(), 'webview')).resolves.toMatchObject({
            kind: 'command',
            title: 'This wish needs GitHub Copilot',
        });
    });

    it('refuses an unknown grant id', async () => {
        const wishPowers = powers();
        await expect(new WishingWellService(wishPowers).grant('made-up', context(), 'mcp')).resolves.toBe('unknown');
        expect(wishPowers.cast).not.toHaveBeenCalled();
    });

    it('asks the user before an outside agent opens a link, Chat or a VS Code command', async () => {
        const confirmGrant = vi.fn(async () => false);
        const wishPowers = powers({ confirmGrant });
        const well = new WishingWellService(wishPowers);
        const ctx = context();
        const link = await well.makeWish('docs', {}, ctx, 'mcp', undefined, {
            kind: 'link',
            url: 'https://example.com',
            title: 't',
            message: 'm',
        });

        await expect(well.grant(link.id, ctx, 'mcp')).resolves.toBe('declined');
        expect(confirmGrant).toHaveBeenCalledWith(expect.objectContaining({ kind: 'link' }));
        expect(wishPowers.cast).not.toHaveBeenCalled();
        expect(ctx.telemetry.properties.granted).toBe('declined');

        // Still pending: the user can change their mind.
        confirmGrant.mockResolvedValue(true);
        await expect(well.grant(link.id, ctx, 'mcp')).resolves.toBe('granted');
        expect(wishPowers.cast).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an outside agent opening DocumentDB UI', 'mcp', { kind: 'dashboard', title: 't', message: 'm' }],
        [
            'an outside agent running a DocumentDB command',
            'mcp',
            { kind: 'command', commandId: 'vscode-documentdb.command.localQuickStart.open', title: 't', message: 'm' },
        ],
        [
            'the webview opening a link',
            'webview',
            { kind: 'link', url: 'https://example.com', title: 't', message: 'm' },
        ],
        ['Copilot, which confirms itself', 'copilotTool', { kind: 'agent', prompt: 'p', title: 't', message: 'm' }],
    ] as const)('does not ask again for %s', async (_case, source, spell) => {
        const wishPowers = powers();
        const well = new WishingWellService(wishPowers);
        const outcome = await well.makeWish('w', shop, context(), source, undefined, spell);
        await expect(well.grant(outcome.id, context(), source)).resolves.toBe('granted');
        expect(wishPowers.confirmGrant).not.toHaveBeenCalled();
    });

    it('keeps a grant that failed so it can be tried again, and never casts it twice at once', async () => {
        let finish: () => void = () => undefined;
        const cast = vi
            .fn<WishPowers['cast']>()
            .mockRejectedValueOnce(
                new WishScopeError('Expand prod in the DocumentDB side bar, then grant the wish again.'),
            )
            .mockImplementationOnce(async () => new Promise<void>((resolve) => (finish = resolve)));
        const well = new WishingWellService(powers({ cast }));
        const outcome = await well.makeWish('open the dashboard', shop, context(), 'webview');

        await expect(well.grant(outcome.id, context(), 'webview')).rejects.toThrow('Expand prod');
        const first = well.grant(outcome.id, context(), 'webview');
        await expect(well.grant(outcome.id, context(), 'webview')).resolves.toBe('unknown');
        finish();
        await expect(first).resolves.toBe('granted');
        expect(cast).toHaveBeenCalledTimes(2);
    });

    it('lists one level below the scope', async () => {
        const wishPowers = powers();
        const well = new WishingWellService(wishPowers);
        await expect(well.describeConnection({})).resolves.toEqual({});
        await expect(well.describeConnection({ cluster: shop.cluster })).resolves.toEqual({
            databases: ['shop', 'blog'],
        });
        await expect(well.describeConnection(shop)).resolves.toEqual({ collections: ['orders', 'customers'] });
        expect(wishPowers.listCollections).toHaveBeenCalledWith(shop.cluster, 'shop');
    });

    it('fishes a document from the cluster and grants opening it', async () => {
        const wishPowers = powers({
            drawFromCluster: vi.fn(async () => ({
                kind: 'document' as const,
                detail: '{ "_id": 1 }',
                spell: {
                    kind: 'collectionView' as const,
                    collection: 'orders',
                    filter: '{"_id":1}',
                    title: 'Fished',
                    message: 'm',
                },
            })),
        });
        const well = new WishingWellService(wishPowers, () => 0);
        const ctx = context();

        const outcome = await well.feelingLucky(shop, ctx, 'webview');

        expect(outcome).toMatchObject({
            kind: 'document',
            detail: '{ "_id": 1 }',
            actionLabel: 'Open in collection view',
        });
        await well.grant(outcome.id, ctx, 'webview');
        expect(wishPowers.cast).toHaveBeenCalledWith(expect.objectContaining({ filter: '{"_id":1}' }), shop, ctx);
    });

    it('draws a fortune when the cluster has nothing to show', async () => {
        const well = new WishingWellService(
            powers({ drawFromCluster: vi.fn(async () => Promise.reject(new Error('no access'))) }),
            () => 0,
        );
        await expect(well.feelingLucky(shop, context(), 'webview')).resolves.toMatchObject({
            kind: 'fortune',
            status: 'info',
        });
    });

    it('never offers a cluster tip without a cluster', async () => {
        for (const roll of [0, 0.2, 0.4, 0.45]) {
            const outcome = await new WishingWellService(powers(), () => roll).feelingLucky({}, context(), 'webview');
            expect(outcome.kind === 'tip' ? outcome.actionLabel : 'Grant wish').toBe('Grant wish');
        }
    });

    it('describes a pending grant by what it opens, not the rows a read showed', async () => {
        const well = new WishingWellService(powers());
        const shell = await well.makeWish('open the shell', shop, context(), 'copilotTool');
        expect(well.describeGrant(shell.id)).toMatchObject({
            title: 'Interactive shell',
            actionLabel: shell.actionLabel,
        });

        const read = await well.makeWish('big orders', shop, context(), 'mcp', undefined, {
            kind: 'find',
            collection: 'orders',
            filter: '{"total":{"$gt":100}}',
            title: 'Big orders',
            message: 'Orders over 100.',
        });
        expect(well.describeGrant(read.id)).toMatchObject({
            title: 'Big orders',
            message: 'Orders over 100.',
            actionLabel: read.actionLabel,
            actionHint: read.actionHint,
            detail: expect.stringContaining('"$gt":100'),
        });
        expect(well.describeGrant(read.id)?.detail).not.toContain('"a":1');
    });
});
