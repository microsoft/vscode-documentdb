/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Monaco-specific type-aware value suggestions.
 *
 * Platform-neutral definitions (TypeSuggestionDef, TYPE_SUGGESTIONS data,
 * getTypeSuggestionDefs) have been extracted to `../shared/typeSuggestionData.ts`.
 * This module handles only the Monaco CompletionItem creation.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { escapeSnippetDollars } from '../shared/snippetUtils';
import { getTypeSuggestionDefs } from '../shared/typeSuggestionData';

// Re-export platform-neutral types for backward compatibility
export { getTypeSuggestionDefs, type TypeSuggestionDef } from '../shared/typeSuggestionData';

/**
 * Creates type-aware value suggestions based on the field's BSON type.
 *
 * Returns an array of high-priority completion items (sort prefix `00_`)
 * that appear at the top of the value-position completion list.
 *
 * Returns an empty array when the BSON type is unknown or has no specific suggestions.
 *
 * @param fieldBsonType - BSON type string from the schema (e.g., 'int32', 'string', 'boolean')
 * @param range - the insertion range
 * @param monaco - the Monaco API
 */
export function createTypeSuggestions(
    fieldBsonType: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    const suggestions = getTypeSuggestionDefs(fieldBsonType);
    if (suggestions.length === 0) {
        return [];
    }

    return suggestions.map((def, index) => {
        let insertText = def.insertText;
        if (def.isSnippet) {
            insertText = escapeSnippetDollars(insertText);
        }

        return {
            label: {
                label: def.label,
                description: def.description,
            },
            kind: def.isSnippet
                ? monaco.languages.CompletionItemKind.Snippet
                : monaco.languages.CompletionItemKind.Value,
            insertText,
            insertTextRules: def.isSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            documentation: def.documentation ? { value: def.documentation } : undefined,
            sortText: `00_${String(index).padStart(2, '0')}`,
            preselect: index === 0,
            range,
        };
    });
}
