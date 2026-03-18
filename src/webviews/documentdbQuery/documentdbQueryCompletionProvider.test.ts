/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FILTER_COMPLETION_META,
    getFilteredCompletions,
    PROJECTION_COMPLETION_META,
    type OperatorEntry,
} from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { clearAllCompletionContexts, setCompletionContext } from './completionStore';
import { type CursorContext } from './cursorContext';
import {
    createCompletionItems,
    createTypeSuggestions,
    escapeSnippetDollars,
    getCategoryLabel,
    getCompletionKindForMeta,
    getMetaTagsForEditorType,
    getOperatorSortPrefix,
    mapFieldToCompletionItem,
    mapOperatorToCompletionItem,
    stripOuterBraces,
} from './documentdbQueryCompletionProvider';
import { EditorType } from './languageConfig';

/**
 * Minimal mock of `monaco.languages.CompletionItemKind` for testing.
 * Uses distinct numeric values matching Monaco's enum.
 */
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

/** Minimal mock of `monaco.languages.CompletionItemInsertTextRule`. */
const mockInsertTextRule = {
    InsertAsSnippet: 4, // Same value as Monaco
    KeepWhitespace: 1,
    None: 0,
} as typeof monacoEditor.languages.CompletionItemInsertTextRule;

/**
 * Creates a minimal Monaco API mock for testing completion provider functions.
 */
function createMockMonaco(): typeof monacoEditor {
    return {
        languages: {
            CompletionItemKind: mockCompletionItemKind,
            CompletionItemInsertTextRule: mockInsertTextRule,
        },
    } as unknown as typeof monacoEditor;
}

/**
 * Extracts the label string from a CompletionItem's label,
 * which may be a plain string or a CompletionItemLabel object.
 */
function getLabelText(label: string | monacoEditor.languages.CompletionItemLabel): string {
    return typeof label === 'string' ? label : label.label;
}

/** Standard test range for all completion items. */
const testRange: monacoEditor.IRange = {
    startLineNumber: 1,
    endLineNumber: 1,
    startColumn: 1,
    endColumn: 1,
};

