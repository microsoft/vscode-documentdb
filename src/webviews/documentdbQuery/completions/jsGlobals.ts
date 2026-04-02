/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Monaco-specific JS global completion items.
 *
 * Platform-neutral definitions (JsGlobalDef interface, JS_GLOBALS data)
 * have been extracted to `../shared/jsGlobalDefs.ts`.
 * This module handles only the Monaco CompletionItem creation.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { JS_GLOBALS } from '../shared/jsGlobalDefs';
import { escapeSnippetDollars } from '../shared/snippetUtils';

/**
 * Creates completion items for JavaScript globals supported by the
 * shell-bson-parser sandbox.
 *
 * These are shown at value position with sort prefix `4_` (after BSON
 * constructors at `3_`).
 *
 * @param range - the insertion range
 * @param monaco - the Monaco API
 */
export function createJsGlobalCompletionItems(
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    return JS_GLOBALS.map((def) => {
        const hasSnippet = !!def.snippet;
        let insertText = hasSnippet ? def.snippet! : def.label;
        if (hasSnippet) {
            insertText = escapeSnippetDollars(insertText);
        }

        return {
            label: {
                label: def.label,
                description: def.description,
            },
            kind: hasSnippet
                ? monaco.languages.CompletionItemKind.Constructor
                : monaco.languages.CompletionItemKind.Constant,
            insertText,
            insertTextRules: hasSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            documentation: { value: def.documentation },
            sortText: `4_${def.label}`,
            range,
        };
    });
}
