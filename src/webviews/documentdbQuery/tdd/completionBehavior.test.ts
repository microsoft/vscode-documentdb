/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — Completion Categories by Cursor Position
 *
 * These tests define the expected behavior CONTRACT for the autocompletion
 * system. They were written BEFORE the implementation (TDD red→green cycle)
 * and verify WHAT completions appear at each cursor position, not HOW they
 * are produced internally.
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 *
 * Tests are category-based (not specific-operator-based) to be resilient to
 * changes in documentdb-constants. Categories come from the `description`
 * field in CompletionItemLabel (e.g., "comparison", "logical", "bson").
 *
 * See: readme.completionBehavior.md for the full specification.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { clearAllCompletionContexts, setCompletionContext } from '../completionStore';
import { type CursorContext } from '../cursorContext';
import { createCompletionItems } from '../documentdbQueryCompletionProvider';
import { EditorType } from '../languageConfig';

// ---------- Test infrastructure ----------

const mockCompletionItemKind: typeof monacoEditor.languages.CompletionItemKind = {
    Method: 0,
    Function: 1,
    Constructor: 2,
    Field: 3,
    Variable: 4,
    Class: 5,
    Struct: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Event: 10,
    Operator: 11,
    Unit: 12,
    Value: 13,
    Constant: 14,
    Enum: 15,
    EnumMember: 16,
    Keyword: 17,
    Text: 18,
    Color: 19,
    File: 20,
    Reference: 21,
    Customcolor: 22,
    Folder: 23,
    TypeParameter: 24,
    User: 25,
    Issue: 26,
    Snippet: 27,
};

const mockInsertTextRule = {
    InsertAsSnippet: 4,
    KeepWhitespace: 1,
    None: 0,
} as typeof monacoEditor.languages.CompletionItemInsertTextRule;

function createMockMonaco(): typeof monacoEditor {
    return {
        languages: {
            CompletionItemKind: mockCompletionItemKind,
            CompletionItemInsertTextRule: mockInsertTextRule,
        },
    } as unknown as typeof monacoEditor;
}

const testRange: monacoEditor.IRange = {
    startLineNumber: 1,
    endLineNumber: 1,
    startColumn: 1,
    endColumn: 1,
};

// ---------- Helpers ----------

/** Extracts the description (category) from a CompletionItem label. */
function getDescription(label: string | monacoEditor.languages.CompletionItemLabel): string | undefined {
    return typeof label === 'string' ? undefined : label.description;
}

/** Returns the set of distinct categories present in a completion list. */
function getCategories(items: monacoEditor.languages.CompletionItem[]): Set<string> {
    const categories = new Set<string>();
    for (const item of items) {
        const desc = getDescription(item.label);
        if (desc) categories.add(desc);
    }
    return categories;
}

/** Returns the label text from a CompletionItem. */
function getLabelText(label: string | monacoEditor.languages.CompletionItemLabel): string {
    return typeof label === 'string' ? label : label.label;
}

/**
 * Returns all distinct sortText prefixes (the part before the underscore)
 * found in a completion list.
 */
function getSortPrefixes(items: monacoEditor.languages.CompletionItem[]): Set<string> {
    const prefixes = new Set<string>();
    for (const item of items) {
        if (item.sortText) {
            const underscoreIdx = item.sortText.indexOf('_');
            if (underscoreIdx > 0) {
                prefixes.add(item.sortText.substring(0, underscoreIdx + 1));
            }
        }
    }
    return prefixes;
}

// ---------- Field data for tests ----------

const testFields = [
    {
        fieldName: 'name',
        displayType: 'String',
        bsonType: 'string',
        isSparse: false,
        insertText: 'name',
        referenceText: '$name',
    },
    {
        fieldName: 'age',
        displayType: 'Number',
        bsonType: 'int32',
        isSparse: false,
        insertText: 'age',
        referenceText: '$age',
    },
];

// ---------- Key-position operator categories ----------
// These are the categories that should appear at KEY / EMPTY positions.
// We test by category name, not specific operators, for resilience.
// (Used in assertions, not as a lookup — individual tests check specific categories.)

// Field-level categories that should NOT appear at key/empty positions.
// These categories have NO operators in KEY_POSITION_OPERATORS.
// Note: 'logical' and 'evaluation' are shared — they have both key-position
// operators ($and/$or for logical, $expr/$text for evaluation) and field-level
// operators ($not for logical, $regex/$mod for evaluation).
const FIELD_LEVEL_ONLY_CATEGORIES = ['comparison', 'array', 'element', 'bitwise', 'geospatial'];

// =====================================================================
// Tests
// =====================================================================

