/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completion provider logic for the `documentdb-query` language.
 *
 * This module is structured for testability: the core mapping function
 * (`mapOperatorToCompletionItem`) and the item-building function
 * (`createCompletionItems`) are pure functions that receive their Monaco
 * dependency through parameters rather than imports.
 *
 * Context routing uses the model URI to determine which completions to show:
 * - `documentdb://filter/*`  → query operators + BSON constructors
 * - `documentdb://project/*` → field identifiers (future)
 * - `documentdb://sort/*`    → field identifiers (future)
 */

import {
    FILTER_COMPLETION_META,
    getFilteredCompletions,
    PROJECTION_COMPLETION_META,
    type OperatorEntry,
} from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { type FieldCompletionData } from '../../utils/json/data-api/autocomplete/toFieldCompletionItems';
import { getCompletionContext } from './completionStore';
import { type CursorContext } from './cursorContext';
import { EditorType } from './languageConfig';

/**
 * Maps a meta tag category to a Monaco CompletionItemKind.
 *
 * This mapping is extracted as a pure function for testability.
 */
export function getCompletionKindForMeta(
    meta: string,
    kinds: typeof monacoEditor.languages.CompletionItemKind,
): number {
    if (meta.startsWith('query')) return kinds.Operator;
    if (meta.startsWith('expr')) return kinds.Function;
    if (meta === 'bson') return kinds.Constructor;
    if (meta === 'stage') return kinds.Module;
    if (meta === 'accumulator') return kinds.Method;
    if (meta === 'update') return kinds.Property;
    if (meta === 'variable') return kinds.Variable;
    if (meta === 'window') return kinds.Event;
    if (meta === 'field:identifier') return kinds.Field;
    return kinds.Text;
}

/**
 * Computes a sortText prefix for an operator based on its type relevance
 * to the given field BSON types.
 *
 * - `"0_"` — Type-relevant: operator's `applicableBsonTypes` intersects with `fieldBsonTypes`
 * - `"1_"` — Universal: operator has no `applicableBsonTypes` (works on any type)
 * - `"2_"` — Non-matching: operator's `applicableBsonTypes` is set but doesn't match
 *
 * Returns `undefined` when no field type info is available (no sorting override).
 */
export function getOperatorSortPrefix(
    entry: OperatorEntry,
    fieldBsonTypes: readonly string[] | undefined,
): string | undefined {
    if (!fieldBsonTypes || fieldBsonTypes.length === 0) {
        return undefined;
    }

    if (!entry.applicableBsonTypes || entry.applicableBsonTypes.length === 0) {
        // Universal operator — no type restriction
        return '1_';
    }

    const hasMatch = entry.applicableBsonTypes.some((t) => fieldBsonTypes.includes(t));
    return hasMatch ? '0_' : '2_';
}

/**
 * Extracts a human-readable category label from a meta tag.
 *
 * Examples:
 * - `'query:comparison'` → `'comparison'`
 * - `'query:logical'` → `'logical'`
 * - `'bson'` → `'bson'`
 * - `'variable'` → `'variable'`
 */
export function getCategoryLabel(meta: string): string {
    const colonIndex = meta.indexOf(':');
    return colonIndex >= 0 ? meta.substring(colonIndex + 1) : meta;
}

/**
 * Strips the outermost `{ ` and ` }` from an operator snippet.
 *
 * Operator snippets in documentdb-constants are designed for value position
 * (e.g., `{ $gt: ${1:value} }`). At operator position, the user is already
 * inside braces, so the outer wrapping must be removed to avoid double-nesting.
 *
 * Only strips if the snippet starts with `'{ '` and ends with `' }'`.
 * Inner brackets/braces are preserved:
 * - `{ $in: [${1:value}] }` → `$in: [${1:value}]`
 * - `{ $gt: ${1:value} }` → `$gt: ${1:value}`
 *
 * @param snippet - the original snippet string
 * @returns the snippet with outer braces stripped, or the original if not wrapped
 */
export function stripOuterBraces(snippet: string): string {
    if (snippet.startsWith('{ ') && snippet.endsWith(' }')) {
        return snippet.slice(2, -2);
    }
    return snippet;
}

/**
 * Maps an OperatorEntry from documentdb-constants to a Monaco CompletionItem.
 *
 * This is a pure function with no side effects — safe for unit testing
 * without a Monaco runtime.
 *
 * @param entry - the operator entry to map
 * @param range - the insertion range
 * @param monaco - the Monaco API
 * @param fieldBsonTypes - optional BSON types of the field for type-aware sorting
 * @param stripBraces - when true, strip outer `{ }` from snippets (for operator position)
 */
