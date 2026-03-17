/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Functions for mapping operator and field data to Monaco CompletionItems.
 */

import { type OperatorEntry } from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { type FieldCompletionData } from '../../../utils/json/data-api/autocomplete/toFieldCompletionItems';
import { escapeSnippetDollars, stripOuterBraces } from './snippetUtils';

/**
 * Maps a meta tag category to a Monaco CompletionItemKind.
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
 * Sorting tiers (ascending = higher priority):
 * - `"0_"` — Type-relevant: operator's `applicableBsonTypes` intersects with `fieldBsonTypes`
 * - `"1a_"` — Comparison operators (universal): `$eq`, `$ne`, `$gt`, `$in`, etc.
 *   These are the most commonly used operators for any field type.
 * - `"1b_"` — Other universal operators: element, evaluation, geospatial, etc.
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
        // Promote comparison operators above other universal operators
        return entry.meta === 'query:comparison' ? '1a_' : '1b_';
    }

    const hasMatch = entry.applicableBsonTypes.some((t) => fieldBsonTypes.includes(t));
    return hasMatch ? '0_' : '2_';
}

/**
 * Extracts a human-readable category label from a meta tag.
 * `'query:comparison'` → `'comparison'`, `'bson'` → `'bson'`
 */
export function getCategoryLabel(meta: string): string {
    const colonIndex = meta.indexOf(':');
    return colonIndex >= 0 ? meta.substring(colonIndex + 1) : meta;
}

/**
 * Maps an OperatorEntry from documentdb-constants to a Monaco CompletionItem.
 *
 * Pure function — safe for unit testing without a Monaco runtime.
 *
 * @param entry - the operator entry to map
 * @param range - the insertion range
 * @param monaco - the Monaco API
 * @param fieldBsonTypes - optional BSON types of the field for type-aware sorting
 * @param shouldStripBraces - when true, strip outer `{ }` from snippets (for operator position)
 */
export function mapOperatorToCompletionItem(
    entry: OperatorEntry,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
    fieldBsonTypes?: readonly string[],
    shouldStripBraces?: boolean,
): monacoEditor.languages.CompletionItem {
    const hasSnippet = !!entry.snippet;
    const sortPrefix = getOperatorSortPrefix(entry, fieldBsonTypes);
    let insertText = hasSnippet ? entry.snippet! : entry.value;
    if (shouldStripBraces && hasSnippet) {
        insertText = stripOuterBraces(insertText);
    }
    if (hasSnippet) {
        insertText = escapeSnippetDollars(insertText);
    }

    const categoryLabel = getCategoryLabel(entry.meta);

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
 * Fields are given a sort prefix of `"0_"` so they appear before operators.
 * The insert text includes a trailing `: $1` snippet so that selecting a
 * field name immediately places the cursor at the value position.
 */
export function mapFieldToCompletionItem(
    field: FieldCompletionData,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem {
    const sparseIndicator = field.isSparse ? ' (sparse)' : '';
    return {
        label: {
            label: field.fieldName,
            description: `${field.displayType}${sparseIndicator}`,
        },
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: `${field.insertText}: $1`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `0_${field.fieldName}`,
        range,
    };
}
