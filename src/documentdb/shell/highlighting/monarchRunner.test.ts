/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shellLanguageRules } from './monarchRules';
import { tokenize } from './monarchRunner';

/** Helper: extract tokens as [text, type] pairs for readable assertions. */
function tokenPairs(input: string): Array<[string, string]> {
    return tokenize(input, shellLanguageRules).map((t) => [input.slice(t.start, t.end), t.type]);
}

describe('MonarchRunner', () => {
    describe('keywords', () => {
        it('should tokenize "const" as a keyword', () => {
            const pairs = tokenPairs('const x = 1');
            expect(pairs[0]).toEqual(['const', 'keyword']);
        });

        it('should tokenize "let" as a keyword', () => {
            const pairs = tokenPairs('let y');
            expect(pairs[0]).toEqual(['let', 'keyword']);
        });

        it('should tokenize "function" as a keyword', () => {
            const pairs = tokenPairs('function foo() {}');
            expect(pairs[0]).toEqual(['function', 'keyword']);
        });

        it('should tokenize "return" as a keyword', () => {
            const pairs = tokenPairs('return true');
            expect(pairs[0]).toEqual(['return', 'keyword']);
            expect(pairs[1]).toEqual(['true', 'keyword']);
        });
    });

    describe('strings', () => {
        it('should tokenize a double-quoted string', () => {
            const pairs = tokenPairs('"hello world"');
            // The quotes and content are tokenized as string tokens
            const stringTokens = pairs.filter(([, type]) => type === 'string');
            expect(stringTokens.length).toBeGreaterThan(0);
            // The full span should cover the entire input
            const tokens = tokenize('"hello world"', shellLanguageRules);
            const fullText = tokens.map((t) => '"hello world"'.slice(t.start, t.end)).join('');
            expect(fullText).toBe('"hello world"');
        });

        it('should tokenize a single-quoted string', () => {
            const tokens = tokenize("'hello'", shellLanguageRules);
            const types = tokens.map((t) => t.type);
            expect(types.every((t) => t === 'string' || t === 'string.escape')).toBe(true);
        });

        it('should tokenize an unterminated double-quoted string as string.invalid', () => {
            const pairs = tokenPairs('"hello');
            expect(pairs.some(([, type]) => type === 'string.invalid')).toBe(true);
        });

        it('should tokenize an unterminated single-quoted string as string.invalid', () => {
            const pairs = tokenPairs("'hello");
            expect(pairs.some(([, type]) => type === 'string.invalid')).toBe(true);
        });
    });

    describe('template literals', () => {
        it('should tokenize a template literal', () => {
            const input = '`hello ${name}`';
            const tokens = tokenize(input, shellLanguageRules);
            const types = tokens.map((t) => t.type);
            // Should contain string parts and delimiter.bracket for ${ and }
            expect(types).toContain('string');
            expect(types).toContain('delimiter.bracket');
            expect(types).toContain('identifier');
        });
    });

    describe('numbers', () => {
        it('should tokenize an integer', () => {
            const pairs = tokenPairs('42');
            expect(pairs[0]).toEqual(['42', 'number']);
        });

        it('should tokenize a float', () => {
            const pairs = tokenPairs('3.14');
            expect(pairs[0]).toEqual(['3.14', 'number.float']);
        });

        it('should tokenize a hex number', () => {
            const pairs = tokenPairs('0xFF');
            expect(pairs[0]).toEqual(['0xFF', 'number.hex']);
        });

        it('should tokenize an octal number', () => {
            const pairs = tokenPairs('0o77');
            expect(pairs[0]).toEqual(['0o77', 'number.octal']);
        });

        it('should tokenize a binary number', () => {
            const pairs = tokenPairs('0b1010');
            expect(pairs[0]).toEqual(['0b1010', 'number.binary']);
        });

        it('should tokenize a number with exponent', () => {
            const pairs = tokenPairs('1e10');
            expect(pairs[0]).toEqual(['1e10', 'number.float']);
        });
    });

    describe('comments', () => {
        it('should tokenize a line comment', () => {
            const pairs = tokenPairs('// a comment');
            expect(pairs[0]).toEqual(['// a comment', 'comment']);
        });

        it('should tokenize a block comment', () => {
            const pairs = tokenPairs('/* block */');
            // Block comment spans multiple tokens that get merged
            const types = [...new Set(pairs.map(([, type]) => type))];
            expect(types).toEqual(['comment']);
        });

        it('should tokenize a JSDoc comment', () => {
            const pairs = tokenPairs('/** doc */');
            const types = [...new Set(pairs.map(([, type]) => type))];
            expect(types).toEqual(['comment.doc']);
        });
    });

    describe('regex literals', () => {
        it('should tokenize a regex literal', () => {
            const input = '/^hello/i';
            const tokens = tokenize(input, shellLanguageRules);
            const types = tokens.map((t) => t.type);
            expect(types).toContain('regexp');
        });
    });

    describe('BSON constructors', () => {
        it('should tokenize ObjectId as bson.constructor', () => {
            const pairs = tokenPairs('ObjectId("abc")');
            expect(pairs[0]).toEqual(['ObjectId', 'bson.constructor']);
        });

        it('should tokenize ISODate as bson.constructor', () => {
            const pairs = tokenPairs('ISODate("2025-01-01")');
            expect(pairs[0]).toEqual(['ISODate', 'bson.constructor']);
        });

        it('should tokenize NumberLong as bson.constructor', () => {
            const pairs = tokenPairs('NumberLong(42)');
            expect(pairs[0]).toEqual(['NumberLong', 'bson.constructor']);
        });

        it('should tokenize MinKey as bson.constructor', () => {
            const pairs = tokenPairs('MinKey()');
            expect(pairs[0]).toEqual(['MinKey', 'bson.constructor']);
        });

        it('should tokenize MaxKey as bson.constructor', () => {
            const pairs = tokenPairs('MaxKey()');
            expect(pairs[0]).toEqual(['MaxKey', 'bson.constructor']);
        });

        it('should not tokenize unknown PascalCase as bson.constructor', () => {
            const pairs = tokenPairs('MyClass');
            expect(pairs[0]).toEqual(['MyClass', 'type.identifier']);
        });
    });

    describe('DocumentDB API operators', () => {
        it('should tokenize $gt as documentdb.operator', () => {
            const input = '{ $gt: 5 }';
            const tokens = tokenize(input, shellLanguageRules);
            const op = tokens.find((t) => input.slice(t.start, t.end) === '$gt');
            expect(op).toBeDefined();
            expect(op!.type).toBe('documentdb.operator');
        });

        it('should tokenize $match as documentdb.operator', () => {
            const pairs = tokenPairs('$match');
            expect(pairs[0]).toEqual(['$match', 'documentdb.operator']);
        });

        it('should tokenize $lookup as documentdb.operator', () => {
            const pairs = tokenPairs('$lookup');
            expect(pairs[0]).toEqual(['$lookup', 'documentdb.operator']);
        });
    });

    describe('shell commands', () => {
        it('should tokenize "show" as shell.command', () => {
            const pairs = tokenPairs('show dbs');
            expect(pairs[0]).toEqual(['show', 'shell.command']);
        });

        it('should tokenize "use" as shell.command', () => {
            const pairs = tokenPairs('use mydb');
            expect(pairs[0]).toEqual(['use', 'shell.command']);
        });

        it('should tokenize "exit" as shell.command', () => {
            const pairs = tokenPairs('exit');
            expect(pairs[0]).toEqual(['exit', 'shell.command']);
        });

        it('should tokenize "help" as shell.command', () => {
            const pairs = tokenPairs('help');
            expect(pairs[0]).toEqual(['help', 'shell.command']);
        });

        it('should tokenize "it" as shell.command', () => {
            const pairs = tokenPairs('it');
            expect(pairs[0]).toEqual(['it', 'shell.command']);
        });
    });

    describe('mixed expressions', () => {
        it('should tokenize db.users.find({ name: "alice" })', () => {
            const input = 'db.users.find({ name: "alice" })';
            const tokens = tokenize(input, shellLanguageRules);

            // "db" is an identifier
            const db = tokens.find((t) => input.slice(t.start, t.end) === 'db');
            expect(db?.type).toBe('identifier');

            // "users" is an identifier
            const users = tokens.find((t) => input.slice(t.start, t.end) === 'users');
            expect(users?.type).toBe('identifier');

            // "find" is an identifier
            const find = tokens.find((t) => input.slice(t.start, t.end) === 'find');
            expect(find?.type).toBe('identifier');

            // "name" is an identifier
            const name = tokens.find((t) => input.slice(t.start, t.end) === 'name');
            expect(name?.type).toBe('identifier');

            // The string content is tokenized as string
            expect(tokens.some((t) => t.type === 'string')).toBe(true);

            // Brackets are proper delimiters
            expect(tokens.some((t) => t.type === 'delimiter.bracket')).toBe(true);
        });

        it('should tokenize { $gt: 5 } with correct types', () => {
            const input = '{ $gt: 5 }';
            const tokens = tokenize(input, shellLanguageRules);
            const pairs = tokens.map((t) => [input.slice(t.start, t.end), t.type]);

            expect(pairs).toEqual([
                ['{', 'delimiter.bracket'],
                ['$gt', 'documentdb.operator'],
                [':', 'delimiter'],
                ['5', 'number'],
                ['}', 'delimiter.bracket'],
            ]);
        });
    });

    describe('empty input', () => {
        it('should return empty array for empty string', () => {
            expect(tokenize('', shellLanguageRules)).toEqual([]);
        });
    });

    describe('caching', () => {
        it('should return the same result for the same input', () => {
            const result1 = tokenize('const x = 1', shellLanguageRules);
            const result2 = tokenize('const x = 1', shellLanguageRules);
            expect(result1).toBe(result2); // Same reference (cached)
        });

        it('should return different result for different input', () => {
            const result1 = tokenize('const x = 1', shellLanguageRules);
            const result2 = tokenize('let y = 2', shellLanguageRules);
            expect(result1).not.toBe(result2);
        });
    });

    describe('identifiers', () => {
        it('should tokenize regular identifiers', () => {
            const pairs = tokenPairs('foo');
            expect(pairs[0]).toEqual(['foo', 'identifier']);
        });

        it('should tokenize private identifiers with #', () => {
            const pairs = tokenPairs('#private');
            expect(pairs[0]).toEqual(['#private', 'identifier']);
        });
    });

    describe('delimiters', () => {
        it('should tokenize semicolons as delimiter', () => {
            const tokens = tokenize('a;b', shellLanguageRules);
            const semi = tokens.find((t) => 'a;b'.slice(t.start, t.end) === ';');
            expect(semi?.type).toBe('delimiter');
        });

        it('should tokenize dots as delimiter', () => {
            const tokens = tokenize('a.b', shellLanguageRules);
            const dot = tokens.find((t) => 'a.b'.slice(t.start, t.end) === '.');
            expect(dot?.type).toBe('delimiter');
        });
    });

    describe('operators', () => {
        it('should tokenize = as delimiter (operator)', () => {
            const input = 'x = 1';
            const tokens = tokenize(input, shellLanguageRules);
            const eq = tokens.find((t) => input.slice(t.start, t.end) === '=');
            expect(eq?.type).toBe('delimiter');
        });

        it('should tokenize === as delimiter (operator)', () => {
            const input = 'x === 1';
            const tokens = tokenize(input, shellLanguageRules);
            const eq = tokens.find((t) => input.slice(t.start, t.end) === '===');
            expect(eq?.type).toBe('delimiter');
        });
    });

    describe('escape sequences in strings', () => {
        it('should tokenize escape sequences in double-quoted strings', () => {
            const input = '"hello\\nworld"';
            const tokens = tokenize(input, shellLanguageRules);
            expect(tokens.some((t) => t.type === 'string.escape')).toBe(true);
        });
    });
});