describe('documentdbQueryCompletionProvider', () => {
    describe('getCompletionKindForMeta', () => {
        const kinds = mockCompletionItemKind;

        test('maps query operators to Operator kind', () => {
            expect(getCompletionKindForMeta('query', kinds)).toBe(kinds.Operator);
            expect(getCompletionKindForMeta('query:comparison', kinds)).toBe(kinds.Operator);
            expect(getCompletionKindForMeta('query:logical', kinds)).toBe(kinds.Operator);
        });

        test('maps expression operators to Function kind', () => {
            expect(getCompletionKindForMeta('expr:arith', kinds)).toBe(kinds.Function);
            expect(getCompletionKindForMeta('expr:string', kinds)).toBe(kinds.Function);
        });

        test('maps BSON constructors to Constructor kind', () => {
            expect(getCompletionKindForMeta('bson', kinds)).toBe(kinds.Constructor);
        });

        test('maps stages to Module kind', () => {
            expect(getCompletionKindForMeta('stage', kinds)).toBe(kinds.Module);
        });

        test('maps accumulators to Method kind', () => {
            expect(getCompletionKindForMeta('accumulator', kinds)).toBe(kinds.Method);
        });

        test('maps update operators to Property kind', () => {
            expect(getCompletionKindForMeta('update', kinds)).toBe(kinds.Property);
        });

        test('maps variables to Variable kind', () => {
            expect(getCompletionKindForMeta('variable', kinds)).toBe(kinds.Variable);
        });

        test('maps window operators to Event kind', () => {
            expect(getCompletionKindForMeta('window', kinds)).toBe(kinds.Event);
        });

        test('maps field identifiers to Field kind', () => {
            expect(getCompletionKindForMeta('field:identifier', kinds)).toBe(kinds.Field);
        });

        test('maps unknown meta to Text kind', () => {
            expect(getCompletionKindForMeta('unknown', kinds)).toBe(kinds.Text);
        });
    });

    describe('mapOperatorToCompletionItem', () => {
        const mockMonaco = createMockMonaco();

        test('maps a simple operator entry without snippet', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Matches values equal to a specified value.',
            };

            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco);

            expect(getLabelText(item.label)).toBe('$eq');
            expect(item.kind).toBe(mockCompletionItemKind.Operator);
            expect(item.insertText).toBe('$eq');
            expect(item.insertTextRules).toBeUndefined();
            expect(item.documentation).toEqual({
                value: 'Matches values equal to a specified value.',
                isTrusted: true,
            });
            expect(item.range).toBe(testRange);
        });

        test('maps an operator entry with snippet', () => {
            const entry: OperatorEntry = {
                value: '$gt',
                meta: 'query:comparison',
                description: 'Greater than',
                snippet: '{ $gt: ${1:value} }',
            };

            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco);

            expect(getLabelText(item.label)).toBe('$gt');
            expect(item.insertText).toBe('{ \\$gt: ${1:value} }');
            expect(item.insertTextRules).toBe(mockInsertTextRule.InsertAsSnippet);
        });

        test('maps a BSON constructor with link', () => {
            const entry: OperatorEntry = {
                value: 'ObjectId',
                meta: 'bson',
                description: 'Creates a new ObjectId value.',
                snippet: 'ObjectId("${1:hex}")',
                link: 'https://docs.example.com/objectid',
            };

            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco);

            expect(getLabelText(item.label)).toBe('ObjectId');
            expect(item.kind).toBe(mockCompletionItemKind.Constructor);
            expect(item.insertText).toBe('ObjectId("${1:hex}")');
            expect(item.insertTextRules).toBe(mockInsertTextRule.InsertAsSnippet);
            expect(item.documentation).toEqual({
                value: 'Creates a new ObjectId value.\n\n[DocumentDB Docs](https://docs.example.com/objectid)',
                isTrusted: true,
            });
        });

        test('uses the provided range', () => {
            const customRange: monacoEditor.IRange = {
                startLineNumber: 3,
                endLineNumber: 3,
                startColumn: 5,
                endColumn: 10,
            };

            const entry: OperatorEntry = {
                value: '$in',
                meta: 'query:comparison',
                description: 'Matches any value in an array.',
            };

            const item = mapOperatorToCompletionItem(entry, customRange, mockMonaco);
            expect(item.range).toBe(customRange);
        });
    });

    describe('getMetaTagsForEditorType', () => {
        test('returns FILTER_COMPLETION_META for Filter editor type', () => {
            const tags = getMetaTagsForEditorType(EditorType.Filter);
            expect(tags).toBe(FILTER_COMPLETION_META);
        });

        test('returns PROJECTION_COMPLETION_META for Project editor type', () => {
            const tags = getMetaTagsForEditorType(EditorType.Project);
            expect(tags).toBe(PROJECTION_COMPLETION_META);
        });

        test('returns PROJECTION_COMPLETION_META for Sort editor type', () => {
            const tags = getMetaTagsForEditorType(EditorType.Sort);
            expect(tags).toBe(PROJECTION_COMPLETION_META);
        });

        test('returns FILTER_COMPLETION_META for undefined (fallback)', () => {
            const tags = getMetaTagsForEditorType(undefined);
            expect(tags).toBe(FILTER_COMPLETION_META);
        });
    });

    describe('createCompletionItems', () => {
        const mockMonaco = createMockMonaco();

        afterEach(() => {
            clearAllCompletionContexts();
        });

        test('returns items for filter context using documentdb-constants', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            // Should return the filter completions from documentdb-constants
            expect(items.length).toBeGreaterThan(0);

            // All items should have required CompletionItem properties
            for (const item of items) {
                expect(item.label).toBeDefined();
                expect(getLabelText(item.label)).toBeDefined();
                expect(item.kind).toBeDefined();
                expect(item.insertText).toBeDefined();
                expect(item.range).toBe(testRange);
            }
        });

        test('filter completions include query operators like $eq, $gt, $match at value position', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'value', fieldName: 'x' },
            });

            const labels = items.map((item) => getLabelText(item.label));
            expect(labels).toContain('$eq');
            expect(labels).toContain('$gt');
            expect(labels).toContain('$in');
        });

        test('filter completions include BSON constructors like ObjectId at value position', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'value', fieldName: 'x' },
            });

            const labels = items.map((item) => getLabelText(item.label));
            expect(labels).toContain('ObjectId');
            expect(labels).toContain('UUID');
            expect(labels).toContain('ISODate');
        });

        test('filter completions do NOT include JS globals like console, Math, function', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            const labels = items.map((item) => getLabelText(item.label));
            expect(labels).not.toContain('console');
            expect(labels).not.toContain('Math');
            expect(labels).not.toContain('function');
            expect(labels).not.toContain('window');
            expect(labels).not.toContain('document');
            expect(labels).not.toContain('Array');
            expect(labels).not.toContain('Object');
            expect(labels).not.toContain('String');
        });

        test('filter completions do NOT include aggregation stages', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            const labels = items.map((item) => getLabelText(item.label));
            // $match is a query operator AND a stage, but $group/$unwind are stage-only
            expect(labels).not.toContain('$group');
            expect(labels).not.toContain('$unwind');
            expect(labels).not.toContain('$lookup');
        });

        test('filter completions at value position match getFilteredCompletions count for FILTER_COMPLETION_META', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'value', fieldName: 'x' },
            });

            const expected = getFilteredCompletions({ meta: [...FILTER_COMPLETION_META] });
            // Value position includes operators + BSON constructors (minus key-position operators)
            expect(items.length).toBeGreaterThan(0);
            expect(items.length).toBeLessThanOrEqual(expected.length);
        });

        test('default (undefined editor type) matches filter completions', () => {
            const filterItems = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            const defaultItems = createCompletionItems({
                editorType: undefined,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            expect(defaultItems).toHaveLength(filterItems.length);
        });
    });

    describe('mapFieldToCompletionItem', () => {
        const mockMonaco = createMockMonaco();

        test('maps a simple field to a CompletionItem', () => {
            const field = {
                fieldName: 'age',
                displayType: 'Number',
                bsonType: 'int32',
                isSparse: false,
                insertText: 'age',
                referenceText: '$age',
            };

            const item = mapFieldToCompletionItem(field, testRange, mockMonaco);

            expect(item.label).toEqual({ label: 'age', description: 'Number' });
            expect(item.kind).toBe(mockCompletionItemKind.Field);
            expect(item.insertText).toBe('age: $1');
            expect(item.insertTextRules).toBe(mockInsertTextRule.InsertAsSnippet);
            expect(item.sortText).toBe('0_age');
            expect(item.range).toBe(testRange);
        });

        test('includes (sparse) indicator for sparse fields', () => {
            const field = {
                fieldName: 'optionalField',
                displayType: 'String',
                bsonType: 'string',
                isSparse: true,
                insertText: 'optionalField',
                referenceText: '$optionalField',
            };

            const item = mapFieldToCompletionItem(field, testRange, mockMonaco);

            expect((item.label as { description: string }).description).toBe('String (sparse)');
        });

        test('uses pre-escaped insertText for special field names', () => {
            const field = {
                fieldName: 'address.city',
                displayType: 'String',
                bsonType: 'string',
                isSparse: false,
                insertText: '"address.city"',
                referenceText: '$address.city',
            };

            const item = mapFieldToCompletionItem(field, testRange, mockMonaco);

            expect((item.label as { label: string }).label).toBe('address.city');
            expect(item.insertText).toBe('"address.city": $1');
        });
    });

    describe('field completions via store', () => {
        const mockMonaco = createMockMonaco();

        afterEach(() => {
            clearAllCompletionContexts();
        });

        test('field completions appear when store has data', () => {
            setCompletionContext('test-session', {
                fields: [
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
                ],
            });

            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: 'test-session',
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('name');
            expect(labels).toContain('age');
        });

        test('field completions have sortText prefix so they sort first', () => {
            setCompletionContext('test-session', {
                fields: [
                    {
                        fieldName: 'name',
                        displayType: 'String',
                        bsonType: 'string',
                        isSparse: false,
                        insertText: 'name',
                        referenceText: '$name',
                    },
                ],
            });

            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: 'test-session',
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            const fieldItem = items.find((i) => getLabelText(i.label) === 'name');
            expect(fieldItem?.sortText).toBe('0_name');
        });

        test('empty store returns all operator completions', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: 'nonexistent-session',
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            // Without cursorContext, falls back to all completions
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('$and');
            expect(labels).toContain('$or');
            expect(labels).toContain('$gt');
        });

        test('undefined sessionId returns all operator completions', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
            });

            // Without cursorContext, falls back to all completions
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('$and');
            expect(labels).toContain('$or');
            expect(labels).toContain('$gt');
        });
    });

    describe('getOperatorSortPrefix', () => {
        test('returns undefined when no fieldBsonTypes provided', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Equals',
            };
            expect(getOperatorSortPrefix(entry, undefined)).toBeUndefined();
            expect(getOperatorSortPrefix(entry, [])).toBeUndefined();
        });

        test('returns "1a_" for universal comparison operator (no applicableBsonTypes)', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Equals',
            };
            expect(getOperatorSortPrefix(entry, ['string'])).toBe('1a_');
        });

        test('returns "1b_" for universal non-comparison operator', () => {
            const entry: OperatorEntry = {
                value: '$exists',
                meta: 'query:element',
                description: 'Exists',
            };
            expect(getOperatorSortPrefix(entry, ['string'])).toBe('1b_');
        });

        test('returns "0_" for type-relevant operator (applicableBsonTypes matches)', () => {
            const entry: OperatorEntry = {
                value: '$regex',
                meta: 'query:evaluation',
                description: 'Regex match',
                applicableBsonTypes: ['string'],
            };
            expect(getOperatorSortPrefix(entry, ['string'])).toBe('0_');
        });

        test('returns "2_" for non-matching operator (applicableBsonTypes does not match)', () => {
            const entry: OperatorEntry = {
                value: '$regex',
                meta: 'query:evaluation',
                description: 'Regex match',
                applicableBsonTypes: ['string'],
            };
            expect(getOperatorSortPrefix(entry, ['int32'])).toBe('2_');
        });

        test('handles polymorphic fields (multiple bsonTypes)', () => {
            const regexEntry: OperatorEntry = {
                value: '$regex',
                meta: 'query:evaluation',
                description: 'Regex match',
                applicableBsonTypes: ['string'],
            };
            // Field is sometimes string, sometimes int32 — $regex should match
            expect(getOperatorSortPrefix(regexEntry, ['int32', 'string'])).toBe('0_');
        });

        test('returns "2_" when operator types and field types have no intersection', () => {
            const sizeEntry: OperatorEntry = {
                value: '$size',
                meta: 'query:array',
                description: 'Array size',
                applicableBsonTypes: ['array'],
            };
            expect(getOperatorSortPrefix(sizeEntry, ['string', 'int32'])).toBe('2_');
        });
    });

    describe('type-aware operator sorting in mapOperatorToCompletionItem', () => {
        const mockMonaco = createMockMonaco();

        test('sortText is undefined when no fieldBsonTypes provided', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Equals',
            };
            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco);
            expect(item.sortText).toBeUndefined();
        });

        test('sortText is undefined when empty fieldBsonTypes provided', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Equals',
            };
            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco, []);
            expect(item.sortText).toBeUndefined();
        });

        test('universal comparison operator gets "1a_" prefix when fieldBsonTypes provided', () => {
            const entry: OperatorEntry = {
                value: '$eq',
                meta: 'query:comparison',
                description: 'Equals',
            };
            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco, ['int32']);
            expect(item.sortText).toBe('1a_$eq');
        });

        test('type-relevant operator gets "0_" prefix', () => {
            const entry: OperatorEntry = {
                value: '$regex',
                meta: 'query:evaluation',
                description: 'Regex match',
                applicableBsonTypes: ['string'],
            };
            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco, ['string']);
            expect(item.sortText).toBe('0_$regex');
        });

        test('non-matching operator gets "2_" prefix (demoted, not hidden)', () => {
            const entry: OperatorEntry = {
                value: '$regex',
                meta: 'query:evaluation',
                description: 'Regex match',
                applicableBsonTypes: ['string'],
            };
            const item = mapOperatorToCompletionItem(entry, testRange, mockMonaco, ['int32']);
            expect(item.sortText).toBe('2_$regex');
        });
    });

    describe('type-aware sorting via createCompletionItems', () => {
        const mockMonaco = createMockMonaco();

        afterEach(() => {
            clearAllCompletionContexts();
        });

        test('without fieldBsonTypes, operators have no sortText at value position', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'value', fieldName: 'x' },
            });

            const regexItem = items.find((i) => getLabelText(i.label) === '$regex');
            // At value position, operators get sort prefix 0_ (not type-aware)
            expect(regexItem?.sortText).toBe('0_$regex');

            const eqItem = items.find((i) => getLabelText(i.label) === '$eq');
            expect(eqItem?.sortText).toBe('0_$eq');
        });

        test('with fieldBsonTypes=["string"] at operator position, $regex gets "0_" and $size gets "2_"', () => {
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                fieldBsonTypes: ['string'],
                cursorContext: { position: 'operator', fieldName: 'x' },
            });

            const regexItem = items.find((i) => getLabelText(i.label) === '$regex');
            expect(regexItem?.sortText).toBe('0_$regex');

            const sizeItem = items.find((i) => getLabelText(i.label) === '$size');
            expect(sizeItem?.sortText).toBe('2_$size');

            // Comparison operators like $eq get "1a_" (promoted over other universals)
            const eqItem = items.find((i) => getLabelText(i.label) === '$eq');
            expect(eqItem?.sortText).toBe('1a_$eq');
        });

        test('with fieldBsonTypes=["int32"] at operator position, $regex gets "2_" (demoted, still present)', () => {
            const context: CursorContext = { position: 'operator', fieldName: 'x' };
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                fieldBsonTypes: ['int32'],
                cursorContext: context,
            });

            const labels = items.map((i) => getLabelText(i.label));
            // $regex is still in the list, just demoted
            expect(labels).toContain('$regex');

            const regexItem = items.find((i) => getLabelText(i.label) === '$regex');
            expect(regexItem?.sortText).toBe('2_$regex');

            // Bitwise operators should match int
            const bitsAllSetItem = items.find((i) => getLabelText(i.label) === '$bitsAllSet');
            expect(bitsAllSetItem?.sortText).toBe('0_$bitsAllSet');
        });

        test('all operators still present regardless of fieldBsonTypes at operator position', () => {
            const itemsWithoutType = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: { position: 'operator', fieldName: 'x' },
            });

            const itemsWithType = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                fieldBsonTypes: ['int32'],
                cursorContext: { position: 'operator', fieldName: 'x' },
            });

            // Same number of items — nothing filtered out
            expect(itemsWithType).toHaveLength(itemsWithoutType.length);
        });

        test('field items still get "0_" prefix even when fieldBsonTypes is set', () => {
            setCompletionContext('test-session', {
                fields: [
                    {
                        fieldName: 'age',
                        displayType: 'Number',
                        bsonType: 'int32',
                        isSparse: false,
                        insertText: 'age',
                        referenceText: '$age',
                    },
                ],
            });

            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: 'test-session',
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                fieldBsonTypes: ['int32'],
                cursorContext: { position: 'key', depth: 1 },
            });

            const fieldItem = items.find((i) => getLabelText(i.label) === 'age');
            expect(fieldItem?.sortText).toBe('0_age');
        });
    });

    describe('stripOuterBraces', () => {
        test('strips outer { } from operator snippets', () => {
            expect(stripOuterBraces('{ $gt: ${1:value} }')).toBe('$gt: ${1:value}');
        });

        test('preserves inner brackets', () => {
            expect(stripOuterBraces('{ $in: [${1:value}] }')).toBe('$in: [${1:value}]');
        });

        test('preserves inner braces', () => {
            expect(stripOuterBraces('{ $elemMatch: { ${1:query} } }')).toBe('$elemMatch: { ${1:query} }');
        });

        test('returns unchanged if not wrapped', () => {
            expect(stripOuterBraces('ObjectId("${1:hex}")')).toBe('ObjectId("${1:hex}")');
        });

        test('returns unchanged for non-matching patterns', () => {
            expect(stripOuterBraces('$gt')).toBe('$gt');
        });
    });

    describe('getCategoryLabel', () => {
        test('extracts sub-category from qualified meta tag', () => {
            expect(getCategoryLabel('query:comparison')).toBe('comparison');
            expect(getCategoryLabel('query:logical')).toBe('logical');
            expect(getCategoryLabel('query:element')).toBe('element');
            expect(getCategoryLabel('query:array')).toBe('array');
        });

        test('returns whole tag when no colon', () => {
            expect(getCategoryLabel('bson')).toBe('bson');
            expect(getCategoryLabel('variable')).toBe('variable');
        });
    });

    describe('escapeSnippetDollars', () => {
        test('escapes $ before operator names in snippets', () => {
            expect(escapeSnippetDollars('{ $gt: ${1:value} }')).toBe('{ \\$gt: ${1:value} }');
        });

        test('preserves tab stop syntax', () => {
            expect(escapeSnippetDollars('${1:value}')).toBe('${1:value}');
            expect(escapeSnippetDollars('$1')).toBe('$1');
        });

        test('escapes multiple operator names', () => {
            expect(escapeSnippetDollars('{ $and: [{ $gt: ${1:value} }] }')).toBe('{ \\$and: [{ \\$gt: ${1:value} }] }');
        });

        test('does not escape BSON constructor snippets', () => {
            expect(escapeSnippetDollars('ObjectId("${1:hex}")')).toBe('ObjectId("${1:hex}")');
        });

        test('escapes stripped operator snippets', () => {
            expect(escapeSnippetDollars('$gt: ${1:value}')).toBe('\\$gt: ${1:value}');
            expect(escapeSnippetDollars('$in: [${1:value}]')).toBe('\\$in: [${1:value}]');
        });
    });

    // ---------------------------------------------------------------
    // Context-sensitive completions (Step 4.5)
    // ---------------------------------------------------------------
    describe('context-sensitive completions', () => {
        const mockMonaco = createMockMonaco();

        afterEach(() => {
            clearAllCompletionContexts();
        });

        describe('key position', () => {
            const keyContext: CursorContext = { position: 'key', depth: 1 };

            test('shows field names when store has data', () => {
                setCompletionContext('test-session', {
                    fields: [
                        {
                            fieldName: 'name',
                            displayType: 'String',
                            bsonType: 'string',
                            isSparse: false,
                            insertText: 'name',
                            referenceText: '$name',
                        },
                    ],
                });

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: 'test-session',
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: keyContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('name');
            });

            test('shows key-position operators ($and, $or, $nor)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: keyContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('$and');
                expect(labels).toContain('$or');
                expect(labels).toContain('$nor');
                expect(labels).toContain('$comment');
                expect(labels).toContain('$expr');
                // $not is a field-level operator, NOT a key-position operator
                expect(labels).not.toContain('$not');
            });

            test('does NOT show value-level operators ($gt, $lt, $regex, $eq)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: keyContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('$gt');
                expect(labels).not.toContain('$lt');
                expect(labels).not.toContain('$regex');
                expect(labels).not.toContain('$eq');
                expect(labels).not.toContain('$in');
                expect(labels).not.toContain('$exists');
            });

            test('does NOT show BSON constructors', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: keyContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('ObjectId');
                expect(labels).not.toContain('UUID');
                expect(labels).not.toContain('ISODate');
            });

            test('fields sort before operators', () => {
                setCompletionContext('test-session', {
                    fields: [
                        {
                            fieldName: 'age',
                            displayType: 'Number',
                            bsonType: 'int32',
                            isSparse: false,
                            insertText: 'age',
                            referenceText: '$age',
                        },
                    ],
                });

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: 'test-session',
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: keyContext,
                });

                const fieldItem = items.find((i) => getLabelText(i.label) === 'age');
                const andItem = items.find((i) => getLabelText(i.label) === '$and');
                expect(fieldItem?.sortText).toBe('0_age');
                expect(andItem?.sortText).toBe('1_$and');
            });
        });

        describe('value position', () => {
            const valueContext: CursorContext = { position: 'value', fieldName: 'age' };

            test('shows BSON constructors', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('ObjectId');
                expect(labels).toContain('UUID');
                expect(labels).toContain('ISODate');
            });

            test('shows query operators (with brace-wrapping snippets)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('$gt');
                expect(labels).toContain('$eq');
                expect(labels).toContain('$in');

                // Operators should have their full brace-wrapping snippets at value position
                const gtItem = items.find((i) => getLabelText(i.label) === '$gt');
                expect(gtItem?.insertText).toBe('{ \\$gt: ${1:value} }');
            });

            test('operators sort before BSON constructors', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const gtItem = items.find((i) => getLabelText(i.label) === '$gt');
                const objectIdItem = items.find((i) => getLabelText(i.label) === 'ObjectId');
                expect(gtItem?.sortText).toBe('0_$gt');
                expect(objectIdItem?.sortText).toBe('3_ObjectId');
            });

            test('includes JS globals and common methods after BSON constructors', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                // Class constructors
                expect(labels).toContain('Date');
                expect(labels).toContain('RegExp');
                // Static methods
                expect(labels).toContain('Date.now()');
                expect(labels).toContain('Math.floor()');
                expect(labels).toContain('Math.min()');
                expect(labels).toContain('Math.max()');
                // Primitives
                expect(labels).toContain('Infinity');

                // JS globals sort after BSON constructors (4_ > 3_)
                const dateItem = items.find((i) => getLabelText(i.label) === 'Date');
                expect(dateItem?.sortText).toBe('4_Date');
            });

            test('does NOT show key-position operators ($and, $or)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('$and');
                expect(labels).not.toContain('$or');
            });

            test('does NOT show field names', () => {
                setCompletionContext('test-session', {
                    fields: [
                        {
                            fieldName: 'name',
                            displayType: 'String',
                            bsonType: 'string',
                            isSparse: false,
                            insertText: 'name',
                            referenceText: '$name',
                        },
                    ],
                });

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: 'test-session',
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: valueContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('name');
            });
        });

        describe('operator position', () => {
            const operatorContext: CursorContext = { position: 'operator', fieldName: 'age' };

            test('shows comparison operators ($gt, $lt, $eq, $in) and $not', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: operatorContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('$gt');
                expect(labels).toContain('$lt');
                expect(labels).toContain('$eq');
                expect(labels).toContain('$in');
                expect(labels).toContain('$exists');
                expect(labels).toContain('$regex');
                // $not is a field-level operator, valid at operator position
                expect(labels).toContain('$not');
            });

            test('does NOT show key-position operators ($and, $or)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: operatorContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('$and');
                expect(labels).not.toContain('$or');
                expect(labels).not.toContain('$nor');
            });

            test('does NOT show BSON constructors', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: operatorContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('ObjectId');
                expect(labels).not.toContain('UUID');
            });

            test('does NOT show field names', () => {
                setCompletionContext('test-session', {
                    fields: [
                        {
                            fieldName: 'name',
                            displayType: 'String',
                            bsonType: 'string',
                            isSparse: false,
                            insertText: 'name',
                            referenceText: '$name',
                        },
                    ],
                });

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: 'test-session',
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: operatorContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).not.toContain('name');
            });

            test('applies type-aware sorting when fieldBsonType is available', () => {
                const typedContext: CursorContext = {
                    position: 'operator',
                    fieldName: 'age',
                    fieldBsonType: 'int32',
                };

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: typedContext,
                });

                // $regex has applicableBsonTypes=['string'], doesn't match 'int32' → demoted
                const regexItem = items.find((i) => getLabelText(i.label) === '$regex');
                expect(regexItem?.sortText).toBe('2_$regex');

                // $bitsAllSet has applicableBsonTypes containing 'int32' → promoted
                const bitsItem = items.find((i) => getLabelText(i.label) === '$bitsAllSet');
                expect(bitsItem?.sortText).toBe('0_$bitsAllSet');

                // $eq is universal comparison → promoted tier
                const eqItem = items.find((i) => getLabelText(i.label) === '$eq');
                expect(eqItem?.sortText).toBe('1a_$eq');
            });

            test('strips outer braces from operator snippets (Issue A fix)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: operatorContext,
                });

                // At operator position, snippets should NOT have outer { }
                const gtItem = items.find((i) => getLabelText(i.label) === '$gt');
                expect(gtItem?.insertText).toBe('\\$gt: ${1:value}');

                const inItem = items.find((i) => getLabelText(i.label) === '$in');
                expect(inItem?.insertText).toBe('\\$in: [${1:value}]');

                const regexItem = items.find((i) => getLabelText(i.label) === '$regex');
                expect(regexItem?.insertText).toBe('\\$regex: /${1:pattern}/');
            });
        });

        describe('array-element position', () => {
            const arrayContext: CursorContext = { position: 'array-element', parentOperator: '$and' };

            test('behaves like key position (shows fields + key operators)', () => {
                setCompletionContext('test-session', {
                    fields: [
                        {
                            fieldName: 'age',
                            displayType: 'Number',
                            bsonType: 'int32',
                            isSparse: false,
                            insertText: 'age',
                            referenceText: '$age',
                        },
                    ],
                });

                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: 'test-session',
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: arrayContext,
                });

                const labels = items.map((i) => getLabelText(i.label));
                // Should include fields
                expect(labels).toContain('age');
                // Should include key-position operators
                expect(labels).toContain('$and');
                expect(labels).toContain('$or');
                // Should NOT include value-level operators
                expect(labels).not.toContain('$gt');
                expect(labels).not.toContain('$regex');
                // Should NOT include BSON constructors
                expect(labels).not.toContain('ObjectId');
            });
        });

        describe('unknown position', () => {
            const unknownContext: CursorContext = { position: 'unknown' };

            test('falls back to all completions', () => {
                const itemsWithContext = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: unknownContext,
                });

                const itemsWithoutContext = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                });

                // Both should produce the same all-completions list
                expect(itemsWithContext).toHaveLength(itemsWithoutContext.length);
                const labels = itemsWithContext.map((i) => getLabelText(i.label));
                // All completions include key-position operators
                expect(labels).toContain('$and');
                expect(labels).toContain('$or');
                // Also include value-position operators and BSON constructors
                expect(labels).toContain('$gt');
                expect(labels).toContain('ObjectId');
            });
        });

        describe('no cursorContext (undefined)', () => {
            test('falls back to all completions (fields + operators + BSON + JS globals)', () => {
                const items = createCompletionItems({
                    editorType: EditorType.Filter,
                    sessionId: undefined,
                    range: testRange,
                    isDollarPrefix: false,
                    monaco: mockMonaco,
                    cursorContext: undefined,
                });

                // Without cursorContext, shows all completions
                const labels = items.map((i) => getLabelText(i.label));
                expect(labels).toContain('$and');
                expect(labels).toContain('$or');
                expect(labels).toContain('$gt');
                expect(labels).toContain('ObjectId');
            });
        });
    });

    // ---------------------------------------------------------------
    // Type-aware value suggestions
    // ---------------------------------------------------------------
    describe('createTypeSuggestions', () => {
        const mockMonaco = createMockMonaco();

        test('returns empty array for undefined bsonType', () => {
            const items = createTypeSuggestions(undefined, testRange, mockMonaco);
            expect(items).toHaveLength(0);
        });

        test('returns empty array for unknown bsonType', () => {
            const items = createTypeSuggestions('unknownType', testRange, mockMonaco);
            expect(items).toHaveLength(0);
        });

        test('returns true/false for boolean fields', () => {
            const items = createTypeSuggestions('boolean', testRange, mockMonaco);
            expect(items).toHaveLength(2);

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('true');
            expect(labels).toContain('false');

            // Plain text, not snippets
            const trueItem = items.find((i) => getLabelText(i.label) === 'true');
            expect(trueItem?.insertText).toBe('true');
            expect(trueItem?.insertTextRules).toBeUndefined();
            expect(trueItem?.kind).toBe(mockCompletionItemKind.Value);
        });

        test('returns range query for int fields', () => {
            const items = createTypeSuggestions('int32', testRange, mockMonaco);
            expect(items.length).toBeGreaterThanOrEqual(1);

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels[0]).toContain('$gt');
            expect(labels[0]).toContain('$lt');

            // Should be a snippet
            expect(items[0].kind).toBe(mockCompletionItemKind.Snippet);
        });

        test('returns regex and empty string for string fields', () => {
            const items = createTypeSuggestions('string', testRange, mockMonaco);
            expect(items.length).toBeGreaterThanOrEqual(1);

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('{ $regex: /…/ }');
        });

        test('returns ISODate for date fields', () => {
            const items = createTypeSuggestions('date', testRange, mockMonaco);
            expect(items.length).toBeGreaterThanOrEqual(1);

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('ISODate("…")');
        });

        test('returns ObjectId for objectid fields', () => {
            const items = createTypeSuggestions('objectid', testRange, mockMonaco);
            expect(items).toHaveLength(1);

            expect(getLabelText(items[0].label)).toBe('ObjectId("…")');
        });

        test('returns null for null fields', () => {
            const items = createTypeSuggestions('null', testRange, mockMonaco);
            expect(items).toHaveLength(1);

            expect(getLabelText(items[0].label)).toBe('null');
            expect(items[0].insertText).toBe('null');
        });

        test('returns elemMatch and size for array fields', () => {
            const items = createTypeSuggestions('array', testRange, mockMonaco);
            expect(items.length).toBeGreaterThanOrEqual(2);

            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('{ $elemMatch: { … } }');
            expect(labels).toContain('{ $size: … }');
        });

        test('suggestions have sort prefix 00_ (highest priority)', () => {
            const items = createTypeSuggestions('boolean', testRange, mockMonaco);
            for (const item of items) {
                expect(item.sortText).toMatch(/^00_/);
            }
        });

        test('first suggestion is preselected', () => {
            const items = createTypeSuggestions('int32', testRange, mockMonaco);
            expect(items[0].preselect).toBe(true);
        });
    });

    describe('type suggestions in value position integration', () => {
        const mockMonaco = createMockMonaco();

        test('boolean field at value position shows true/false first', () => {
            const context: CursorContext = { position: 'value', fieldName: 'isActive', fieldBsonType: 'boolean' };
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: context,
            });

            const labels = items.map((i) => getLabelText(i.label));
            // true/false should be present
            expect(labels).toContain('true');
            expect(labels).toContain('false');

            // Operators should also be present
            expect(labels).toContain('$eq');
            expect(labels).toContain('$gt');

            // true/false should sort before operators (00_ < 0_)
            const trueItem = items.find((i) => getLabelText(i.label) === 'true');
            const eqItem = items.find((i) => getLabelText(i.label) === '$eq');
            expect(trueItem!.sortText! < eqItem!.sortText!).toBe(true);
        });

        test('int field at value position shows range query first', () => {
            const context: CursorContext = { position: 'value', fieldName: 'age', fieldBsonType: 'int32' };
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: context,
            });

            // Range query suggestion should be first (sort 00_00)
            const first = items[0];
            expect(getLabelText(first.label)).toContain('$gt');
            expect(first.sortText).toBe('00_00');
        });

        test('unknown type at value position has no type suggestions', () => {
            const context: CursorContext = { position: 'value', fieldName: 'data' };
            const items = createCompletionItems({
                editorType: EditorType.Filter,
                sessionId: undefined,
                range: testRange,
                isDollarPrefix: false,
                monaco: mockMonaco,
                cursorContext: context,
            });

            // No type suggestions, but operators and BSON should still be present
            const labels = items.map((i) => getLabelText(i.label));
            expect(labels).toContain('$eq');
            expect(labels).toContain('ObjectId');

            // No items with 00_ sort prefix
            expect(items.filter((i) => i.sortText?.startsWith('00_'))).toHaveLength(0);
        });
    });
});
