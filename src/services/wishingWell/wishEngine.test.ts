/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string, ...args: unknown[]) =>
        args.reduce<string>((result, value, index) => result.replace(`{${String(index)}}`, String(value)), message),
    ),
}));

import {
    buildWishPrompt,
    luckySearchSpell,
    matchWishByKeyword,
    parseSpell,
    pickLuckyKind,
    pipelineWrites,
    spellToOutcome,
    WISH_COMMANDS,
} from './wishEngine';

describe('parseSpell', () => {
    it('reads a spell even when the model wraps it in a code fence', () => {
        const reply = '```json\n{"spell":"answer","title":"Hi","message":"An index is a sorted lookup."}\n```';
        expect(parseSpell(reply)).toEqual({ kind: 'answer', title: 'Hi', message: 'An index is a sorted lookup.' });
    });

    it('turns query objects into the JSON text the collection view takes, and caps the limit', () => {
        const spell = parseSpell(
            JSON.stringify({
                spell: 'find',
                collection: 'orders',
                filter: { total: { $gt: 100 } },
                sort: { total: -1 },
                limit: 5000,
                title: 't',
                message: 'm',
            }),
        );
        expect(spell).toMatchObject({
            kind: 'find',
            collection: 'orders',
            filter: '{"total":{"$gt":100}}',
            sort: '{"total":-1}',
            limit: 50,
        });
    });

    it('drops an empty filter so the view opens unfiltered', () => {
        expect(
            parseSpell('{"spell":"collectionView","collection":"c","filter":{},"title":"t","message":"m"}'),
        ).toMatchObject({ filter: undefined });
    });

    it('needs a pipeline for an aggregate', () => {
        expect(parseSpell('{"spell":"aggregate","collection":"c","title":"t","message":"m"}')).toBeUndefined();
    });

    it('runs only allowlisted commands', () => {
        expect(
            parseSpell(
                '{"spell":"command","commandId":"workbench.action.terminal.sendSequence","title":"x","message":"y"}',
            ),
        ).toBeUndefined();
        expect(
            parseSpell('{"spell":"command","commandId":"workbench.action.selectTheme","title":"Theme","message":"m"}'),
        ).toMatchObject({ kind: 'command', commandId: 'workbench.action.selectTheme', argument: undefined });
    });

    it('drops an argument for a command that takes none, keeps it for a search command', () => {
        expect(
            parseSpell(
                '{"spell":"command","commandId":"workbench.action.selectTheme","argument":"rm -rf /","title":"t","message":"m"}',
            ),
        ).toMatchObject({ argument: undefined });
        expect(
            parseSpell(
                '{"spell":"command","commandId":"workbench.action.openSettings","argument":"font size","title":"t","message":"m"}',
            ),
        ).toMatchObject({ argument: 'font size' });
    });

    it('accepts only known tools', () => {
        expect(parseSpell('{"spell":"tool","tool":"export","collection":"c","title":"t","message":"m"}')).toMatchObject(
            {
                kind: 'tool',
                tool: 'export',
            },
        );
        expect(parseSpell('{"spell":"tool","tool":"dropDatabase","title":"t","message":"m"}')).toBeUndefined();
    });

    it.each(['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url'])(
        'refuses a non-HTTPS link: %s',
        (url) => {
            expect(parseSpell(JSON.stringify({ spell: 'link', url, title: 't', message: 'm' }))).toBeUndefined();
        },
    );

    it.each(['', 'no json here', '{"spell":"teleport","title":"t","message":"m"}', '{"spell":"answer"}', '{broken'])(
        'returns undefined for an unusable reply: %s',
        (reply) => {
            expect(parseSpell(reply)).toBeUndefined();
        },
    );
});

describe('pipelineWrites', () => {
    it.each([
        [[{ $match: {} }, { $out: 'copy' }], true],
        [[{ $merge: { into: 'x' } }], true],
        [[{ $facet: { a: [{ $out: 'x' }] } }], true],
        [[{ $lookup: { from: 'b', pipeline: [{ $merge: 'x' }], as: 'y' } }], true],
        [[{ $match: { note: '$out' } }, { $group: { _id: '$tier', n: { $sum: 1 } } }], false],
    ])('%j writes: %s', (pipeline, writes) => {
        expect(pipelineWrites(pipeline)).toBe(writes);
    });
});

