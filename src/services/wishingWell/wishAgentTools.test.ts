/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type PreparedToolInvocation } from 'vscode';
import { type WishOutcome } from '../../webviews/documentdb/wishingWell/wishingWellTypes';

const { showInformationMessage, resolveScope, registerTool, NeedsSignInError } = vi.hoisted(() => {
    class NeedsSignInError extends Error {
        constructor(
            public readonly connectionId: string,
            public readonly connectionName: string,
        ) {
            super(`Connection "${connectionName}" (id: ${connectionId}) is not connected. Ask the user to sign in.`);
        }
    }
    return { showInformationMessage: vi.fn(), resolveScope: vi.fn(), registerTool: vi.fn(), NeedsSignInError };
});

vi.mock('vscode', () => ({ window: { showInformationMessage }, lm: { registerTool } }));
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
    NeedsSignInError,
}));

import { callWishTool, grantConfirmation, outcomeForAgent, registerWishLanguageModelTools } from './wishAgentTools';
import { WISH_COMMANDS } from './wishEngine';
import { type GrantResult, type WishingWellService } from './WishingWellService';
import { SPELL_DESCRIPTION, WISH_TOOLS } from './wishTools';

type FakeWell = WishingWellService & {
    makeWish: ReturnType<typeof vi.fn>;
    grant: ReturnType<typeof vi.fn<() => Promise<GrantResult>>>;
    describeConnection: ReturnType<typeof vi.fn>;
};

const connectedScope = {
    cluster: { clusterId: 'c1', clusterDisplayName: 'shop', viewId: 'connectionsView' },
    databaseName: 'shop',
};

function well(): FakeWell {
    return {
        makeWish: vi.fn(
            async (
                _wish: string,
                _scope: unknown,
                _context: unknown,
                _source: string,
                _signal: unknown,
                spell?: { kind: string },
            ): Promise<WishOutcome> => ({
                id: 'w1',
                kind: spell?.kind === 'aggregate' ? 'query' : 'view',
                title: 'Orders',
                message: 'Aggregation on orders: 1 result row.',
                detail: '[{"n":3}]',
                resultCount: 1,
                actionLabel: 'Open in a playground',
                status: 'answered',
                interpretedBy: spell ? 'agent' : 'well',
            }),
        ),
        feelingLucky: vi.fn(
            async (): Promise<WishOutcome> => ({
                id: 'w2',
                kind: 'fortune',
                title: 'Your fortune',
                message: 'm',
                status: 'info',
                interpretedBy: 'well',
            }),
        ),
        grant: vi.fn(async (): Promise<GrantResult> => 'granted'),
        describeGrant: vi.fn(() => ({ title: 'Orders', message: 'm' })),
        describeConnection: vi.fn(async () => ({ databases: ['shop', 'blog'] })),
    } as unknown as FakeWell;
}

function outcome(overrides: Partial<WishOutcome>): WishOutcome {
    return {
        id: 'w1',
        kind: 'view',
        title: 'Orders',
        message: 'm',
        status: 'proposed',
        interpretedBy: 'agent',
        ...overrides,
    };
}

