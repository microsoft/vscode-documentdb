/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenSpan } from './monarchRunner';
import { colorizeInput } from './tokenColorizer';

const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const GRAY = '\x1b[90m';
const RED = '\x1b[31m';

/** Helper: create a TokenSpan. */
function span(start: number, end: number, type: string): TokenSpan {
    return { start, end, type };
}

describe('tokenColorizer', () => {
    describe('keywords', () => {
        it('should colorize keywords in cyan', () => {
            const result = colorizeInput('const', [span(0, 5, 'keyword')]);
            expect(result).toBe(`${CYAN}const${RESET}`);
        });
    });

    describe('strings', () => {
        it('should colorize strings in green', () => {
            const result = colorizeInput('"hello"', [span(0, 7, 'string')]);
            expect(result).toBe(`${GREEN}"hello"${RESET}`);
        });
    });

    describe('string escapes', () => {
        it('should colorize escape sequences in yellow', () => {
            const result = colorizeInput('\\n', [span(0, 2, 'string.escape')]);
            expect(result).toBe(`${YELLOW}\\n${RESET}`);
        });
    });

    describe('invalid strings', () => {
        it('should colorize unterminated strings in red', () => {
            const result = colorizeInput('"hello', [span(0, 6, 'string.invalid')]);
            expect(result).toBe(`${RED}"hello${RESET}`);
        });
    });

    describe('numbers', () => {
        it('should colorize integers in yellow', () => {
            const result = colorizeInput('42', [span(0, 2, 'number')]);
            expect(result).toBe(`${YELLOW}42${RESET}`);
        });

        it('should colorize floats in yellow', () => {
            const result = colorizeInput('3.14', [span(0, 4, 'number.float')]);
            expect(result).toBe(`${YELLOW}3.14${RESET}`);
        });

        it('should colorize hex numbers in yellow', () => {
            const result = colorizeInput('0xFF', [span(0, 4, 'number.hex')]);
            expect(result).toBe(`${YELLOW}0xFF${RESET}`);
        });
    });

    describe('comments', () => {
        it('should colorize line comments in gray', () => {
            const result = colorizeInput('// comment', [span(0, 10, 'comment')]);
            expect(result).toBe(`${GRAY}// comment${RESET}`);
        });

        it('should colorize doc comments in gray', () => {
            const result = colorizeInput('/** doc */', [span(0, 10, 'comment.doc')]);
            expect(result).toBe(`${GRAY}/** doc */${RESET}`);
        });
    });

    describe('regex', () => {
        it('should colorize regex in red', () => {
            const result = colorizeInput('/hello/', [span(0, 7, 'regexp')]);
            expect(result).toBe(`${RED}/hello/${RESET}`);
        });
    });

    describe('BSON constructors', () => {
        it('should colorize BSON constructors in cyan', () => {
            const result = colorizeInput('ObjectId', [span(0, 8, 'bson.constructor')]);
            expect(result).toBe(`${CYAN}ObjectId${RESET}`);
        });
    });

    describe('DocumentDB API operators', () => {
        it('should colorize DocumentDB operators in yellow', () => {
            const result = colorizeInput('$gt', [span(0, 3, 'documentdb.operator')]);
            expect(result).toBe(`${YELLOW}$gt${RESET}`);
        });
    });

    describe('shell commands', () => {
        it('should colorize shell commands in magenta', () => {
            const result = colorizeInput('show', [span(0, 4, 'shell.command')]);
            expect(result).toBe(`${MAGENTA}show${RESET}`);
        });
    });

    describe('uncolored tokens', () => {
        it('should not colorize identifiers', () => {
            const result = colorizeInput('foo', [span(0, 3, 'identifier')]);
            expect(result).toBe('foo');
        });

        it('should not colorize type.identifier', () => {
            const result = colorizeInput('MyClass', [span(0, 7, 'type.identifier')]);
            expect(result).toBe('MyClass');
        });

        it('should not colorize delimiters', () => {
            const result = colorizeInput(';', [span(0, 1, 'delimiter')]);
            expect(result).toBe(';');
        });

        it('should not colorize delimiter.bracket', () => {
            const result = colorizeInput('{', [span(0, 1, 'delimiter.bracket')]);
            expect(result).toBe('{');
        });
    });

    describe('empty input', () => {
        it('should return empty string for empty input', () => {
            expect(colorizeInput('', [])).toBe('');
        });
    });

    describe('full line integration', () => {
        it('should correctly colorize a mixed line', () => {
            const input = 'db.users.find({ $gt: 1 })';
            // Simulate tokens for this input:
            // db=identifier(0-2), .=delimiter(2-3), users=identifier(3-8),
            // .=delimiter(8-9), find=identifier(9-13), (=bracket(13-14),
            // {=bracket(14-15), $gt=documentdb.operator(16-19), :=delimiter(19-20),
            // 1=number(21-22), }=bracket(23-24), )=bracket(24-25)
            const tokens: TokenSpan[] = [
                span(0, 2, 'identifier'), // db
                span(2, 3, 'delimiter'), // .
                span(3, 8, 'identifier'), // users
                span(8, 9, 'delimiter'), // .
                span(9, 13, 'identifier'), // find
                span(13, 14, 'delimiter.bracket'), // (
                span(14, 15, 'delimiter.bracket'), // {
                span(16, 19, 'documentdb.operator'), // $gt
                span(19, 20, 'delimiter'), // :
                span(21, 22, 'number'), // 1
                span(23, 24, 'delimiter.bracket'), // }
                span(24, 25, 'delimiter.bracket'), // )
            ];

            const result = colorizeInput(input, tokens);

            // Verify key colorized parts are present
            expect(result).toContain(`${YELLOW}$gt${RESET}`);
            expect(result).toContain(`${YELLOW}1${RESET}`);
            // Uncolored parts should appear without ANSI codes
            expect(result).toContain('db');
            expect(result).toContain('users');
            expect(result).toContain('find');
        });
    });

    describe('gaps between tokens', () => {
        it('should emit uncolored text for gaps between tokens', () => {
            const input = 'a b';
            const tokens: TokenSpan[] = [span(0, 1, 'identifier'), span(2, 3, 'identifier')];
            const result = colorizeInput(input, tokens);
            expect(result).toBe('a b');
        });
    });

    describe('trailing text after last token', () => {
        it('should emit trailing text after the last token', () => {
            const input = 'abc';
            const tokens: TokenSpan[] = [span(0, 2, 'keyword')];
            const result = colorizeInput(input, tokens);
            expect(result).toBe(`${CYAN}ab${RESET}c`);
        });
    });
});
