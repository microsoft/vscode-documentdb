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
        read: vi.fn(async () => ({ count: 2, text: '[{"a":1},{"a":2}]', documents: [{ a: 1 }, { a: 2 }] })),
        drawFromCluster: vi.fn(async () => undefined),
        cast: vi.fn(async () => undefined),
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
            interpretedBy: 'copilot',
            resultCount: 2,
            detail: '[{"a":1},{"a":2}]',
            message: 'Orders over 100. 2 documents.',
            actionLabel: 'Open in collection view',
        });
        expect(vi.mocked(wishPowers.askCopilot).mock.calls[0][0]).toContain('"orders"');
        expect(wishPowers.cast).not.toHaveBeenCalled();

        await expect(well.grant(outcome.id, ctx, 'webview')).resolves.toBe(true);
        expect(wishPowers.cast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'find' }), shop, ctx);
        // One grant per wish.
        await expect(well.grant(outcome.id, ctx, 'webview')).resolves.toBe(false);
    });

    it('reports a read that needs more scope without offering to open it', async () => {
        const well = new WishingWellService(
            powers({
                isCopilotAvailable: vi.fn(async () => true),
                askCopilot: vi.fn(async () => '{"spell":"find","title":"t","message":"m"}'),
                read: vi.fn(async () => Promise.reject(new WishScopeError('This wish needs a collection.'))),
            }),
        );
        const outcome = await well.makeWish('show stuff', shop, context(), 'mcp');
        expect(outcome.message).toBe('The well could not read this: This wish needs a collection.');
        expect(outcome.actionLabel).toBeUndefined();
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

    it('hands an unknown wish to Copilot Chat, or a lucky search without it', async () => {
        await expect(
            new WishingWellService(powers()).makeWish('a pony', {}, context(), 'webview'),
        ).resolves.toMatchObject({
            kind: 'agent',
        });
        await expect(
            new WishingWellService(powers({ isChatAvailable: vi.fn(async () => false) })).makeWish(
                'a pony',
                {},
                context(),
                'webview',
            ),
        ).resolves.toMatchObject({ kind: 'link' });
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
        await expect(new WishingWellService(wishPowers).grant('made-up', context(), 'mcp')).resolves.toBe(false);
        expect(wishPowers.cast).not.toHaveBeenCalled();
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
        await expect(well.feelingLucky(shop, context(), 'webview')).resolves.toMatchObject({ kind: 'fortune' });
    });

    it('never offers a cluster tip without a cluster', async () => {
        for (const roll of [0, 0.2, 0.4, 0.45]) {
            const outcome = await new WishingWellService(powers(), () => roll).feelingLucky({}, context(), 'webview');
            expect(outcome.kind === 'tip' ? outcome.actionLabel : 'Grant wish').toBe('Grant wish');
        }
    });

    it('describes a pending grant for confirmation', async () => {
        const well = new WishingWellService(powers());
        const outcome = await well.makeWish('open the shell', shop, context(), 'copilotTool');
        expect(well.describeGrant(outcome.id)).toMatchObject({ title: 'Interactive shell' });
    });
});