describe('callWishTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveScope.mockResolvedValue(connectedScope);
    });

    describe('documentdb_list_connections', () => {
        it('lists connections without secrets', async () => {
            const result = await callWishTool(well(), 'documentdb_list_connections', {}, 'mcp');
            expect(result.text).toContain('- shop (id: c1, local, connected)');
            expect(resolveScope).not.toHaveBeenCalled();
        });

        it("lists a connected connection's databases without ever signing in", async () => {
            const target = well();
            resolveScope.mockResolvedValue({ cluster: connectedScope.cluster });
            const result = await callWishTool(
                target,
                'documentdb_list_connections',
                { connection: 'shop' },
                'copilotTool',
            );
            expect(resolveScope).toHaveBeenCalledWith(
                { connection: 'shop', database: undefined, collection: undefined },
                expect.anything(),
                { interactive: false },
            );
            expect(result.text).toContain('- blog');
            expect(result.structured).toMatchObject({ connectionId: 'c1', databases: ['shop', 'blog'] });
        });

        function withDatabases(target: FakeWell): FakeWell {
            target.describeConnection.mockImplementation(async (scope: { databaseName?: string }) =>
                scope.databaseName ? { collections: ['orders'] } : { databases: ['shop', 'blog'] },
            );
            return target;
        }

        it("lists a database's collections", async () => {
            const result = await callWishTool(
                withDatabases(well()),
                'documentdb_list_connections',
                { connection: 'shop', database: 'shop' },
                'mcp',
            );
            expect(result.text).toBe('Collections in database "shop" on "shop":\n- orders');
            expect(result.structured).toMatchObject({ database: 'shop', collections: ['orders'] });
        });

        it.each(['admin', 'local'])('lists the collections of the system database %s', async (database) => {
            const result = await callWishTool(
                withDatabases(well()),
                'documentdb_list_connections',
                { connection: 'shop', database },
                'mcp',
            );
            expect(result.isError).not.toBe(true);
        });

        it('does not call a database empty when it could not check that it exists', async () => {
            const target = well();
            target.describeConnection.mockImplementation(async (scope: { databaseName?: string }) => {
                if (!scope.databaseName) {
                    throw new Error('not authorized to list databases');
                }
                return { collections: [] };
            });
            const result = await callWishTool(
                target,
                'documentdb_list_connections',
                { connection: 'shop', database: 'shpo' },
                'mcp',
            );
            expect(result.text).toContain('It may not exist');
        });

        it('skips the existence check when databases cannot be listed', async () => {
            const target = well();
            target.describeConnection.mockImplementation(async (scope: { databaseName?: string }) => {
                if (!scope.databaseName) {
                    throw new Error('not authorized to list databases');
                }
                return { collections: ['orders'] };
            });
            const result = await callWishTool(
                target,
                'documentdb_list_connections',
                { connection: 'shop', database: 'shop' },
                'mcp',
            );
            expect(result.text).toContain('- orders');
        });

        it('says a database does not exist instead of calling it empty', async () => {
            resolveScope.mockResolvedValue({ ...connectedScope, databaseName: 'shp' });
            const result = await callWishTool(
                withDatabases(well()),
                'documentdb_list_connections',
                { connection: 'shop', database: 'shp' },
                'mcp',
            );
            expect(result).toMatchObject({
                isError: true,
                text: 'No database "shp" on "shop". Its databases:\n- shop\n- blog',
                structured: { database: 'shp', exists: false, databases: ['shop', 'blog'] },
            });
        });

        it('says a connection is not signed in instead of prompting', async () => {
            const target = well();
            resolveScope.mockRejectedValue(new NeedsSignInError('c9', 'prod'));
            const result = await callWishTool(target, 'documentdb_list_connections', { connection: 'prod' }, 'mcp');
            expect(result).toMatchObject({
                isError: true,
                text: expect.stringContaining('Ask the user to sign in'),
                structured: { status: 'refused', needsSignIn: true, connectionId: 'c9', connection: 'prod' },
            });
            expect(target.describeConnection).not.toHaveBeenCalled();
        });
    });

    describe('documentdb_make_wish', () => {
        it('passes a valid agent spell through and offers to open the answer', async () => {
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
            expect(target.makeWish.mock.calls[0][5]).toMatchObject({ kind: 'aggregate', pipeline: '[{"$count":"n"}]' });
            expect(result.text).toContain('Aggregation on orders: 1 result row.');
            expect(result.text).toContain('Optional: call documentdb_grant_wish with wishId "w1"');
            expect(result.isError).not.toBe(true);
            expect(result.structured).toMatchObject({
                status: 'answered',
                wishId: 'w1',
                kind: 'query',
                interpretedBy: 'agent',
            });
        });

        it('never brings up a sign-in for an outside agent, but may for Copilot in VS Code', async () => {
            await callWishTool(well(), 'documentdb_make_wish', { wish: 'w', connection: 'shop' }, 'mcp');
            expect(resolveScope).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { interactive: false });
            await callWishTool(well(), 'documentdb_feeling_lucky', { connection: 'shop' }, 'mcp');
            expect(resolveScope).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { interactive: false });
            await callWishTool(well(), 'documentdb_make_wish', { wish: 'w', connection: 'shop' }, 'copilotTool');
            expect(resolveScope).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { interactive: true });
        });

        it('tells the agent how to recover when the connection needs signing in', async () => {
            const target = well();
            resolveScope.mockRejectedValue(new NeedsSignInError('c9', 'prod'));
            const result = await callWishTool(target, 'documentdb_make_wish', { wish: 'w', connection: 'prod' }, 'mcp');
            expect(result).toMatchObject({
                isError: true,
                text: expect.stringContaining('(id: c9)'),
                structured: { status: 'refused', needsSignIn: true, connectionId: 'c9' },
            });
            expect(target.makeWish).not.toHaveBeenCalled();
        });

        it.each([
            [{ spell: 'aggregate', collection: 'orders', pipeline: [{ $out: 'x' }] }, /\$out/],
            [{ spell: 'command', commandId: 'workbench.action.terminal.sendSequence' }, /command/i],
        ])(
            'refuses a spell that breaks a rule with the reason, before touching the database',
            async (spell, reason) => {
                const target = well();
                const result = await callWishTool(target, 'documentdb_make_wish', { wish: 'w', spell }, 'mcp');
                expect(result.isError).toBe(true);
                expect(result.text).toMatch(reason);
                expect(result.text).toContain('"spell" parameter description of documentdb_make_wish');
                // A pointer, not the whole menu.
                expect(result.text).not.toContain('DocumentDB API shell JavaScript');
                expect(target.makeWish).not.toHaveBeenCalled();
                expect(resolveScope).not.toHaveBeenCalled();
            },
        );

        it('rejects input that does not match the schema', async () => {
            await expect(callWishTool(well(), 'documentdb_make_wish', { wish: '' }, 'mcp')).rejects.toThrow();
        });
    });

    describe('documentdb_grant_wish', () => {
        it('tells the user when an outside agent grants a wish', async () => {
            await callWishTool(well(), 'documentdb_grant_wish', { wishId: 'w1' }, 'mcp');
            expect(showInformationMessage).toHaveBeenCalledWith('An agent granted a wish: Orders');
            showInformationMessage.mockClear();
            await callWishTool(well(), 'documentdb_grant_wish', { wishId: 'w1' }, 'copilotTool');
            expect(showInformationMessage).not.toHaveBeenCalled();
        });

        it('reports a declined grant as a normal answer', async () => {
            const target = well();
            target.grant.mockResolvedValue('declined');
            const result = await callWishTool(target, 'documentdb_grant_wish', { wishId: 'w1' }, 'mcp');
            expect(result.isError).not.toBe(true);
            expect(result.text).toContain('The user declined "Orders" in VS Code');
            expect(result.structured).toMatchObject({ granted: false, result: 'declined' });
            expect(showInformationMessage).not.toHaveBeenCalled();
        });

        it("passes the call's abort signal on and says when the user has not answered yet", async () => {
            const target = well();
            target.grant.mockResolvedValue('waiting');
            const signal = new AbortController().signal;
            const result = await callWishTool(target, 'documentdb_grant_wish', { wishId: 'w1' }, 'mcp', signal);
            expect(target.grant).toHaveBeenCalledWith('w1', expect.anything(), 'mcp', signal);
            expect(result.isError).not.toBe(true);
            expect(result.text).toBe('The user has not answered in VS Code yet. If they allow "Orders", it will open.');
            expect(result.structured).toMatchObject({ granted: false, result: 'waiting' });
            expect(showInformationMessage).not.toHaveBeenCalled();
        });

        it('reports an expired grant as an error the agent can read', async () => {
            const target = well();
            target.grant.mockResolvedValue('unknown');
            const result = await callWishTool(target, 'documentdb_grant_wish', { wishId: 'gone' }, 'mcp');
            expect(result).toMatchObject({ isError: true, text: expect.stringContaining('make the wish again') });
        });
    });
});

