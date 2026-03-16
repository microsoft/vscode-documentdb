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
 * Maps an OperatorEntry from documentdb-constants to a Monaco CompletionItem.
 *
 * This is a pure function with no side effects — safe for unit testing
 * without a Monaco runtime.
 *
 * @param entry - the operator entry to map
 * @param range - the insertion range
 * @param monaco - the Monaco API
 * @param fieldBsonTypes - optional BSON types of the field for type-aware sorting
 */
export function mapOperatorToCompletionItem(
    entry: OperatorEntry,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes?: readonly string[],
): monacoEditor.languages.CompletionItem {
    const hasSnippet = !!entry.snippet;
    const sortPrefix = getOperatorSortPrefix(entry, fieldBsonTypes);

    return {
        label: entry.value,
        kind: getCompletionKindForMeta(entry.meta, monaco.languages.CompletionItemKind),
        insertText: hasSnippet ? entry.snippet! : entry.value,
        insertTextRules: hasSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        detail: entry.description,
        documentation: entry.link
            ? {
                  value: `[DocumentDB Docs](${entry.link})`,
              }
            : undefined,
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
 * Creates Monaco completion items based on the editor context.
 *
 * This function is the main entry point called by the CompletionItemProvider.
 * It delegates to `documentdb-constants` for the operator data and maps
 * each entry to a Monaco CompletionItem.
 */
export function createCompletionItems(params: CreateCompletionItemsParams): monacoEditor.languages.CompletionItem[] {
    const { editorType, sessionId, range, monaco, fieldBsonTypes } = params;

    // Static operator completions from documentdb-constants
    const metaTags = getMetaTagsForEditorType(editorType);
    const entries = getFilteredCompletions({ meta: [...metaTags] });
    const operatorItems = entries.map((entry) => mapOperatorToCompletionItem(entry, range, monaco, fieldBsonTypes));

    // Dynamic field completions from the completion store
    const fieldItems: monacoEditor.languages.CompletionItem[] = [];
    if (sessionId) {
        const context = getCompletionContext(sessionId);
        if (context) {
            for (const field of context.fields) {
                fieldItems.push(mapFieldToCompletionItem(field, range, monaco));
            }
        }
    }

    return [...fieldItems, ...operatorItems];
}
