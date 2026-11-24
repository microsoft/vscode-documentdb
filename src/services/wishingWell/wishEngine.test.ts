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
    cannotGrantSpell,
    matchWishByKeyword,
    parseAgentSpell,
    parseSpell,
    parseSpellResult,
    pickLuckyKind,
    pipelineWrites,
    spellToOutcome,
    WISH_COMMANDS,
    wishExamples,
    writeAggregateToPlayground,
    type Spell,
    type WishExampleScope,
    type WishPromptScope,
} from './wishEngine';

describe('parseSpell', () => {
    it('reads a spell even when the model wraps it in a code fence', () => {
        const reply = '```json\n{"spell":"answer","title":"Hi","message":"An index is a sorted lookup."}\n```';
        expect(parseSpell(reply)).toEqual({ kind: 'answer', title: 'Hi', message: 'An index is a sorted lookup.' });
    });

    it('turns query objects into the JSON text the collection view takes, and keeps the limit for the read to clamp', () => {
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
            limit: 5000,
        });
    });

    it('leaves the limit out when the reply names none', () => {
        expect(parseSpell('{"spell":"find","collection":"orders","title":"t","message":"m"}')).toMatchObject({
            kind: 'find',
            limit: undefined,
        });
    });

    it('keeps the database a spell names, so a cluster-wide wish can read', () => {
        expect(
            parseSpell('{"spell":"find","database":" shop ","collection":"orders","title":"t","message":"m"}'),
        ).toMatchObject({ database: 'shop', collection: 'orders' });
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

describe('parseSpellResult', () => {
    const aggregate = (pipeline: unknown): string =>
        JSON.stringify({ spell: 'aggregate', collection: 'orders', pipeline, title: 't', message: 'm' });

    it.each([
        [[{ $match: {} }, { $out: 'copy' }], '$out'],
        [[{ $merge: { into: 'x' } }], '$merge'],
        [[{ $facet: { a: [{ $out: 'x' }] } }], '$out'],
        [[{ $lookup: { from: 'b', pipeline: [{ $merge: 'x' }], as: 'y' } }], '$merge'],
        ['[{"$match":{}},{"$out":"copy"}]', '$out'],
        ['[{"\\u0024merge":{"into":"x"}}]', '$merge'],
    ])('refuses a pipeline that writes: %j', (pipeline, stage) => {
        expect(parseSpellResult(aggregate(pipeline))).toEqual({
            reason: `aggregate pipeline uses ${stage}, which writes`,
        });
    });

    it('keeps a pipeline that only mentions $out as a value', () => {
        expect(parseSpellResult(aggregate([{ $match: { note: '$out' } }])).spell).toMatchObject({
            kind: 'aggregate',
            pipeline: '[{"$match":{"note":"$out"}}]',
        });
    });

    it.each([
        [aggregate('[{ $out: "x" }]'), '"pipeline" is not valid JSON'],
        [aggregate({ $match: {} }), '"pipeline" must be a list of stages'],
        ['{"spell":"aggregate","collection":"c","title":"t","message":"m"}', '"pipeline" is required for aggregate'],
        ['{"spell":"collectionView","tab":"queryInsights","title":"t","message":"m"}', '"tab"'],
        ['{"spell":"teleport","title":"t","message":"m"}', '"spell"'],
        ['{"spell":"answer","title":"t"}', '"message"'],
        [
            '{"spell":"command","commandId":"workbench.action.terminal.sendSequence","title":"t","message":"m"}',
            'commandId',
        ],
        ['{"spell":"link","url":"http://example.com","title":"t","message":"m"}', '"url" must be an https:// link'],
        ['no json here', 'no JSON object'],
        ['{broken}', 'not valid JSON'],
    ])('names what failed: %s', (reply, reason) => {
        const result = parseSpellResult(reply);
        expect(result.spell).toBeUndefined();
        expect(result.reason).toContain(reason);
    });

    it('agrees with parseSpell on a valid reply', () => {
        const reply = '{"spell":"dashboard","title":"t","message":"m"}';
        expect(parseSpellResult(reply)).toEqual({ spell: parseSpell(reply) });
    });
});

describe('writeAggregateToPlayground', () => {
    const reply = (fields: Record<string, unknown>): string =>
        JSON.stringify({ spell: 'aggregate', title: 'Archive', message: 'Archived them.', ...fields });
    const pipeline = [{ $match: { status: 'old' } }, { $out: 'archive' }];

    it('drafts a pipeline that writes in a playground, without the reply claiming it ran', () => {
        const spell = writeAggregateToPlayground(reply({ collection: "o'rders", pipeline }));
        expect(spell).toMatchObject({
            kind: 'playground',
            title: 'Archive',
            message:
                'This pipeline writes with $out, so the well drafted it in a playground for you to review and run.',
        });
        const [comment, ...code] = (spell?.kind === 'playground' ? spell.script : '').split('\n');
        expect(comment).toMatch(/^\/\/ .*\$out/);
        expect(code.join('\n')).toBe(
            `db.getCollection('o\\'rders').aggregate(${JSON.stringify(pipeline, undefined, 2)})`,
        );
    });

    it('aims at the database the reply names, where the stage writes', () => {
        const spell = writeAggregateToPlayground(reply({ database: 'shop', pipeline: '[{"$merge":{"into":"x"}}]' }));
        expect(spell?.kind === 'playground' ? spell.script : '').toContain(
            "db.getSiblingDB('shop').getCollection('collectionName').aggregate([",
        );
        expect(spell?.message).toContain('$merge');
    });

    it.each([
        reply({ collection: 'orders', pipeline: [{ $match: {} }] }),
        reply({ collection: 'orders', pipeline: '[{ $out: "x" }]' }),
        reply({ collection: 'orders', pipeline: { $out: 'x' } }),
        JSON.stringify({ spell: 'aggregate', collection: 'orders', pipeline, title: 't' }),
        JSON.stringify({ spell: 'find', collection: 'orders', title: 't', message: 'm' }),
        'no json here',
    ])('leaves a reply that parses, or is refused for another reason, alone: %s', (text) => {
        expect(writeAggregateToPlayground(text)).toBeUndefined();
    });
});

describe('parseAgentSpell', () => {
    it('builds the card text from the spell, never by repeating the wish', () => {
        const wish = 'top 3 customers by order total';
        const result = parseAgentSpell({ spell: 'aggregate', collection: 'orders', pipeline: [{ $limit: 3 }] }, wish);
        expect(result.spell).toMatchObject({
            kind: 'aggregate',
            title: 'Aggregation on orders',
            message: 'Runs a read-only aggregation on orders.',
        });
        expect(result.spell?.title).not.toContain(wish);
        expect(result.spell?.message).not.toContain(wish);
    });

    it('names the destination and the database when the spell has them', () => {
        expect(
            parseAgentSpell({ spell: 'collectionView', database: 'shop', collection: 'orders', tab: 'insights' }, 'w')
                .spell,
        ).toMatchObject({ title: 'Query Insights for shop.orders', message: 'Opens Query Insights for shop.orders.' });
    });

    it("keeps the agent's own title and message", () => {
        expect(
            parseAgentSpell({ spell: 'dashboard', title: 'Health', message: 'See how the cluster is doing.' }, 'w')
                .spell,
        ).toMatchObject({ title: 'Health', message: 'See how the cluster is doing.' });
    });

    it('needs the answer itself for an answer spell', () => {
        expect(parseAgentSpell({ spell: 'answer', title: 'Indexes' }, 'what is an index')).toEqual({
            reason: '"message" is required for an answer: it holds the answer',
        });
    });

    it('hands the wish to Copilot when an agent spell has no prompt of its own', () => {
        expect(parseAgentSpell({ spell: 'agent' }, 'write a README').spell).toMatchObject({
            kind: 'agent',
            prompt: 'write a README',
            title: 'A job for Copilot',
        });
    });

    it('refuses a pipeline that writes, with the reason', () => {
        expect(
            parseAgentSpell({ spell: 'aggregate', collection: 'orders', pipeline: [{ $out: 'copy' }] }, 'copy orders'),
        ).toEqual({ reason: 'aggregate pipeline uses $out, which writes' });
    });
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
            title: 'Query Insights for orders',
        });
        expect(matchWishByKeyword('manage the indexes of orders', connected)).toMatchObject({
            tab: 'indexes',
            title: 'Indexes of orders',
        });
        expect(matchWishByKeyword('show the latest orders', connected)).toMatchObject({
            kind: 'collectionView',
            collection: 'orders',
        });
    });

    it.each([
        ['How many documents are in each collection?'],
        ['How big is each database?'],
        ['show the documents per collection'],
        ['list the collections'],
        ['which collection sizes are largest'],
        ['how large are my collections'],
    ])('sends a question the dashboard answers to the dashboard: %s', (wish) => {
        expect(matchWishByKeyword(wish, connected)).toMatchObject({ kind: 'dashboard' });
        expect(matchWishByKeyword(wish, {})?.kind).not.toBe('dashboard');
    });

    it.each(['how big is order 5', 'how large is the biggest order'])(
        'keeps a question about one item off the dashboard: %s',
        (wish) => {
            expect(matchWishByKeyword(wish, connected)?.kind).not.toBe('dashboard');
        },
    );

    it.each([
        'show the latest update to orders',
        'which documents did I delete from orders',
        'how many orders were updated today',
        'list the orders I removed',
    ])('reads a question about changes instead of drafting a write: %s', (wish) => {
        expect(matchWishByKeyword(wish, connected)).toMatchObject({ kind: 'collectionView', collection: 'orders' });
    });

    it.each([
        [
            'count the orders over 300',
            'Without Copilot I can open orders, but I did not apply the filter or run the count.',
        ],
        [
            'Show the 5 newest documents in orders',
            'Without Copilot I can open orders, but I did not apply the sort order or the limit.',
        ],
        ['show the latest orders', 'Without Copilot I can open orders, but I did not apply the sort order.'],
        ['show me orders from last week', 'Without Copilot I can open orders, but I did not apply the filter.'],
        ['export the orders with status open', 'Without Copilot I can export orders, but I did not apply the filter.'],
        ['show the first 10 orders', 'Without Copilot I can open orders, but I did not apply the limit.'],
        ['show orders from the last 3 days', 'Without Copilot I can open orders, but I did not apply the filter.'],
    ])('says what it left out of "%s"', (wish, message) => {
        expect(matchWishByKeyword(wish, connected)?.message).toBe(message);
    });

    it('does not take a value in the wish for a limit', () => {
        expect(matchWishByKeyword('show orders for customer 42', connected)?.message).not.toContain('the limit');
    });

    it('promises nothing it skipped when it kept the whole wish', () => {
        expect(matchWishByKeyword('show the documents in orders', connected)?.message).not.toContain('did not');
    });

    const scriptOf = (spell: Spell | undefined): string => (spell?.kind === 'playground' ? spell.script : '');

    /** Lines that would write if the user ran the draft as it is. */
    const liveWrites = (script: string): string[] =>
        script
            .split('\n')
            .filter(
                (line) =>
                    !line.startsWith('//') &&
                    /\.(insert|update|delete|replace|bulkWrite|drop|createIndex|dropIndex)/.test(line),
            );

    it.each([
        'Add 20 sample customers',
        'seed some customers',
        'update the customers',
        'remove the email field from customers',
        'remove the tag from all orders',
        'delete the cancelled orders',
        'please add 20 sample customers',
        'Could you please delete the cancelled orders',
        "let's update the customers",
        'Draft a script to insert sample customers',
        'Help me insert sample customers',
        'I need to delete the old orders',
        'add a tag to all orders',
        'mark all pending orders as shipped',
        'find all test orders and delete them',
    ])('never drafts a write without Copilot, and lists the calls to choose from: %s', (wish) => {
        const spell = matchWishByKeyword(wish, { collectionNames: ['customers', 'orders'] });
        expect(spell?.kind).toBe('playground');
        const script = scriptOf(spell);
        expect(script.split('\n')[0]).toBe(`// Wish: ${wish}`);
        expect(liveWrites(script)).toEqual([]);
        expect(script).toContain('//   deleteMany({ <filter> })   // cannot be undone');
        expect(script).toMatch(/db\.getCollection\('(customers|orders)'\)\.find\(\{\}\)$/);
    });

    it('turns a change into a playground draft that names a real collection', () => {
        const spell = matchWishByKeyword('Add 20 sample customers', {
            ...connected,
            collectionNames: ["o'rders", 'customers'],
        });
        expect(spell?.kind).toBe('playground');
        expect(scriptOf(spell)).toContain("db.getCollection('customers')");
    });

    it('drafts a read when a playground wish asks for no change', () => {
        expect(scriptOf(matchWishByKeyword('show the latest update to orders in a playground', connected))).toBe(
            [
                '// Wish: show the latest update to orders in a playground',
                '// Copilot is not available to write this query. Start from this find and add a filter, sort or limit.',
                "db.getCollection('orders').find({})",
            ].join('\n'),
        );
    });

    it('keeps a multi-line wish inside its comment', () => {
        const lines = scriptOf(matchWishByKeyword('insert users\ndb.dropDatabase() more', {})).split('\n');
        expect(lines[0]).toMatch(/^\/\/ Wish: /);
        expect(lines.filter((line) => line.includes('dropDatabase'))).toEqual([lines[0]]);
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

describe('wishExamples', () => {
    const scopes: [string, WishExampleScope][] = [
        ['no connection', { connected: false }],
        ['a cluster', { connected: true }],
        ['a database', { connected: true, databaseName: 'shop', collectionNames: ['orders', 'customers'] }],
        ['an empty database', { connected: true, databaseName: 'shop', collectionNames: [] }],
        ['a database with odd names', { connected: true, databaseName: 'shop', collectionNames: ['$weird', 'a.b'] }],
        ['a collection', { connected: true, databaseName: 'shop', collectionName: 'orders' }],
    ];

    const promptScope = (scope: WishExampleScope): WishPromptScope =>
        scope.connected
            ? {
                  connectionName: 'prod',
                  databaseName: scope.databaseName,
                  collectionName: scope.collectionName,
                  collectionNames: scope.collectionNames,
              }
            : {};

    it.each(scopes)('offers five keyword examples on %s, and the fallback grants every one', (_name, scope) => {
        const examples = wishExamples(scope, false);
        expect(examples).toHaveLength(5);
        for (const example of examples) {
            expect(matchWishByKeyword(example, promptScope(scope)), example).toBeDefined();
        }
    });

    it('names a real collection and opens that one', () => {
        const scope: WishExampleScope = { connected: true, databaseName: 'shop', collectionNames: ['orders'] };
        const examples = wishExamples(scope, false);
        expect(examples).toContain('Show the documents in orders');
        expect(matchWishByKeyword('Show the documents in orders', promptScope(scope))).toMatchObject({
            kind: 'collectionView',
            collection: 'orders',
        });
        expect(examples).toContain('How many documents are in each collection?');
    });

    it('never names a collection the keywords cannot find again', () => {
        const examples = wishExamples(scopes[4][1], false);
        expect(examples.join(' ')).not.toContain('$weird');
    });

    /** What a collection example promises to open; anything else misfires. */
    const promises: [RegExp, (name: string) => Record<string, unknown>][] = [
        [/^Show the documents in /, (name) => ({ kind: 'collectionView', collection: name })],
        [/^Show the indexes of /, (name) => ({ kind: 'collectionView', collection: name, tab: 'indexes' })],
        [/^Why is my query on /, (name) => ({ kind: 'collectionView', collection: name, tab: 'insights' })],
        [/^Export /, (name) => ({ kind: 'tool', tool: 'export', collection: name })],
        [
            /^Add sample documents to /,
            (name) => ({
                kind: 'playground',
                script: expect.stringContaining(`db.getCollection('${name}').find({})`),
            }),
        ],
    ];

    it.each(
        ['stats', 'health', 'shell', 'export', 'import', 'console', 'overview', 'dashboard'].flatMap(
            (name): [string, WishExampleScope][] => [
                [name, { connected: true, databaseName: 'shop', collectionName: name }],
                [name, { connected: true, databaseName: 'shop', collectionNames: [name] }],
            ],
        ),
    )('offers only examples that open what they say on a collection named %s (%j)', (name, scope) => {
        const general = wishExamples({ connected: true, databaseName: 'shop' }, false);
        const examples = wishExamples(scope, false);
        expect(examples).toHaveLength(5);
        for (const example of examples.filter((text) => !general.includes(text))) {
            const promise = promises.find(([pattern]) => pattern.test(example));
            expect(promise, example).toBeDefined();
            expect(matchWishByKeyword(example, promptScope(scope)), example).toMatchObject(promise?.[1](name) ?? {});
        }
    });

    it('suggests richer wishes when Copilot reads them', () => {
        const examples = wishExamples({ connected: true, databaseName: 'shop', collectionName: 'orders' }, true);
        expect(examples).toHaveLength(5);
        expect(examples).toContain('Count the documents in orders');
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
        expect(prompt).toContain('"database"');
        expect(prompt).toContain('"orders"');
        expect(prompt).toContain('total: double');
        expect(prompt).toContain('make it pretty');
        // A limit in the example would ride along on every find and cap the collection view.
        expect(prompt).not.toContain('"limit":20');
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
});

describe('cannotGrantSpell', () => {
    it.each([false, true])('says honestly that it could not grant, with nothing to click (Copilot: %s)', (copilot) => {
        const spell = cannotGrantSpell(copilot);
        expect(spell.kind).toBe('answer');
        const outcome = spellToOutcome(spell, 'id', 'well', 'a pony');
        expect(outcome).toMatchObject({ status: 'info', wish: 'a pony' });
        expect(outcome.actionLabel).toBeUndefined();
    });

    it('lists what the keyword well can do', () => {
        expect(cannotGrantSpell(false).message).toContain('Without Copilot');
        expect(cannotGrantSpell(true).message).not.toContain('Without Copilot');
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
        expect(outcome).toMatchObject({
            kind: 'command',
            actionLabel: 'Search extensions',
            interpretedBy: 'copilot',
            status: 'proposed',
        });
        expect(outcome.actionHint).toBe('Runs "Search extensions" with "Prettier".');
    });

    it('labels a command the well does not know with the generic action', () => {
        expect(
            spellToOutcome({ kind: 'command', commandId: 'x.unknown', title: 't', message: 'm' }, 'id', 'agent'),
        ).toMatchObject({ actionLabel: 'Grant wish', actionHint: 'Runs "x.unknown".' });
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
            actionHint: 'Opens orders in the collection view with this query.',
        });
    });

    it.each<[Spell, string, string]>([
        [
            { kind: 'collectionView', collection: 'orders', tab: 'insights', title: 't', message: 'm' },
            'Open Query Insights',
            'Opens Query Insights for orders.',
        ],
        [
            { kind: 'collectionView', collection: 'orders', tab: 'indexes', title: 't', message: 'm' },
            'Open the indexes',
            'Opens the indexes of orders.',
        ],
        [
            { kind: 'collectionView', database: 'shop', collection: 'orders', title: 't', message: 'm' },
            'Open in collection view',
            'Opens shop.orders in the collection view.',
        ],
        [
            { kind: 'find', collection: 'orders', limit: 20, title: 't', message: 'm' },
            'Open in collection view',
            'Opens orders in the collection view.',
        ],
    ])('names the destination and mentions a query only when there is one: %j', (spell, label, hint) => {
        expect(spellToOutcome(spell, 'id', 'well')).toMatchObject({ actionLabel: label, actionHint: hint });
    });

    it('echoes the wish and needs no click for an answer', () => {
        const outcome = spellToOutcome({ kind: 'answer', title: 't', message: 'm' }, 'id', 'copilot', 'what is it');
        expect(outcome).toMatchObject({ status: 'info', wish: 'what is it' });
        expect(outcome.actionLabel).toBeUndefined();
        expect(spellToOutcome({ kind: 'answer', title: 't', message: 'm' }, 'id', 'well').wish).toBeUndefined();
    });
});

describe('keyword change detection', () => {
    const shop: WishPromptScope = {
        connectionName: 'prod',
        databaseName: 'shop',
        collectionNames: ['orders', 'customers'],
    };

    it.each([
        'Help me insert sample customers',
        'I need to delete the old orders',
        "I'd like to add 20 sample customers",
        'Now delete the cancelled orders',
        'Kindly remove the test customers',
        'create a playground to remove cancelled orders',
        'Find and delete duplicate customers',
    ])('drafts a playground for the change "%s"', (wish) => {
        expect(matchWishByKeyword(wish, shop)?.kind).toBe('playground');
    });

    it.each([
        'show the latest update to orders',
        'which orders did I delete',
        'Can you show me the latest update to orders',
        'I want to see orders with status set to shipped',
        'Help me find orders to remove',
        'Check which orders have the delete flag',
        'Add up the order totals',
        'set up a database with sample data',
        'get the data set of orders',
        'orders with add-ons',
        'Create a query to find orders over 100',
    ])('does not treat the read "%s" as a change', (wish) => {
        const spell = matchWishByKeyword(wish, shop);
        expect(spell?.kind === 'playground' ? spell.script : '').not.toContain('cannot write this change');
    });
});

describe('keyword limits and sizes', () => {
    const shop: WishPromptScope = { connectionName: 'prod', databaseName: 'shop', collectionNames: ['orders'] };

    it.each(['show 10 orders', 'show me 10 orders', 'list 3 orders', 'top 5 orders', 'latest 5 orders'])(
        'says it did not apply the limit in "%s"',
        (wish) => {
            expect(matchWishByKeyword(wish, shop)?.message).toContain('the limit');
        },
    );

    it('treats a number after a noun as a value, not a limit', () => {
        expect(matchWishByKeyword('show orders for customer 42', shop)?.message ?? '').not.toContain('the limit');
    });

    it('answers the size of a named collection with the dashboard', () => {
        expect(matchWishByKeyword('how big is orders', shop)).toMatchObject({ kind: 'dashboard' });
        expect(matchWishByKeyword('how big is order 5', shop)?.kind).not.toBe('dashboard');
    });
});

describe('writeAggregateToPlayground extras', () => {
    it('falls back to the scope collection and never cuts the pipeline', () => {
        const big = 'x'.repeat(20_000);
        const reply = JSON.stringify({
            spell: 'aggregate',
            pipeline: [{ $match: { note: big } }, { $out: 'archive' }],
            title: 't',
            message: 'm',
        });
        const spell = writeAggregateToPlayground(reply, 'orders');
        const script = spell?.kind === 'playground' ? spell.script : '';
        expect(script).toContain("db.getCollection('orders')");
        expect(script).toContain(big);
        expect(script.endsWith(')')).toBe(true);
    });

    it('keeps extended JSON types through EJSON.parse', () => {
        const reply = JSON.stringify({
            spell: 'aggregate',
            collection: 'orders',
            pipeline: [{ $match: { at: { $gte: { $date: '2024-01-01T00:00:00Z' } } } }, { $merge: 'x' }],
            title: 't',
            message: 'm',
        });
        const spell = writeAggregateToPlayground(reply);
        expect(spell?.kind === 'playground' ? spell.script : '').toContain('.aggregate(EJSON.parse(');
    });
});