describe('outcomeForAgent', () => {
    it('reads an answer back with an optional open, and says how many rows were cut', () => {
        const result = outcomeForAgent(
            outcome({
                status: 'answered',
                message: 'Found 3 documents in orders.',
                detail: '[{"a":1}]',
                resultCount: 3,
                truncated: true,
                actionLabel: 'Open in collection view',
            }),
        );
        expect(result.text).toContain('Found 3 documents in orders.\n\n[{"a":1}]');
        expect(result.text).toContain('project fewer fields to see more');
        expect(result.text).not.toContain('at most 50 rows');
        expect(result.text).not.toContain('there are more');
        expect(result.text).toContain('Optional: call documentdb_grant_wish with wishId "w1"');
        expect(result.structured).toMatchObject({ status: 'answered', truncated: true, wishId: 'w1' });
    });

    it('says more rows exist past the cap without claiming any were cut', () => {
        const result = outcomeForAgent(
            outcome({
                status: 'answered',
                detail: '[{"a":1},{"a":2}]',
                resultCount: 2,
                capped: true,
                truncated: false,
            }),
        );
        expect(result.text).toContain('Reads return at most 50 rows');
        expect(result.text).not.toContain('summarized to fit');
        expect(result.structured).toMatchObject({ capped: true, truncated: false });
    });

    it('says what a proposal will do, in the host’s words, and when to grant it', () => {
        const result = outcomeForAgent(
            outcome({ actionLabel: 'Open Query Insights', actionHint: 'Opens Query Insights for orders.' }),
        );
        expect(result.text).toContain(
            "Not done yet. Granting does this in the user's VS Code: Open Query Insights (Opens Query Insights for orders).",
        );
        expect(result.text).toContain('only if the user asked for it to open');
        expect(result.isError).not.toBe(true);
    });

    it('marks a refusal as an error with nothing to grant', () => {
        const result = outcomeForAgent(
            outcome({ status: 'refused', message: 'The well could not read this: needs a collection.' }),
        );
        expect(result.isError).toBe(true);
        expect(result.text).not.toContain('documentdb_grant_wish');
        expect(result.structured).toMatchObject({ status: 'refused' });
        expect(result.structured).not.toHaveProperty('wishId');
    });

    it('returns information as plain text', () => {
        const result = outcomeForAgent(outcome({ kind: 'fortune', status: 'info', message: 'An index awaits.' }));
        expect(result.text).toBe('Orders\nAn index awaits.');
        expect(result.isError).not.toBe(true);
        expect(result.structured).not.toHaveProperty('wishId');
    });
});

