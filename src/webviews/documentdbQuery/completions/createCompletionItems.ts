/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Context-sensitive completion item creation for the `documentdb-query` language.
 *
 * This module is the main entry point for the completion provider. It uses
 * cursor context detection to determine which completions to show and delegates
 * to specialized functions for each context (key, value, operator, etc.).
 */

import {
    FILTER_COMPLETION_META,
    getFilteredCompletions,
    PROJECTION_COMPLETION_META,
} from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { getCompletionContext } from '../completionStore';
import { type CursorContext } from '../cursorContext';
import { EditorType } from '../languageConfig';
import { mapFieldToCompletionItem, mapOperatorToCompletionItem } from './mapCompletionItems';
import { createTypeSuggestions } from './typeSuggestions';

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
    isDollarPrefix: boolean;
    /** The Monaco editor API. */
    monaco: typeof monacoEditor;
    /**
     * Optional BSON types of the field the cursor is operating on.
     * When provided, operators are sorted by type relevance.
     */
    fieldBsonTypes?: readonly string[];
    /**
     * Optional cursor context from the heuristic cursor position detector.
     * When provided, completions are filtered based on the semantic position
     * of the cursor. When undefined, falls back to showing all completions.
     */
    cursorContext?: CursorContext;
}

/**
 * Operator values that are valid at key position (root level of a query object).
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
            return FILTER_COMPLETION_META;
    }
}

/**
 * Creates Monaco completion items based on the editor context.
 *
 * Main entry point called by the CompletionItemProvider.
 *
 * Context routing:
 * - **key**: field names + key-position operators ($and, $or, etc.)
 * - **value**: type suggestions + operators (with braces) + BSON constructors
 * - **operator**: operators (without braces) with type-aware sorting
 * - **array-element**: same as key position
 * - **unknown**: all completions (backward compatible fallback)
 */
export function createCompletionItems(params: CreateCompletionItemsParams): monacoEditor.languages.CompletionItem[] {
    const { editorType, sessionId, range, monaco, fieldBsonTypes, cursorContext } = params;

    if (!cursorContext || cursorContext.position === 'unknown') {
        return createAllCompletions(editorType, sessionId, range, monaco, fieldBsonTypes);
    }

    switch (cursorContext.position) {
        case 'key':
        case 'array-element':
            return createKeyPositionCompletions(editorType, sessionId, range, monaco);

        case 'value': {
            const fieldBsonType = cursorContext.fieldBsonType;
            return createValuePositionCompletions(editorType, range, monaco, fieldBsonType);
        }

        case 'operator': {
            const bsonTypes = cursorContext.fieldBsonType ? [cursorContext.fieldBsonType] : fieldBsonTypes;
            return createOperatorPositionCompletions(editorType, range, monaco, bsonTypes);
        }

        default:
            return createAllCompletions(editorType, sessionId, range, monaco, fieldBsonTypes);
    }
}

// ---------- Context-specific completion builders ----------

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

function createKeyPositionCompletions(
    editorType: EditorType | undefined,
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    const keyEntries = allEntries.filter((e) => KEY_POSITION_OPERATORS.has(e.value));
    const operatorItems = keyEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `1_${entry.value}`;
        return item;
    });

    const fieldItems = getFieldCompletionItems(sessionId, range, monaco);
    return [...fieldItems, ...operatorItems];
}

/**
 * Value position completions:
 * 1. Type-aware suggestions (sort `00_`) — e.g., `true`/`false` for booleans
 * 2. Query operators with brace-wrapping snippets (sort `0_`)
 * 3. BSON constructors (sort `1_`)
 */
function createValuePositionCompletions(
    editorType: EditorType | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonType: string | undefined,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // 1. Type-aware suggestions (highest priority)
    const typeSuggestions = createTypeSuggestions(fieldBsonType, range, monaco);

    // 2. Operators (sort prefix 0_), excluding key-position-only operators
    const operatorEntries = allEntries.filter(
        (e) => e.meta !== 'bson' && e.meta !== 'variable' && !KEY_POSITION_OPERATORS.has(e.value),
    );
    const operatorItems = operatorEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `0_${entry.value}`;
        return item;
    });

    // 3. BSON constructors (sort prefix 1_)
    const bsonEntries = allEntries.filter((e) => e.meta === 'bson');
    const bsonItems = bsonEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `1_${entry.value}`;
        return item;
    });

    return [...typeSuggestions, ...operatorItems, ...bsonItems];
}

function createOperatorPositionCompletions(
    editorType: EditorType | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes: readonly string[] | undefined,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    const operatorEntries = allEntries.filter(
        (e) => e.meta !== 'bson' && e.meta !== 'variable' && !KEY_POSITION_OPERATORS.has(e.value),
    );
    return operatorEntries.map((entry) => mapOperatorToCompletionItem(entry, range, monaco, fieldBsonTypes, true));
}

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
