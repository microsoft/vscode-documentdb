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
 * Maps an OperatorEntry from documentdb-constants to a Monaco CompletionItem.
 *
 * This is a pure function with no side effects — safe for unit testing
 * without a Monaco runtime.
 */
export function mapOperatorToCompletionItem(
    entry: OperatorEntry,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem {
    const hasSnippet = !!entry.snippet;

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
        range,
    };
}

/**
 * Parameters for creating completion items.
 */
export interface CreateCompletionItemsParams {
    /** The editor type parsed from the model URI (undefined if URI doesn't match). */
    editorType: EditorType | undefined;
    /** The range to insert completions at. */
    range: monacoEditor.IRange;
    /** Whether the cursor is immediately after a '$' character. */
    isDollarPrefix: boolean;
    /** The Monaco editor API. */
    monaco: typeof monacoEditor;
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
    const { editorType, range, monaco } = params;

    const metaTags = getMetaTagsForEditorType(editorType);
    const entries = getFilteredCompletions({ meta: [...metaTags] });

    return entries.map((entry) => mapOperatorToCompletionItem(entry, range, monaco));
}
