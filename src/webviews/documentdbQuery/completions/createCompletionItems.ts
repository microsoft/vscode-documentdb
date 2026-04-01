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
import { type CursorContext } from '../shared/cursorContext';
import { EditorType } from '../languageConfig';
import { KEY_POSITION_OPERATORS } from '../shared/completionKnowledge';
import { createJsGlobalCompletionItems } from './jsGlobals';
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
     * When true, completion snippets should include outer `{ }` wrapping.
     * Set when the editor content has no braces (user cleared the editor),
     * so that inserted completions produce valid query syntax.
     */
    needsWrapping?: boolean;
    /**
     * Optional cursor context from the heuristic cursor position detector.
     * When provided, completions are filtered based on the semantic position
     * of the cursor. When undefined, falls back to showing all completions
     * (fields, operators, BSON constructors, and JS globals).
     */
    cursorContext?: CursorContext;
}

// KEY_POSITION_OPERATORS is imported from ./completionKnowledge
// Re-export for backwards compatibility and testing
export { KEY_POSITION_OPERATORS } from '../shared/completionKnowledge';

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
 * - **empty** (unknown + needsWrapping): key-position completions with `{ }` wrapping
 * - **unknown** (ambiguous): all completions — full discovery fallback
 */
export function createCompletionItems(params: CreateCompletionItemsParams): monacoEditor.languages.CompletionItem[] {
    const { editorType, sessionId, range, monaco, fieldBsonTypes, cursorContext, needsWrapping } = params;

    if (!cursorContext || cursorContext.position === 'unknown') {
        if (needsWrapping) {
            // EMPTY editor — no braces present. Show key-position completions
            // (fields + root operators) with { } wrapping so inserted items
            // produce valid syntax.
            return createEmptyEditorCompletions(editorType, sessionId, range, monaco);
        }
        // Genuinely UNKNOWN — show all completions as a discovery fallback.
        return createAllCompletions(editorType, sessionId, range, monaco);
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
            return createAllCompletions(editorType, sessionId, range, monaco);
    }
}

// ---------- Context-specific completion builders ----------

/**
 * Empty editor completions — shows key-position items with `{ }` wrapping.
 *
 * Used when the editor has no braces (user cleared content). Behaves like
 * key position but wraps all inserted completions with outer `{ }` so they
 * produce valid query syntax.
 */
function createEmptyEditorCompletions(
    editorType: EditorType | undefined,
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // Key-position operators — keep outer braces (don't strip)
    const keyEntries = allEntries.filter((e) => KEY_POSITION_OPERATORS.has(e.value));
    const operatorItems = keyEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `1_${entry.value}`;
        return item;
    });

    // Fields — wrap insertText with `{ ... }` for valid syntax
    const fieldItems = getFieldCompletionItems(sessionId, range, monaco).map((item) => ({
        ...item,
        insertText: `{ ${item.insertText as string} }`,
    }));

    return [...fieldItems, ...operatorItems];
}

/**
 * All completions — used when cursor context is genuinely ambiguous (UNKNOWN).
 * Shows fields, all operators, BSON constructors, and JS globals.
 * Full discovery fallback for positions the parser can't classify.
 */
function createAllCompletions(
    editorType: EditorType | undefined,
    sessionId: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    const fieldItems = getFieldCompletionItems(sessionId, range, monaco);

    const operatorItems = allEntries
        .filter((e) => e.meta !== 'bson' && e.meta !== 'variable' && e.standalone !== false)
        .map((entry) => mapOperatorToCompletionItem(entry, range, monaco));

    const bsonItems = allEntries
        .filter((e) => e.meta === 'bson')
        .map((entry) => {
            const item = mapOperatorToCompletionItem(entry, range, monaco);
            item.sortText = `3_${entry.value}`;
            return item;
        });

    const jsGlobals = createJsGlobalCompletionItems(range, monaco);

    return [...fieldItems, ...operatorItems, ...bsonItems, ...jsGlobals];
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
        // Strip outer braces — the user is already inside `{ }` at key position,
        // so inserting the full `{ $and: [...] }` would create double braces.
        const item = mapOperatorToCompletionItem(entry, range, monaco, undefined, true);
        item.sortText = `1_${entry.value}`;
        return item;
    });

    const fieldItems = getFieldCompletionItems(sessionId, range, monaco);
    return [...fieldItems, ...operatorItems];
}

