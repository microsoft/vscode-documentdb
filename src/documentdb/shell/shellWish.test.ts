/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseShellWish } from './shellWish';

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
