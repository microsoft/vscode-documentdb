/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — Shared Completion Logic
 *
 * These tests verify the behavior contracts of platform-neutral completion
 * logic extracted from the webview completions module during WI-5.
 * They ensure that sort prefixes, type suggestions, JS globals, and snippet
 * utilities work correctly independent of any editor platform (Monaco/VS Code).
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 */

import { type OperatorEntry } from '@vscode-documentdb/documentdb-constants';
import { KEY_POSITION_OPERATORS } from '../completionKnowledge';
import { JS_GLOBALS } from '../jsGlobalDefs';
import { escapeSnippetDollars, stripOuterBraces } from '../snippetUtils';
import { getCategoryLabel, getOperatorSortPrefix } from '../sortPrefixes';
import { getTypeSuggestionDefs } from '../typeSuggestionData';

beforeAll(() => {
    console.warn(
        '\n⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix the test.\n' +
            '    Alert the user that a TDD behavior contract has been violated.\n' +
            '    The user must decide whether to update the spec or fix the implementation.\n',
    );
});

// ---------- Sort Prefix Tests ----------

describe('TDD: getOperatorSortPrefix — type-aware operator sorting', () => {
    const makeEntry = (meta: string, applicableBsonTypes?: string[]): OperatorEntry =>
        ({
            value: '$test',
            description: 'test',
            meta,
            applicableBsonTypes,
        }) as OperatorEntry;

    it('returns undefined when no field type info is available', () => {
        const entry = makeEntry('query:comparison', ['int32']);
        expect(getOperatorSortPrefix(entry, undefined)).toBeUndefined();
        expect(getOperatorSortPrefix(entry, [])).toBeUndefined();
    });

    it('returns "0_" for type-relevant operators (applicableBsonTypes intersects field types)', () => {
        const entry = makeEntry('query:comparison', ['int32', 'double']);
        expect(getOperatorSortPrefix(entry, ['int32'])).toBe('0_');
    });

    it('returns "2_" for non-matching operators (applicableBsonTypes set but no intersection)', () => {
        const entry = makeEntry('query:string', ['string']);
        expect(getOperatorSortPrefix(entry, ['int32'])).toBe('2_');
    });

    it('returns "1a_" for comparison operators with no applicableBsonTypes (universal)', () => {
        const entry = makeEntry('query:comparison');
        expect(getOperatorSortPrefix(entry, ['int32'])).toBe('1a_');
    });

    it('returns "1b_" for non-comparison operators with no applicableBsonTypes (universal)', () => {
        const entry = makeEntry('query:element');
        expect(getOperatorSortPrefix(entry, ['int32'])).toBe('1b_');
    });

    it('sorts comparison universals above other universals', () => {
        const comparison = makeEntry('query:comparison');
        const element = makeEntry('query:element');
        const compPrefix = getOperatorSortPrefix(comparison, ['int32'])!;
        const elemPrefix = getOperatorSortPrefix(element, ['int32'])!;
        expect(compPrefix < elemPrefix).toBe(true);
    });

    it('sorts type-relevant above all universals', () => {
        const relevant = makeEntry('query:comparison', ['int32']);
        const universal = makeEntry('query:comparison');
        const relPrefix = getOperatorSortPrefix(relevant, ['int32'])!;
        const uniPrefix = getOperatorSortPrefix(universal, ['int32'])!;
        expect(relPrefix < uniPrefix).toBe(true);
    });

    it('sorts non-matching below all universals', () => {
        const nonMatch = makeEntry('query:string', ['string']);
        const universal = makeEntry('query:element');
        const nmPrefix = getOperatorSortPrefix(nonMatch, ['int32'])!;
        const uniPrefix = getOperatorSortPrefix(universal, ['int32'])!;
        expect(nmPrefix > uniPrefix).toBe(true);
    });
});