/**
 * Value position completions:
 * - **Project editor**: `1` (include) and `0` (exclude) — the most common projection values
 * - **Sort editor**: `1` (ascending) and `-1` (descending)
 * - **Filter editor** (default):
 *   1. Type-aware suggestions (sort `00_`) — e.g., `true`/`false` for booleans
 *   2. Query operators with brace-wrapping snippets (sort `0_`–`2_`)
 *   3. BSON constructors (sort `3_`)
 *   4. JS globals: Date, Math, RegExp, etc. (sort `4_`)
 */
function createValuePositionCompletions(
    editorType: EditorType | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonType: string | undefined,
): monacoEditor.languages.CompletionItem[] {
    // Project editor: only show include/exclude values
    if (editorType === EditorType.Project) {
        return createProjectValueCompletions(range, monaco);
    }

    // Sort editor: only show ascending/descending values
    if (editorType === EditorType.Sort) {
        return createSortValueCompletions(range, monaco);
    }

    const metaTags = getMetaTagsForEditorType(editorType);
    const allEntries = getFilteredCompletions({ meta: [...metaTags] });

    // 1. Type-aware suggestions (highest priority)
    const typeSuggestions = createTypeSuggestions(fieldBsonType, range, monaco);

    // 2. Operators, excluding key-position-only operators.
    //    When fieldBsonType is known, apply type-aware sorting so comparison
    //    operators (e.g., $eq) appear above irrelevant ones (e.g., $bitsAllSet).
    const fieldBsonTypes = fieldBsonType ? [fieldBsonType] : undefined;
    const operatorEntries = allEntries.filter(
        (e) =>
            e.meta !== 'bson' &&
            e.meta !== 'variable' &&
            e.standalone !== false &&
            !KEY_POSITION_OPERATORS.has(e.value),
    );
    const operatorItems = operatorEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco, fieldBsonTypes);
        // If type-aware sorting produced a prefix, keep it; otherwise default to 0_
        if (!item.sortText) {
            item.sortText = `0_${entry.value}`;
        }
        return item;
    });

    // 3. BSON constructors (sort prefix 3_ — after all operator tiers: 0_, 1a_, 1b_, 2_)
    const bsonEntries = allEntries.filter((e) => e.meta === 'bson');
    const bsonItems = bsonEntries.map((entry) => {
        const item = mapOperatorToCompletionItem(entry, range, monaco);
        item.sortText = `3_${entry.value}`;
        return item;
    });

    // 4. JS globals: Date, Math, RegExp, Infinity, NaN, undefined (sort prefix 4_)
    const jsGlobals = createJsGlobalCompletionItems(range, monaco);

    return [...typeSuggestions, ...operatorItems, ...bsonItems, ...jsGlobals];
}

/**
 * Value completions for the **project** editor: `1` (include) and `0` (exclude).
 *
 * Projection operators like `$slice` and `$elemMatch` are already available
 * via operator-position completions; these simple numeric values cover the
 * most common use case.
 */
function createProjectValueCompletions(
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    return [
        {
            label: { label: '1', description: 'include field' },
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: '1',
            sortText: '00_1',
            preselect: true,
            range,
        },
        {
            label: { label: '0', description: 'exclude field' },
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: '0',
            sortText: '00_0',
            range,
        },
    ];
}

/**
 * Value completions for the **sort** editor: `1` (ascending) and `-1` (descending).
 */
function createSortValueCompletions(
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    return [
        {
            label: { label: '1', description: 'ascending' },
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: '1',
            sortText: '00_1',
            preselect: true,
            range,
        },
        {
            label: { label: '-1', description: 'descending' },
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: '-1',
            sortText: '00_-1',
            range,
        },
    ];
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
        (e) =>
            e.meta !== 'bson' &&
            e.meta !== 'variable' &&
            e.standalone !== false &&
            !KEY_POSITION_OPERATORS.has(e.value),
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
