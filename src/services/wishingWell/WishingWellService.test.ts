/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

import { LUCKY_TIPS, WishScopeError } from './wishEngine';
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
            capped: false,
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
        // The card can open its query again.
        await expect(well.grant(outcome.id, ctx, 'webview')).resolves.toBe('granted');
        expect(wishPowers.cast).toHaveBeenCalledTimes(2);
    });

    const aggregate = {
        kind: 'aggregate',
        collection: 'orders',
        pipeline: '[{"$count":"n"}]',
        title: 't',
        message: 'm',
    } as const;
    const find = { kind: 'find', collection: 'orders', title: 't', message: 'm' } as const;

    it.each([
        ['an aggregation that fits', aggregate, 3, false, false, 'Aggregation on orders: 3 result rows.'],
        [
            'an aggregation past the row cap',
            aggregate,
            50,
            true,
            false,
            'Aggregation on orders: the first 50 result rows; there are more.',
        ],
        ['a find past the row cap', find, 50, true, false, 'The first 50 documents in orders; there are more.'],
        [
            'a find cut to fit',
            find,
            3,
            false,
            true,
            'Found 3 documents in orders. Only the first 2 are shown; the rest did not fit.',
        ],
        [
            'a find past the cap and cut to fit',
            find,
            50,
            true,
            true,
            'The first 50 documents in orders; there are more. Only the first 2 are shown; the rest did not fit.',
        ],
        ['a find marked cut although every row fits', find, 2, false, true, 'Found 2 documents in orders.'],
    ] as const)('writes a receipt for %s', async (_case, spell, count, capped, truncated, message) => {
        const well = new WishingWellService(
            powers({
                read: vi.fn(async () => ({
                    count,
                    text: '[{"a":1},{"a":2}]',
                    documents: [{ a: 1 }, { a: 2 }],
                    truncated,
                    capped,
                })),
            }),
        );
        await expect(well.makeWish('w', shop, context(), 'mcp', undefined, spell)).resolves.toMatchObject({
            status: 'answered',
            message,
            resultCount: count,
            truncated,
            capped,
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
        expect(outcome).toMatchObject({ kind: 'answer', status: 'refused', wish: 'a pony' });
        expect(outcome.message).toContain('It can');
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

    it('turns a pipeline Copilot wrote that writes into a playground script instead of agent mode', async () => {
        const wishPowers = powers({
            isCopilotAvailable: vi.fn(async () => true),
            askCopilot: vi.fn(
                async () =>
                    '{"spell":"aggregate","collection":"orders","pipeline":[{"$match":{}},{"$out":"archive"}],"title":"Archive","message":"m"}',
            ),
        });
        const ctx = context();
        const outcome = await new WishingWellService(wishPowers).makeWish('archive orders', shop, ctx, 'webview');
        expect(outcome).toMatchObject({ kind: 'playground', status: 'proposed', interpretedBy: 'copilot' });
        expect(outcome.detail).toContain('$out');
        expect(ctx.telemetry.properties.copilot).toBe('writeToPlayground');
        expect(wishPowers.read).not.toHaveBeenCalled();
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

    describe('when the user is slow to answer an outside agent', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        function slowUser(): { wishPowers: WishPowers; answer: (yes: boolean) => void } {
            let answer: (yes: boolean) => void = () => undefined;
            const wishPowers = powers({
                confirmGrant: vi.fn(async () => new Promise<boolean>((resolve) => (answer = resolve))),
            });
            return { wishPowers, answer: (yes) => answer(yes) };
        }

        async function link(well: WishingWellService): Promise<string> {
            const outcome = await well.makeWish('docs', {}, context(), 'mcp', undefined, {
                kind: 'link',
                url: 'https://example.com',
                title: 't',
                message: 'm',
            });
            return outcome.id;
        }

        it('says waiting after a minute, and still opens it once the user allows it', async () => {
            vi.useFakeTimers();
            const { wishPowers, answer } = slowUser();
            const well = new WishingWellService(wishPowers);
            const id = await link(well);
            const ctx = context();

            const first = well.grant(id, ctx, 'mcp');
            await vi.advanceTimersByTimeAsync(60_000);
            await expect(first).resolves.toBe('waiting');
            expect(ctx.telemetry.properties.granted).toBe('waiting');
            // Asked once: a second grant waits on the same question, never says the wish expired.
            const second = well.grant(id, context(), 'mcp');
            expect(wishPowers.confirmGrant).toHaveBeenCalledTimes(1);

            answer(true);
            await expect(second).resolves.toBe('granted');
            expect(wishPowers.cast).toHaveBeenCalledTimes(1);
        });

        it('stays granted for an agent that asks again after the user allowed a one-shot wish late', async () => {
            const { wishPowers, answer } = slowUser();
            const well = new WishingWellService(wishPowers);
            const id = await link(well);
            const abort = new AbortController();

            const first = well.grant(id, context(), 'mcp', abort.signal);
            abort.abort();
            await expect(first).resolves.toBe('waiting');
            answer(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await expect(well.grant(id, context(), 'mcp')).resolves.toBe('granted');
            expect(wishPowers.cast).toHaveBeenCalledTimes(1);
        });

        it('reports a late failure once, to the caller that came back', async () => {
            const { wishPowers, answer } = slowUser();
            wishPowers.reportLateFailure = vi.fn();
            vi.mocked(wishPowers.cast).mockRejectedValueOnce(new Error('no tree node'));
            const well = new WishingWellService(wishPowers);
            const id = await link(well);
            const abort = new AbortController();

            const first = well.grant(id, context(), 'mcp', abort.signal);
            abort.abort();
            await expect(first).resolves.toBe('waiting');
            const second = well.grant(id, context(), 'mcp');
            answer(true);
            await expect(second).rejects.toThrow('no tree node');
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(wishPowers.reportLateFailure).not.toHaveBeenCalled();
        });

        it('tells the user when a grant they allowed late fails', async () => {
            const { wishPowers, answer } = slowUser();
            wishPowers.reportLateFailure = vi.fn();
            vi.mocked(wishPowers.cast).mockRejectedValueOnce(new Error('no tree node'));
            const well = new WishingWellService(wishPowers);
            const id = await link(well);
            const abort = new AbortController();

            const first = well.grant(id, context(), 'mcp', abort.signal);
            abort.abort();
            await expect(first).resolves.toBe('waiting');
            answer(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(wishPowers.reportLateFailure).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
        });

        it('says waiting when the agent gives up, and leaves the wish pending if the user declines', async () => {
            const { wishPowers, answer } = slowUser();
            const well = new WishingWellService(wishPowers);
            const id = await link(well);
            const abort = new AbortController();

            const first = well.grant(id, context(), 'mcp', abort.signal);
            abort.abort();
            await expect(first).resolves.toBe('waiting');
            answer(false);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(wishPowers.cast).not.toHaveBeenCalled();

            vi.mocked(wishPowers.confirmGrant).mockResolvedValueOnce(true);
            await expect(well.grant(id, context(), 'mcp')).resolves.toBe('granted');
            expect(wishPowers.confirmGrant).toHaveBeenCalledTimes(2);
        });
    });

    it('makes two grants of the same wish at once share one cast', async () => {
        let finish: () => void = () => undefined;
        const wishPowers = powers({ cast: vi.fn(async () => new Promise<void>((resolve) => (finish = resolve))) });
        const well = new WishingWellService(wishPowers);
        const outcome = await well.makeWish('w', shop, context(), 'mcp', undefined, {
            kind: 'dashboard',
            title: 't',
            message: 'm',
        });
        const first = well.grant(outcome.id, context(), 'mcp');
        const second = well.grant(outcome.id, context(), 'mcp');
        finish();
        await expect(Promise.all([first, second])).resolves.toEqual(['granted', 'granted']);
        expect(wishPowers.cast).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['an agent prompt', { kind: 'agent', prompt: 'p', title: 't', message: 'm' }],
        ['a link', { kind: 'link', url: 'https://example.com', title: 't', message: 'm' }],
    ] as const)('grants %s only once, and says granted when asked again', async (_case, spell) => {
        const wishPowers = powers();
        const well = new WishingWellService(wishPowers);
        const outcome = await well.makeWish('w', {}, context(), 'webview', undefined, spell);
        await expect(well.grant(outcome.id, context(), 'webview')).resolves.toBe('granted');
        await expect(well.grant(outcome.id, context(), 'webview')).resolves.toBe('granted');
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
        const second = well.grant(outcome.id, context(), 'webview');
        finish();
        await expect(Promise.all([first, second])).resolves.toEqual(['granted', 'granted']);
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
                    database: 'shop',
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
            actionHint: 'Opens shop.orders filtered to this document.',
        });
        expect(well.describeGrant(outcome.id)?.actionHint).toBe('Opens shop.orders filtered to this document.');
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

    it('never offers the shell tip inside the shell', async () => {
        // 0.7 draws a tip; among the four cluster tips it is the shell one.
        const tip = async (source: 'webview' | 'shell', roll: number): Promise<string> =>
            (await new WishingWellService(powers(), () => roll).feelingLucky(shop, context(), source)).title;
        await expect(tip('webview', 0.7)).resolves.toBe('The interactive shell');
        for (const roll of [0.65, 0.7, 0.75, 0.79]) {
            await expect(tip('shell', roll)).resolves.not.toBe('The interactive shell');
        }
    });

    it('never offers a cluster tip without a cluster', async () => {
        const clusterTips = LUCKY_TIPS.filter((tip) => tip.needsCluster).map((tip) => tip.spell().title);
        for (const roll of [0, 0.2, 0.4, 0.45]) {
            const outcome = await new WishingWellService(powers(), () => roll).feelingLucky({}, context(), 'webview');
            expect(clusterTips).not.toContain(outcome.title);
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