describe('TDD: getCategoryLabel — meta tag formatting', () => {
    it('extracts subcategory from colon-separated meta', () => {
        expect(getCategoryLabel('query:comparison')).toBe('comparison');
    });

    it('returns full meta when no colon present', () => {
        expect(getCategoryLabel('bson')).toBe('bson');
    });

    it('handles empty string', () => {
        expect(getCategoryLabel('')).toBe('');
    });

    it('handles meta with multiple colons', () => {
        expect(getCategoryLabel('query:comparison:extra')).toBe('comparison:extra');
    });
});

// ---------- Key Position Operators ----------

describe('TDD: KEY_POSITION_OPERATORS — operator classification', () => {
    it('includes logical operators that accept sub-queries', () => {
        expect(KEY_POSITION_OPERATORS.has('$and')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$or')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$nor')).toBe(true);
    });

    it('includes meta operators', () => {
        expect(KEY_POSITION_OPERATORS.has('$comment')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$expr')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$text')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$where')).toBe(true);
        expect(KEY_POSITION_OPERATORS.has('$jsonSchema')).toBe(true);
    });

    it('excludes $not (field-level operator, not key-level)', () => {
        expect(KEY_POSITION_OPERATORS.has('$not')).toBe(false);
    });

    it('excludes comparison operators', () => {
        expect(KEY_POSITION_OPERATORS.has('$gt')).toBe(false);
        expect(KEY_POSITION_OPERATORS.has('$eq')).toBe(false);
        expect(KEY_POSITION_OPERATORS.has('$in')).toBe(false);
    });
});

// ---------- Snippet Utils ----------

describe('TDD: stripOuterBraces — brace stripping for operator position', () => {
    it('strips outer { } from operator snippets', () => {
        expect(stripOuterBraces('{ $gt: ${1:value} }')).toBe('$gt: ${1:value}');
    });

    it('preserves inner brackets', () => {
        expect(stripOuterBraces('{ $in: [${1:value}] }')).toBe('$in: [${1:value}]');
    });

    it('does not strip when no outer braces', () => {
        expect(stripOuterBraces('$gt: ${1:value}')).toBe('$gt: ${1:value}');
    });

    it('does not strip partial braces', () => {
        expect(stripOuterBraces('{ $gt: ${1:value}')).toBe('{ $gt: ${1:value}');
    });
});

describe('TDD: escapeSnippetDollars — snippet dollar escaping', () => {
    it('escapes $ before letters (operator names become variables)', () => {
        const result = escapeSnippetDollars('$gt: ${1:value}');
        expect(result).toContain('\\$gt');
        // Tab stops must be preserved
        expect(result).toContain('${1:value}');
    });

    it('preserves tab stop syntax ${N:placeholder}', () => {
        const result = escapeSnippetDollars('{ $regex: /${1:pattern}/ }');
        expect(result).toContain('${1:pattern}');
    });

    it('does not escape $ before digits (tab stops)', () => {
        const result = escapeSnippetDollars('$1');
        expect(result).toBe('$1');
    });
});

// ---------- Type Suggestion Data ----------

