/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseShellWish, wishedCommandLines, withoutControlCharacters } from './shellWish';

describe('parseShellWish', () => {
    it.each([
        ['wish how many orders shipped last week', { kind: 'wish', text: 'how many orders shipped last week' }],
        ['  wish   open the dashboard  ', { kind: 'wish', text: 'open the dashboard' }],
        ['wish "find big orders"', { kind: 'wish', text: 'find big orders' }],
        ['wish me luck', { kind: 'lucky' }],
        ["wish I'm feeling lucky!", { kind: 'lucky' }],
        ['wish', { kind: 'usage' }],
        ['wish open', { kind: 'open' }],
        ['  wish   open  ', { kind: 'open' }],
        ['wish Open', { kind: 'open' }],
        ['wish open.', { kind: 'open' }],
        ['wish open!', { kind: 'open' }],
        ['wish open?', { kind: 'wish', text: 'open?' }],
        ['wish open please', { kind: 'wish', text: 'open please' }],
        ['wish opened orders', { kind: 'wish', text: 'opened orders' }],
        ['wish "open"', { kind: 'wish', text: 'open' }],
    ])('reads %j', (line, expected) => {
        expect(parseShellWish(line)).toEqual(expected);
    });

    it.each([
        'wish = 1',
        'wish == 2',
        'wish === 3',
        'wish(1)',
        'wish.length',
        'wish[0]',
        'wish;',
        'wish, other',
        'wish ? a : b',
        'wish + 1',
        'wish instanceof Object',
        'wishes are free',
        'db.wish.find()',
        'print("wish me luck")',
    ])('leaves JavaScript alone: %s', (line) => {
        expect(parseShellWish(line)).toBeUndefined();
    });
});

describe('wishedCommandLines', () => {
    it.each([
        ['db.orders.countDocuments()', ['db.orders.countDocuments()']],
        ['db.orders.find() // all of them', ['db.orders.find() // all of them']],
        ['db.orders.find()\r\n\n  .sort({ total: -1 })\n', ['db.orders.find()', '.sort({ total: -1 })']],
        ['db.orders.find()\n.limit(5) // five', ['db.orders.find()', '.limit(5) // five']],
    ])('keeps the lines of %j', (command, expected) => {
        expect(wishedCommandLines(command)).toEqual(expected);
    });

    it('refuses lines a comment would swallow once joined', () => {
        expect(wishedCommandLines('db.orders.find() // big ones\n.limit(5)')).toBeUndefined();
    });

    it('keeps lines inside an open bracket, which join into the same call', () => {
        expect(wishedCommandLines('db.orders.find({\n  total: { $gt: 300 }\n})')).toEqual([
            'db.orders.find({',
            'total: { $gt: 300 }',
            '})',
        ]);
    });

    it.each(['use shop\ndb.orders.find()', 'const n = db.orders.countDocuments()\nprint(n)'])(
        'refuses separate statements, which would join into a different command: %j',
        (command) => {
            expect(wishedCommandLines(command)).toBeUndefined();
        },
    );
});

describe('withoutControlCharacters', () => {
    it('drops the escapes a terminal would act on and keeps line breaks', () => {
        const escape = String.fromCharCode(27);
        expect(withoutControlCharacters(`db.a.drop();//${escape}[2K\u0085x\ty\nz`)).toBe('db.a.drop();//[2Kx y\nz');
    });
});