describe('Copilot grant confirmation', () => {
    function prepareGrant(target: WishingWellService, wishId: string): PreparedToolInvocation | undefined {
        registerTool.mockReset().mockReturnValue({ dispose: vi.fn() });
        registerWishLanguageModelTools(() => target);
        const call = registerTool.mock.calls.find(([name]) => name === 'documentdb_grant_wish');
        const tool = call?.[1] as {
            prepareInvocation(options: { input: Record<string, unknown> }): PreparedToolInvocation | undefined;
        };
        return tool.prepareInvocation({ input: { wishId } });
    }

    it('shows what the host will open and a short preview of it', () => {
        const target = well();
        vi.mocked(target.describeGrant).mockReturnValue({
            title: 'Big orders',
            message: 'm',
            actionLabel: 'Open in collection view',
            actionHint: 'Opens orders with this query.',
            detail: Array.from({ length: 20 }, (_, index) => `line ${String(index)}`).join('\n'),
        });
        const message = prepareGrant(target, ' w1 ')?.confirmationMessages?.message;
        // Plain text, so a query or prompt cannot render as links.
        expect(typeof message).toBe('string');
        expect(target.describeGrant).toHaveBeenCalledWith('w1');
        expect(message).toContain('Big orders\n\nOpen in collection view (Opens orders with this query)\n\nline 0');
        expect(message).toContain('line 7…');
        expect(message).not.toContain('line 8');
    });

    it('does not ask about a wish that no longer exists', () => {
        const target = well();
        vi.mocked(target.describeGrant).mockReturnValue(undefined);
        expect(prepareGrant(target, 'gone')?.confirmationMessages).toBeUndefined();
    });

    it('clips one long line', () => {
        expect(grantConfirmation({ title: 't', message: 'm', detail: 'x'.repeat(1000) })).toBe(
            `t\n\n${'x'.repeat(400)}…`,
        );
    });
});

describe('tool contract', () => {
    interface ContributedTool {
        readonly name: string;
        readonly modelDescription: string;
        readonly inputSchema: { readonly properties: unknown; readonly required?: readonly string[] };
    }

    const contributed = (
        JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
            contributes: { languageModelTools: readonly ContributedTool[] };
        }
    ).contributes.languageModelTools;

    it.each(WISH_TOOLS.map((tool) => [tool.name, tool] as const))('package.json matches %s', (name, tool) => {
        const entry = contributed.find((candidate) => candidate.name === name);
        const schema = tool.inputSchema as { properties: unknown; required?: readonly string[] };
        expect(entry?.modelDescription).toBe(tool.description);
        expect(entry?.inputSchema.properties).toEqual(schema.properties);
        expect(entry?.inputSchema.required).toEqual(schema.required);
    });

    it('names every allowlisted command in the spell description', () => {
        for (const command of WISH_COMMANDS) {
            expect(SPELL_DESCRIPTION).toContain(command.id);
        }
    });
});