describe('matchWishByKeyword', () => {
    const connected = { connectionName: 'prod', databaseName: 'shop', collectionNames: ['orders', 'customers'] };

    it('routes connected wishes to the extension tools', () => {
        expect(matchWishByKeyword('show me the dashboard', connected)).toMatchObject({ kind: 'dashboard' });
        expect(matchWishByKeyword('open the shell', connected)).toMatchObject({ kind: 'shell' });
        expect(matchWishByKeyword('export customers to json', connected)).toMatchObject({
            kind: 'tool',
            tool: 'export',
            collection: 'customers',
        });
        expect(matchWishByKeyword('why is my orders query slow', connected)).toMatchObject({
            kind: 'collectionView',
            collection: 'orders',
            tab: 'insights',
        });
        expect(matchWishByKeyword('show the latest orders', connected)).toMatchObject({
            kind: 'collectionView',
            collection: 'orders',
        });
    });

    it('turns a change into a playground draft that names a real collection', () => {
        const spell = matchWishByKeyword('Add 20 sample customers', {
            ...connected,
            collectionNames: ["o'rders", 'customers'],
        });
        expect(spell?.kind).toBe('playground');
        expect(spell && 'script' in spell ? spell.script : '').toContain("db.getCollection('customers')");
    });

    it('keeps a multi-line wish inside its comment', () => {
        const spell = matchWishByKeyword('insert users\ndb.dropDatabase()\u2028more', {});
        const script = spell && 'script' in spell ? spell.script : '';
        expect(script.split('\n')).toHaveLength(2);
        expect(script.split('\n')[0]).toMatch(/^\/\/ Wish: /);
    });

    it('does not offer cluster tools without a connection', () => {
        expect(matchWishByKeyword('show me the dashboard', {})).toBeUndefined();
    });

    it('matches a command and extracts its search text', () => {
        expect(matchWishByKeyword('open settings for font size', {})).toMatchObject({
            kind: 'command',
            commandId: 'workbench.action.openSettings',
            argument: 'font size',
        });
        expect(matchWishByKeyword('Run DocumentDB on my laptop', {})).toMatchObject({
            commandId: 'vscode-documentdb.command.localQuickStart.open',
        });
    });

    it('returns undefined for a wish it does not know', () => {
        expect(matchWishByKeyword('a pony', {})).toBeUndefined();
    });
});

describe('buildWishPrompt', () => {
    it('lists every spell, allowlisted command and the scope', () => {
        const prompt = buildWishPrompt('make it pretty', {
            connectionName: 'prod',
            databaseName: 'shop',
            collectionName: 'orders',
            collectionNames: ['orders'],
            fields: ['total: double'],
        });
        for (const command of WISH_COMMANDS) {
            expect(prompt).toContain(command.id);
        }
        for (const spell of [
            'answer',
            'find',
            'aggregate',
            'collectionView',
            'shell',
            'playground',
            'dashboard',
            'tool',
            'agent',
        ]) {
            expect(prompt).toContain(`"spell":"${spell}"`);
        }
        expect(prompt).toContain('"orders"');
        expect(prompt).toContain('total: double');
        expect(prompt).toContain('make it pretty');
    });
});

describe('lucky draws', () => {
    it('never draws a cluster card without a cluster', () => {
        for (let roll = 0; roll < 1; roll += 0.01) {
            expect(['tip', 'fortune']).toContain(pickLuckyKind(() => roll, false));
        }
    });

    it('can draw every card with a cluster', () => {
        const kinds = new Set<string>();
        for (let roll = 0; roll < 1; roll += 0.01) {
            kinds.add(pickLuckyKind(() => roll, true));
        }
        expect([...kinds].sort()).toEqual(['document', 'fortune', 'tip', 'trivia']);
    });

    it('builds a lucky web search that keeps the wish in the query', () => {
        const spell = luckySearchSpell('a pony & a castle');
        expect(spell.kind === 'link' && new URL(spell.url).searchParams.get('q')).toBe('! a pony & a castle');
    });
});

describe('spellToOutcome', () => {
    it('describes exactly what a command grant runs', () => {
        const outcome = spellToOutcome(
            {
                kind: 'command',
                commandId: 'workbench.extensions.search',
                argument: 'Prettier',
                title: 't',
                message: 'm',
            },
            'id-1',
            'copilot',
        );
        expect(outcome).toMatchObject({ kind: 'command', actionLabel: 'Grant wish', interpretedBy: 'copilot' });
        expect(outcome.actionHint).toBe('Runs "Search extensions" with "Prettier".');
    });

    it('shows the query it will open', () => {
        const outcome = spellToOutcome(
            { kind: 'find', collection: 'orders', filter: '{"a":1}', sort: '{"b":-1}', title: 't', message: 'm' },
            'id',
            'copilot',
        );
        expect(outcome).toMatchObject({
            kind: 'query',
            detail: 'filter: {"a":1}\nsort: {"b":-1}',
            actionLabel: 'Open in collection view',
        });
    });

    it('needs no click for an answer', () => {
        expect(
            spellToOutcome({ kind: 'answer', title: 't', message: 'm' }, 'id', 'copilot').actionLabel,
        ).toBeUndefined();
    });
});