describe('Completion Behavior (TDD)', () => {
    const mockMonaco = createMockMonaco();

    afterEach(() => {
        clearAllCompletionContexts();
    });

    // -----------------------------------------------------------------
    // EMPTY position — no braces in editor
    // -----------------------------------------------------------------
    describe('EMPTY position (no braces, needsWrapping=true)', () => {
        /**
         * ┌──────────────────────────┐
         * │ |                        │  ← cursor, no braces
         * └──────────────────────────┘
         *
         * Expected: fields + key operators, all wrapped with { }
         * NOT expected: comparison, array, evaluation, element, bson, JS global
         */

        function getEmptyCompletions(sessionId?: string): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'unknown' },
                needsWrapping: true,
            });
        }

        test('includes field names when store has data', () => {
            setCompletionContext('s1', { fields: testFields });
            const items = getEmptyCompletions('s1');
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('name');
            expect(labels).toContain('age');
        });

        test('field insertText is wrapped with { }', () => {
            setCompletionContext('s1', { fields: testFields });
            const items = getEmptyCompletions('s1');
            const nameItem = items.find((i) => getLabelText(i.label) === 'name');
            expect(nameItem?.insertText).toMatch(/^\{.*\}$/);
        });

        test('includes key-position operator categories (logical)', () => {
            const items = getEmptyCompletions();
            const categories = getCategories(items);
            expect(categories.has('logical')).toBe(true);
        });

        test('does NOT include field-level categories', () => {
            const items = getEmptyCompletions();
            const categories = getCategories(items);
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(false);
            }
        });

        test('does NOT include "bson"', () => {
            const items = getEmptyCompletions();
            const categories = getCategories(items);
            expect(categories.has('bson')).toBe(false);
        });

        test('does NOT include "JS global"', () => {
            const items = getEmptyCompletions();
            const categories = getCategories(items);
            expect(categories.has('JS global')).toBe(false);
        });

        test('fields sort before operators (0_ < 1_)', () => {
            setCompletionContext('s1', { fields: testFields });
            const items = getEmptyCompletions('s1');
            const fieldItem = items.find((i) => getLabelText(i.label) === 'name');
            const operatorItems = items.filter((i) => getDescription(i.label) === 'logical');
            expect(fieldItem?.sortText).toMatch(/^0_/);
            expect(operatorItems.length).toBeGreaterThan(0);
            expect(operatorItems[0]?.sortText).toMatch(/^1_/);
        });
    });

    // -----------------------------------------------------------------
    // KEY position — inside { }
    // -----------------------------------------------------------------
    describe('KEY position ({ | })', () => {
        /**
         * ┌──────────────────────────┐
         * │ { |  }                   │  ← cursor inside braces
         * └──────────────────────────┘
         *
         * Expected: fields + key operators
         * NOT expected: comparison, array, evaluation, element, bson, JS global
         */

        const keyContext: CursorContext = { position: 'key', depth: 1 };

        function getKeyCompletions(sessionId?: string): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: keyContext,
            });
        }

        test('includes key-position operator categories', () => {
            const categories = getCategories(getKeyCompletions());
            expect(categories.has('logical')).toBe(true);
        });

        test('does NOT include field-level categories', () => {
            const categories = getCategories(getKeyCompletions());
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(false);
            }
        });

        test('does NOT include "bson" or "JS global"', () => {
            const categories = getCategories(getKeyCompletions());
            expect(categories.has('bson')).toBe(false);
            expect(categories.has('JS global')).toBe(false);
        });

        test('field sortText starts with 0_, operator sortText starts with 1_', () => {
            setCompletionContext('s1', { fields: testFields });
            const items = getKeyCompletions('s1');

            // Every field item should have sortText starting with 0_
            const fieldItems = items.filter((i) => getLabelText(i.label) === 'name' || getLabelText(i.label) === 'age');
            for (const item of fieldItems) {
                expect(item.sortText).toMatch(/^0_/);
            }

            // Every operator item should have sortText starting with 1_
            const operatorItems = items.filter((i) => {
                const desc = getDescription(i.label);
                return desc === 'logical' || desc === 'evaluation' || desc === 'misc';
            });
            for (const item of operatorItems) {
                expect(item.sortText).toMatch(/^1_/);
            }
        });
    });

    // -----------------------------------------------------------------
    // VALUE position — { field: | }
    // -----------------------------------------------------------------
    describe('VALUE position ({ field: | })', () => {
        /**
         * ┌──────────────────────────┐
         * │ { age: |  }              │  ← cursor at value position
         * └──────────────────────────┘
         *
         * Expected: type suggestions + field-level operators + bson + JS globals
         * NOT expected: key-position operators ($and, $or at root)
         */

        const valueContext: CursorContext = { position: 'value', fieldName: 'age' };

        function getValueCompletions(): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: valueContext,
            });
        }

        test('includes field-level categories', () => {
            const categories = getCategories(getValueCompletions());
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(true);
            }
        });

        test('includes "bson" and "JS global"', () => {
            const categories = getCategories(getValueCompletions());
            expect(categories.has('bson')).toBe(true);
            expect(categories.has('JS global')).toBe(true);
        });

        test('does NOT include key-position operators by label', () => {
            const labels = getValueCompletions().map((i) => getLabelText(i.label));
            // Check just a couple representative key operators
            expect(labels).not.toContain('$and');
            expect(labels).not.toContain('$or');
        });

        test('sort order: operators (0_) before bson (3_) before JS globals (4_)', () => {
            const prefixes = getSortPrefixes(getValueCompletions());
            expect(prefixes.has('0_')).toBe(true);
            expect(prefixes.has('3_')).toBe(true);
            expect(prefixes.has('4_')).toBe(true);
        });

        test('project editor shows only 1/0 at value position', () => {
            const items = createCompletionItems({
                editorType: EditorType.Project,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: valueContext,
            });
            expect(items).toHaveLength(2);
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('1');
            expect(labels).toContain('0');
        });

        test('sort editor shows only 1/-1 at value position', () => {
            const items = createCompletionItems({
                editorType: EditorType.Sort,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: valueContext,
            });
            expect(items).toHaveLength(2);
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('1');
            expect(labels).toContain('-1');
        });
    });

    // -----------------------------------------------------------------
    // OPERATOR position — { field: { | } }
    // -----------------------------------------------------------------
    describe('OPERATOR position ({ field: { | } })', () => {
        /**
         * ┌──────────────────────────┐
         * │ { age: { |  } }          │  ← cursor inside operator object
         * └──────────────────────────┘
         *
         * Expected: field-level operators (braces stripped)
         * NOT expected: bson, JS global, key-position operators
         */

        const operatorContext: CursorContext = { position: 'operator', fieldName: 'age' };

        function getOperatorCompletions(): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: operatorContext,
            });
        }

        test('includes field-level categories', () => {
            const categories = getCategories(getOperatorCompletions());
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(true);
            }
        });

        test('does NOT include "bson" or "JS global"', () => {
            const categories = getCategories(getOperatorCompletions());
            expect(categories.has('bson')).toBe(false);
            expect(categories.has('JS global')).toBe(false);
        });

        test('does NOT include key-position operators', () => {
            const labels = getOperatorCompletions().map((i) => getLabelText(i.label));
            expect(labels).not.toContain('$and');
            expect(labels).not.toContain('$or');
        });
    });

    // -----------------------------------------------------------------
    // ARRAY-ELEMENT position — { $and: [|] }
    // -----------------------------------------------------------------
    describe('ARRAY-ELEMENT position ({ $and: [|] })', () => {
        /**
         * Same behavior as KEY position
         */

        const arrayContext: CursorContext = { position: 'array-element', parentOperator: '$and' };

        function getArrayElementCompletions(sessionId?: string): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: arrayContext,
            });
        }

        test('behaves like KEY: includes logical, excludes field-level categories', () => {
            const categories = getCategories(getArrayElementCompletions());
            expect(categories.has('logical')).toBe(true);
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(false);
            }
        });

        test('includes fields when store has data', () => {
            setCompletionContext('s1', { fields: testFields });
            const labels = getArrayElementCompletions('s1').map((i) => getLabelText(i.label));
            expect(labels).toContain('name');
        });
    });

    // -----------------------------------------------------------------
    // UNKNOWN position — genuinely ambiguous (show everything)
    // -----------------------------------------------------------------
    describe('UNKNOWN position (ambiguous, needsWrapping=false)', () => {
        /**
         * Genuinely unknown cursor position. Show everything as discovery.
         * This is the fallback when the parser can't determine position AND
         * the editor is not empty (has some content with braces but ambiguous).
         */

        function getUnknownCompletions(sessionId?: string): monacoEditor.languages.CompletionItem[] {
            return createCompletionItems({
                editorType: EditorType.Filter,
                sessionId,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'unknown' },
                needsWrapping: false,
            });
        }

        test('includes key-position categories', () => {
            const categories = getCategories(getUnknownCompletions());
            expect(categories.has('logical')).toBe(true);
        });

        test('includes field-level categories (full discovery)', () => {
            const categories = getCategories(getUnknownCompletions());
            for (const cat of FIELD_LEVEL_ONLY_CATEGORIES) {
                expect(categories.has(cat)).toBe(true);
            }
        });

        test('includes "bson" and "JS global"', () => {
            const categories = getCategories(getUnknownCompletions());
            expect(categories.has('bson')).toBe(true);
            expect(categories.has('JS global')).toBe(true);
        });

        test('includes fields when store has data', () => {
            setCompletionContext('s1', { fields: testFields });
            const labels = getUnknownCompletions('s1').map((i) => getLabelText(i.label));
            expect(labels).toContain('name');
        });
    });
});