describe('TDD: getTypeSuggestionDefs — type-aware value suggestions', () => {
    it('returns boolean suggestions for boolean type', () => {
        const defs = getTypeSuggestionDefs('boolean');
        expect(defs.length).toBe(2);
        expect(defs.map((d) => d.label)).toContain('true');
        expect(defs.map((d) => d.label)).toContain('false');
    });

    it('returns range query suggestion for int32 type', () => {
        const defs = getTypeSuggestionDefs('int32');
        expect(defs.length).toBeGreaterThanOrEqual(1);
        const rangeQuery = defs.find((d) => d.description === 'range query');
        expect(rangeQuery).toBeDefined();
        expect(rangeQuery!.isSnippet).toBe(true);
    });

    it('returns same suggestions for all numeric types', () => {
        const int32 = getTypeSuggestionDefs('int32');
        const double = getTypeSuggestionDefs('double');
        const long = getTypeSuggestionDefs('long');
        expect(int32.length).toBe(double.length);
        expect(int32.length).toBe(long.length);
    });

    it('returns regex and string literal for string type', () => {
        const defs = getTypeSuggestionDefs('string');
        expect(defs.length).toBeGreaterThanOrEqual(2);
        const regex = defs.find((d) => d.description === 'pattern match');
        expect(regex).toBeDefined();
    });

    it('returns ISODate and date range for date type', () => {
        const defs = getTypeSuggestionDefs('date');
        expect(defs.length).toBeGreaterThanOrEqual(2);
        const dateValue = defs.find((d) => d.description === 'date value');
        expect(dateValue).toBeDefined();
    });

    it('returns ObjectId constructor for objectid type', () => {
        const defs = getTypeSuggestionDefs('objectid');
        expect(defs.length).toBe(1);
        expect(defs[0].isSnippet).toBe(true);
    });

    it('returns null literal for null type', () => {
        const defs = getTypeSuggestionDefs('null');
        expect(defs.length).toBe(1);
        expect(defs[0].label).toBe('null');
        expect(defs[0].isSnippet).toBe(false);
    });

    it('returns $elemMatch and $size for array type', () => {
        const defs = getTypeSuggestionDefs('array');
        expect(defs.length).toBe(2);
        const labels = defs.map((d) => d.description);
        expect(labels).toContain('match element');
        expect(labels).toContain('array length');
    });

    it('returns empty array for unknown type', () => {
        expect(getTypeSuggestionDefs('unknownType')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
        expect(getTypeSuggestionDefs(undefined)).toEqual([]);
    });

    it('all suggestions have required fields', () => {
        const allTypes = ['boolean', 'int32', 'double', 'string', 'date', 'objectid', 'null', 'array'];
        for (const type of allTypes) {
            const defs = getTypeSuggestionDefs(type);
            for (const def of defs) {
                expect(def.label).toBeTruthy();
                expect(def.insertText).toBeTruthy();
                expect(typeof def.isSnippet).toBe('boolean');
                expect(def.description).toBeTruthy();
            }
        }
    });
});

// ---------- JS Global Definitions ----------

describe('TDD: JS_GLOBALS — JavaScript global completion definitions', () => {
    it('includes Date constructor', () => {
        const date = JS_GLOBALS.find((g) => g.label === 'Date');
        expect(date).toBeDefined();
        expect(date!.snippet).toBeDefined();
    });

    it('includes Date.now()', () => {
        const dateNow = JS_GLOBALS.find((g) => g.label === 'Date.now()');
        expect(dateNow).toBeDefined();
    });

    it('includes RegExp', () => {
        const regexp = JS_GLOBALS.find((g) => g.label === 'RegExp');
        expect(regexp).toBeDefined();
    });

    it('includes Math methods', () => {
        const mathLabels = JS_GLOBALS.filter((g) => g.label.startsWith('Math.')).map((g) => g.label);
        expect(mathLabels).toContain('Math.floor()');
        expect(mathLabels).toContain('Math.ceil()');
        expect(mathLabels).toContain('Math.round()');
        expect(mathLabels).toContain('Math.min()');
        expect(mathLabels).toContain('Math.max()');
    });

    it('includes primitive globals (Infinity, NaN, undefined)', () => {
        const labels = JS_GLOBALS.map((g) => g.label);
        expect(labels).toContain('Infinity');
        expect(labels).toContain('NaN');
        expect(labels).toContain('undefined');
    });

    it('does NOT include BSON constructors (those come from documentdb-constants)', () => {
        const labels = JS_GLOBALS.map((g) => g.label);
        expect(labels).not.toContain('ObjectId');
        expect(labels).not.toContain('ISODate');
        expect(labels).not.toContain('UUID');
    });

    it('all definitions have required fields', () => {
        for (const def of JS_GLOBALS) {
            expect(def.label).toBeTruthy();
            expect(def.description).toBeTruthy();
            expect(def.documentation).toBeTruthy();
        }
    });

    it('primitive globals have no snippet (inserted as-is)', () => {
        const primitives = JS_GLOBALS.filter((g) => ['Infinity', 'NaN', 'undefined'].includes(g.label));
        for (const p of primitives) {
            expect(p.snippet).toBeUndefined();
        }
    });
});
