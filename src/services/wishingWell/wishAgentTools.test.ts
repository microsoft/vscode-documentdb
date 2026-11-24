/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { showInformationMessage, resolveScope } = vi.hoisted(() => ({
    showInformationMessage: vi.fn(),
    resolveScope: vi.fn(),
}));

vi.mock('vscode', () => ({ window: { showInformationMessage }, lm: {} }));
vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_id: string, run: (context: unknown) => Promise<unknown>) =>
        run({ telemetry: { properties: {}, measurements: {} }, errorHandling: {} }),
}));
vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));
vi.mock('./wishScope', () => ({
    listConnections: vi.fn(async () => [{ id: 'c1', name: 'shop', kind: 'local', connected: true }]),
    resolveScope: (...args: unknown[]) => resolveScope(...args) as unknown,
}));

import { callWishTool } from './wishAgentTools';
import { type WishingWellService } from './WishingWellService';

function well(): WishingWellService & { makeWish: ReturnType<typeof vi.fn>; grant: ReturnType<typeof vi.fn> } {
    return {
        makeWish: vi.fn(
            async (
                _wish: string,
                _scope: unknown,
                _context: unknown,
                _source: string,
                _signal: unknown,
                spell?: { kind: string },
            ) => ({
                id: 'w1',
                kind: spell?.kind === 'aggregate' ? 'query' : 'view',
                title: 'Orders',
                message: '3 documents.',
                detail: '[{"n":3}]',
                resultCount: 1,
                actionLabel: 'Open in a playground',
                interpretedBy: spell ? 'agent' : 'well',
            }),
        ),
        grant: vi.fn(async () => true),
        describeGrant: vi.fn(() => ({ title: 'Orders', message: 'm' })),
    } as unknown as WishingWellService & { makeWish: ReturnType<typeof vi.fn>; grant: ReturnType<typeof vi.fn> };
}

describe('callWishTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveScope.mockResolvedValue({
            cluster: { clusterId: 'c1', clusterDisplayName: 'shop', viewId: 'connectionsView' },
            databaseName: 'shop',
        });
    });

    it('lists connections without secrets', async () => {
        const result = await callWishTool(well(), 'documentdb_list_connections', {}, 'mcp');
        expect(result.text).toContain('- shop (id: c1, local, connected)');
    });

    it('passes a valid agent spell through and tells the agent how to grant', async () => {
        const target = well();
        const result = await callWishTool(
            target,
            'documentdb_make_wish',
            {
                wish: 'count orders',
                connection: 'shop',
                database: 'shop',
                spell: { spell: 'aggregate', collection: 'orders', pipeline: [{ $count: 'n' }] },
            },
            'mcp',
        );
        expect(resolveScope).toHaveBeenCalledWith(
            { connection: 'shop', database: 'shop', collection: undefined },
            expect.anything(),
        );
        expect(target.makeWish.mock.calls[0][5]).toMatchObject({
            kind: 'aggregate',
            pipeline: '[{"$count":"n"}]',
            title: 'count orders',
        });
        expect(result.text).toContain('call documentdb_grant_wish with wishId "w1"');
        expect(result.structured).toMatchObject({ wishId: 'w1', kind: 'query', interpretedBy: 'agent' });
    });

    it('refuses a spell that writes, before touching the database', async () => {
        const target = well();
        const result = await callWishTool(
            target,
            'documentdb_make_wish',
            { wish: 'copy', spell: { spell: 'aggregate', collection: 'orders', pipeline: [{ $out: 'x' }] } },
            'mcp',
        );
        // $out is refused when the pipeline runs; a non-allowlisted command is refused here.
        expect(result.isError).not.toBe(true);
        const command = await callWishTool(
            target,
            'documentdb_make_wish',
            { wish: 'type', spell: { spell: 'command', commandId: 'workbench.action.terminal.sendSequence' } },
            'mcp',
        );
        expect(command.isError).toBe(true);
        expect(target.makeWish).toHaveBeenCalledTimes(1);
    });

    it('tells the user when an outside agent grants a wish', async () => {
        await callWishTool(well(), 'documentdb_grant_wish', { wishId: 'w1' }, 'mcp');
        expect(showInformationMessage).toHaveBeenCalledWith('An agent granted a wish: Orders');
        showInformationMessage.mockClear();
        await callWishTool(well(), 'documentdb_grant_wish', { wishId: 'w1' }, 'copilotTool');
        expect(showInformationMessage).not.toHaveBeenCalled();
    });

    it('reports an expired grant as an error the agent can read', async () => {
        const target = well();
        target.grant.mockResolvedValue(false);
        const result = await callWishTool(target, 'documentdb_grant_wish', { wishId: 'gone' }, 'mcp');
        expect(result).toMatchObject({ isError: true });
    });

    it('rejects input that does not match the schema', async () => {
        await expect(callWishTool(well(), 'documentdb_make_wish', { wish: '' }, 'mcp')).rejects.toThrow();
    });
});
