/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — HoverProvider + Edge Cases (WI-4)
 *
 * These tests define the expected behavior CONTRACT for:
 * - Scratchpad HoverProvider: operator hover, BSON hover, field hover
 * - Edge case handling: no-connection, empty file, comment position, unknown collection
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 */

import { getAllCompletions, loadOperators } from '@vscode-documentdb/documentdb-constants';
import { getScratchpadHoverContent } from '../ScratchpadHoverProvider';

// Ensure operators are loaded before tests
beforeAll(() => {
    loadOperators();
});

// =====================================================================
// Tests: ScratchpadHoverProvider — hover content generation
// =====================================================================

describe('TDD: ScratchpadHoverProvider', () => {
    beforeAll(() => {
        console.warn(
            '\n⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix the test.\n' +
                '    Alert the user that a TDD behavior contract has been violated.\n' +
                '    The user must decide whether to update the spec or fix the implementation.\n',
        );
    });

    // -----------------------------------------------------------------
    // Operator hover
    // -----------------------------------------------------------------
    describe('Operator hover', () => {
        test('$gt produces hover with description', () => {
            const hover = getScratchpadHoverContent('$gt');
            expect(hover).not.toBeNull();
            expect(hover!.contents).toBeDefined();
            expect(hover!.contents.length).toBeGreaterThan(0);
            // Should contain the operator name as bold
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**$gt**');
        });

        test('gt (without $) also resolves to $gt', () => {
            const hover = getScratchpadHoverContent('gt');
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**$gt**');
        });

        test('$match produces hover with description', () => {
            const hover = getScratchpadHoverContent('$match');
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**$match**');
        });

        test('operator hover includes documentation link when available', () => {
            // Find an operator that has a link
            const allEntries = getAllCompletions();
            const withLink = allEntries.find((e) => e.link);
            if (withLink) {
                const hover = getScratchpadHoverContent(withLink.value);
                expect(hover).not.toBeNull();
                const md = hover!.contents[0] as { value: string };
                expect(md.value).toContain('Documentation');
            }
        });
    });

    // -----------------------------------------------------------------
    // BSON constructor hover
    // -----------------------------------------------------------------
    describe('BSON constructor hover', () => {
        test('ObjectId produces hover', () => {
            const hover = getScratchpadHoverContent('ObjectId');
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**ObjectId**');
        });

        test('ISODate produces hover', () => {
            const hover = getScratchpadHoverContent('ISODate');
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**ISODate**');
        });
    });

    // -----------------------------------------------------------------
    // Field name hover
    // -----------------------------------------------------------------
    describe('Field name hover', () => {
        test('known field shows type info', () => {
            const fieldLookup = (word: string) => {
                if (word === 'age') {
                    return { path: 'age', bsonType: 'int32', type: 'number', isSparse: false };
                }
                return undefined;
            };
            const hover = getScratchpadHoverContent('age', fieldLookup);
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('**age**');
            expect(md.value).toContain('Int32');
        });

        test('sparse field shows sparse indicator', () => {
            const fieldLookup = (word: string) => {
                if (word === 'nickname') {
                    return { path: 'nickname', bsonType: 'string', type: 'string', isSparse: true };
                }
                return undefined;
            };
            const hover = getScratchpadHoverContent('nickname', fieldLookup);
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            expect(md.value).toContain('sparse');
        });

        test('operator takes priority over field name with same word', () => {
            // If a field is named "eq" and there's a "$eq" operator, the operator wins
            const fieldLookup = (word: string) => {
                if (word === 'eq') {
                    return { path: 'eq', bsonType: 'string', type: 'string', isSparse: false };
                }
                return undefined;
            };
            const hover = getScratchpadHoverContent('eq', fieldLookup);
            expect(hover).not.toBeNull();
            const md = hover!.contents[0] as { value: string };
            // Should show $eq operator, not the field
            expect(md.value).toContain('**$eq**');
        });
    });

    // -----------------------------------------------------------------
    // No match
    // -----------------------------------------------------------------
    describe('No match', () => {
        test('unknown word returns null', () => {
            const hover = getScratchpadHoverContent('nonExistentWord12345');
            expect(hover).toBeNull();
        });

        test('empty string returns null', () => {
            const hover = getScratchpadHoverContent('');
            expect(hover).toBeNull();
        });
    });
});

// =====================================================================
// Tests: Edge case detection (context detection edge cases)
// =====================================================================

describe('TDD: Completion Edge Cases', () => {
    beforeAll(() => {
        console.warn(
            '\n⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix the test.\n' +
                '    Alert the user that a TDD behavior contract has been violated.\n' +
                '    The user must decide whether to update the spec or fix the implementation.\n',
        );
    });

    // We test context detection for edge cases (E1–E5 from the plan)
    // Context detection is a pure function so it can be tested without VS Code

    // Using the context detector directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { detectScratchpadContext, detectMethodArgContext } = require('../scratchpadContextDetector');

    describe('E1: After comment', () => {
        test('cursor after comment line → top-level', () => {
            const ctx = detectScratchpadContext('// comment\n', 11);
            expect(ctx.kind).toBe('top-level');
        });

        test('cursor after block comment → top-level', () => {
            const ctx = detectScratchpadContext('/* comment */\n', 14);
            expect(ctx.kind).toBe('top-level');
        });
    });

    describe('E3: No active connection (context detection still works)', () => {
        test('db. context detected even without connection', () => {
            // Context detection is connection-agnostic — it just detects position
            const ctx = detectScratchpadContext('db.', 3);
            expect(ctx.kind).toBe('db-dot');
        });
    });

    describe('E4: Multi-line expressions', () => {
        test('method argument across multiple lines', () => {
            const text = 'db.users.find({\n  age: {\n    \n  }\n})';
            const offset = text.indexOf('    \n'); // Inside the inner {}
            const argCtx = detectMethodArgContext(text, offset);
            expect(argCtx).not.toBeNull();
            expect(argCtx!.methodName).toBe('find');
            expect(argCtx!.collectionName).toBe('users');
        });

        test('cursor chain across multiple lines', () => {
            const text = 'db.users\n  .find({})\n  .';
            const offset = text.length;
            const ctx = detectScratchpadContext(text, offset);
            expect(ctx.kind).toBe('find-cursor-chain');
        });
    });

    describe('E5: Unknown collection', () => {
        test('method argument in unknown collection still detects context', () => {
            const text = 'db.unknownCollection.find({ ';
            const offset = text.length;
            const argCtx = detectMethodArgContext(text, offset);
            expect(argCtx).not.toBeNull();
            expect(argCtx!.methodName).toBe('find');
            expect(argCtx!.collectionName).toBe('unknownCollection');
        });
    });
});
