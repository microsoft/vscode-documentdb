/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hover provider logic for the `documentdb-query` language.
 *
 * Provides inline documentation when hovering over operators and
 * BSON constructors. Uses `documentdb-constants` for the operator registry.
 */

import { getAllCompletions } from '@vscode-documentdb/documentdb-constants';
// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * Returns hover content for a word under the cursor.
 *
 * Tries multiple candidates to handle cases where:
 * - The cursor is on `gt` after `$` (need to try `$gt`)
 * - The cursor is on `ObjectId` (try as-is)
 *
 * @param word - The word at the cursor position
 * @returns A Monaco Hover or null if no match
 */
export function getHoverContent(word: string): monacoEditor.languages.Hover | null {
    // Try with '$' prefix first (for operators where cursor lands after $)
    // Then try the word as-is (for BSON constructors like ObjectId)
    const candidates = word.startsWith('$') ? [word] : [`$${word}`, word];

    const allEntries = getAllCompletions();

    for (const candidate of candidates) {
        const match = allEntries.find((e) => e.value === candidate);
        if (match) {
            const lines: string[] = [`**${match.value}**`];
            if (match.description) {
                lines.push('', match.description);
            }
            if (match.link) {
                lines.push('', `[DocumentDB Docs](${match.link})`);
            }
            return {
                contents: [{ value: lines.join('\n') }],
            };
        }
    }
    return null;
}