export function mapOperatorToCompletionItem(
    entry: OperatorEntry,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes?: readonly string[],
    stripBraces?: boolean,
): monacoEditor.languages.CompletionItem {
    const hasSnippet = !!entry.snippet;
    const sortPrefix = getOperatorSortPrefix(entry, fieldBsonTypes);
    let insertText = hasSnippet ? entry.snippet! : entry.value;
    if (stripBraces && hasSnippet) {
        insertText = stripOuterBraces(insertText);
    }

    const categoryLabel = getCategoryLabel(entry.meta);

    // Build documentation: description text + optional docs link
    let documentationValue = entry.description;
    if (entry.link) {
        documentationValue += `\n\n[DocumentDB Docs](${entry.link})`;
    }

    return {
        label: {
            label: entry.value,
            description: categoryLabel,
        },
        kind: getCompletionKindForMeta(entry.meta, monaco.languages.CompletionItemKind),
        insertText,
        insertTextRules: hasSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        documentation: {
            value: documentationValue,
        },
        sortText: sortPrefix ? `${sortPrefix}${entry.value}` : undefined,
        range,
    };
}

/**
 * Maps a FieldCompletionData entry to a Monaco CompletionItem.
 *
 * Fields are given a sort prefix of `"0_"` so they appear before operators
 * in the completion list.
 */
export function mapFieldToCompletionItem(
    field: FieldCompletionData,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem {
    const sparseIndicator = field.isSparse ? ' (sparse)' : '';
    return {
        label: field.fieldName,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: field.insertText,
        detail: `${field.displayType}${sparseIndicator}`,
        sortText: `0_${field.fieldName}`,
        range,
    };
}

/**
 * Parameters for creating completion items.
 */
export interface CreateCompletionItemsParams {
    /** The editor type parsed from the model URI (undefined if URI doesn't match). */
    editorType: EditorType | undefined;
    /** The session ID for looking up dynamic field completions. */
    sessionId: string | undefined;
    /** The range to insert completions at. */
    range: monacoEditor.IRange;
    /** Whether the cursor is immediately after a '$' character. */
    // TODO: WIP — isDollarPrefix is passed but not yet consumed by createCompletionItems().
    // Will be used to filter/prioritize $-prefixed operators vs constructors.
    isDollarPrefix: boolean;
    /** The Monaco editor API. */
    monaco: typeof monacoEditor;
    /**
     * Optional BSON types of the field the cursor is operating on.
     * When provided, operators are sorted by type relevance:
     * type-matching first, universal second, non-matching last.
     */
    fieldBsonTypes?: readonly string[];
    /**
     * Optional cursor context from the heuristic cursor position detector.
     * When provided, completions are filtered based on the semantic position
     * of the cursor (key, value, operator, array-element).
     * When undefined, falls back to showing all completions (backward compatible).
     */
    cursorContext?: CursorContext;
}

/**
 * Returns the completion meta tags appropriate for the given editor type.
 *
 * Exported for testing.
 */
export function getMetaTagsForEditorType(editorType: EditorType | undefined): readonly string[] {
    switch (editorType) {
        case EditorType.Filter:
            return FILTER_COMPLETION_META;
        case EditorType.Project:
        case EditorType.Sort:
            return PROJECTION_COMPLETION_META;
        default:
            // Default to filter completions for unknown/unmatched URIs
            return FILTER_COMPLETION_META;
    }
}

/**
 * Operator values that are valid at key position (root level of a query object).
 * These are logical operators and top-level query operators that take a document-level position,
 * as opposed to value-level operators like $gt, $regex, etc.
 *
 * Exported for testing.
 */
export const KEY_POSITION_OPERATORS = new Set([
    '$and',
    '$or',
    '$nor',
    '$not',
    '$comment',
    '$expr',
    '$jsonSchema',
    '$text',
    '$where',
]);

/**
 * Creates Monaco completion items based on the editor context.
 *
 * This function is the main entry point called by the CompletionItemProvider.
 * It delegates to `documentdb-constants` for the operator data and maps
 * each entry to a Monaco CompletionItem.
 *
 * When a `cursorContext` is provided, completions are filtered based on the
 * semantic position of the cursor:
 * - **key**: field names + key-position operators ($and, $or, etc.)
 * - **value**: query operators (with braces in snippet) + BSON constructors
 * - **operator**: query operators (without braces in snippet) with type-aware sorting
 * - **array-element**: same as key position
 * - **unknown**: all completions (backward compatible fallback)
 */
export function createCompletionItems(params: CreateCompletionItemsParams): monacoEditor.languages.CompletionItem[] {
    const { editorType, sessionId, range, monaco, fieldBsonTypes, cursorContext } = params;

    // If no cursor context → fall back to showing everything (backward compatible)
    if (!cursorContext || cursorContext.position === 'unknown') {
        return createAllCompletions(editorType, sessionId, range, monaco, fieldBsonTypes);
    }

    switch (cursorContext.position) {
        case 'key':
        case 'array-element':
            return createKeyPositionCompletions(editorType, sessionId, range, monaco);

        case 'value':
            return createValuePositionCompletions(editorType, range, monaco);

        case 'operator': {
            const bsonTypes = cursorContext.fieldBsonType ? [cursorContext.fieldBsonType] : fieldBsonTypes;
            return createOperatorPositionCompletions(editorType, range, monaco, bsonTypes);
        }

        default:
            return createAllCompletions(editorType, sessionId, range, monaco, fieldBsonTypes);
    }
}

/**
 * Returns all completions (operators + fields) — the pre-4.5 behavior.
 * Used as fallback when cursor context is unknown or not provided.
 */
function createAllCompletions(
    editorType: EditorType | undefined,
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes: readonly string[] | undefined,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const entries = getFilteredCompletions({ meta: [...metaTags] });
    const operatorItems = entries.map((entry) => mapOperatorToCompletionItem(entry, range, monaco, fieldBsonTypes));

    const fieldItems = getFieldCompletionItems(sessionId, range, monaco);
    return [...fieldItems, ...operatorItems];
}

/**
 * Returns completions appropriate for key position:
 * field names + key-position operators ($and, $or, $nor, $not, $comment, $expr, $jsonSchema, $text, $where).
 *
 * Fields get sort prefix `0_`, operators get `1_`.
 */
function createKeyPositionCompletions(
    editorType: EditorType | undefined,
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // Filter to only key-position operators
    const keyEntries = allEntries.filter((e) => KEY_POSITION_OPERATORS.has(e.value));
    const operatorItems = keyEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        // Give operators a `1_` prefix so fields sort first
        item.sortText = `1_${entry.value}`;
        return item;
    });

    const fieldItems = getFieldCompletionItems(sessionId, range, monaco);
    return [...fieldItems, ...operatorItems];
}

