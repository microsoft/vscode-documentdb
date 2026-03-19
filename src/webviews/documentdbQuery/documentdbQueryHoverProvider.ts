/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hover provider logic for the `documentdb-query` language.
 *
 * Provides inline documentation when hovering over operators,
 * BSON constructors, and field names. Uses `documentdb-constants` for
 * the operator registry and the completion store for field type info.
 */

import { getAllCompletions } from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { type FieldCompletionData } from '../../utils/json/data-api/autocomplete/toFieldCompletionItems';

/**
 * A callback that resolves a word to field data from the completion store.
 */
export type FieldDataLookup = (word: string) => FieldCompletionData | undefined;

/**
 * Returns hover content for a word under the cursor.
 *
 * Tries multiple candidates to handle cases where:
 * - The cursor is on `gt` after `$` (need to try `$gt`)
 * - The cursor is on `ObjectId` (try as-is)
 * - The cursor is on a field name like `age` (check field data)
 *
 * Operators/BSON constructors take priority over field names.
 *
 * @param word - The word at the cursor position
 * @param fieldLookup - optional callback to resolve field names to field data
 * @returns A Monaco Hover or null if no match
 */
export function getHoverContent(word: string, fieldLookup?: FieldDataLookup): monacoEditor.languages.Hover | null {
    // Try with '$' prefix first (for operators where cursor lands after $)
    // Then try the word as-is (for BSON constructors like ObjectId)
    const candidates = word.startsWith('$') ? [word] : [`$${word}`, word];

    const allEntries = getAllCompletions();

    for (const candidate of candidates) {
        const match = allEntries.find((e) => e.value === candidate);
        if (match) {
            const lines: string[] = [`**${match.value}**`];

            if (match.description || match.link) {
                lines.push('---');
                lines.push('<br>');
            }

            if (match.description) {
                lines.push(match.description);
            }
            if (match.link) {
                if (match.description) {
                    lines.push('<br>');
                }
                lines.push(`[ⓘ Documentation](${match.link})`);
            }

            return {
                contents: [{ value: lines.join('\n\n'), isTrusted: true, supportHtml: true }],
            };
        }
    }

    // If no operator match, try field name lookup
    if (fieldLookup) {
        const fieldData = fieldLookup(word);
        if (fieldData) {
            return buildFieldHover(fieldData);
        }
    }

    return null;
}

/**
 * Builds a hover tooltip for a field name.
 */
function buildFieldHover(field: FieldCompletionData): monacoEditor.languages.Hover {
    let header = `**${field.fieldName}**`;

    if (field.isSparse) {
        header += ' &nbsp;&nbsp; <small>sparse: not present in all documents</small>';
    }

    const lines: string[] = [header];

    // Inferred types section
    const typeList = field.displayTypes && field.displayTypes.length > 0 ? field.displayTypes : [field.displayType];
    if (typeList && typeList.length > 0) {
        lines.push('---');
        lines.push('<br>');
        lines.push(`Inferred Type: ${typeList.map((type) => `\`${type}\``).join(', ')}`);
    }

    return {
        contents: [{ value: lines.join('\n\n'), isTrusted: true, supportHtml: true }],
    };
}