/**
 * Returns completions appropriate for value position:
 * Query operators first (with full brace-wrapping snippets), then BSON constructors.
 *
 * Operators use their original snippets which include `{ }` — this is correct
 * at value position because the user needs the nested object
 * (e.g., `{ _id: <cursor> }` → selecting `$gt` inserts `{ $gt: value }`).
 */
function createValuePositionCompletions(
    editorType: EditorType | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // Operators first (sort prefix 0_), excluding key-position-only operators
    const operatorEntries = allEntries.filter(
        (e) => e.meta !== 'bson' && e.meta !== 'variable' && !KEY_POSITION_OPERATORS.has(e.value),
    );
    const operatorItems = operatorEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `0_${entry.value}`;
        return item;
    });

    // BSON constructors second (sort prefix 1_)
    const bsonEntries = allEntries.filter((e) => e.meta === 'bson');
    const bsonItems = bsonEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `1_${entry.value}`;
        return item;
    });

    return [...operatorItems, ...bsonItems];
}

/**
 * Returns completions appropriate for operator position (inside `{ field: { | } }`):
 * Query operators (comparison, element, array, evaluation, bitwise) excluding key-position-only operators.
 * Type-aware sorting is applied when field BSON types are available.
 */
function createOperatorPositionCompletions(
    editorType: EditorType | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes: readonly string[] | undefined,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // Exclude key-position-only operators and BSON constructors
    const operatorEntries = allEntries.filter(
        (e) => e.meta !== 'bson' && e.meta !== 'variable' && !KEY_POSITION_OPERATORS.has(e.value),
    );
    // Strip outer braces from snippets — at operator position the user is already inside { }
    return operatorEntries.map((entry) => mapOperatorToCompletionItem(entry, range, monaco, fieldBsonTypes, true));
}

/**
 * Retrieves field completion items from the completion store for the given session.
 */
function getFieldCompletionItems(
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const fieldItems: monacoEditor.languages.CompletionItem[] = [];
    if (sessionId) {
        const context = getCompletionContext(sessionId);
        if (context) {
            for (const field of context.fields) {
                fieldItems.push(mapFieldToCompletionItem(field, range, monaco));
            }
        }
    }
    return fieldItems;
}
