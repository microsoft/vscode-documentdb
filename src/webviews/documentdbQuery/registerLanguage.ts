/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Registers the `documentdb-query` custom language with Monaco Editor.
 *
 * This module:
 * 1. Registers the language ID with Monaco
 * 2. Imports the JavaScript Monarch tokenizer for syntax highlighting
 * 3. Registers a custom CompletionItemProvider scoped to `documentdb-query`
 * 4. Registers a HoverProvider for operator/constructor documentation
 *
 * The JS tokenizer provides correct highlighting for:
 * - Unquoted identifiers: `{ name: 1 }`
 * - Single-quoted strings: `{ 'name': 1 }`
 * - Double-quoted strings: `{ "name": 1 }`
 * - BSON constructors: `ObjectId("...")`
 * - Regex literals: `/^alice/i`
 * - Comments, template literals, function bodies (for future $function support)
 *
 * Because this is a custom language ID, the TypeScript worker is NOT loaded,
 * keeping the bundle ~400-600 KB lighter and ensuring a clean completion slate.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { createCompletionItems } from './documentdbQueryCompletionProvider';
import { getHoverContent } from './documentdbQueryHoverProvider';
import { LANGUAGE_ID, parseEditorUri } from './languageConfig';

/** Coalesces concurrent registrations into a single promise. */
let registrationPromise: Promise<void> | undefined;

/**
 * Registers the `documentdb-query` language with Monaco.
 *
 * Safe to call multiple times — concurrent calls coalesce into one registration.
 *
 * @param monaco - the Monaco editor API instance
 */
export function registerDocumentDBQueryLanguage(monaco: typeof monacoEditor): Promise<void> {
    if (!registrationPromise) {
        registrationPromise = doRegisterLanguage(monaco);
    }
    return registrationPromise;
}

async function doRegisterLanguage(monaco: typeof monacoEditor): Promise<void> {
    // Step 1: Register the language ID
    monaco.languages.register({ id: LANGUAGE_ID });

    // Step 2: Import the JS Monarch tokenizer
    // This path has been stable since Monaco 0.20 and exports { conf, language }
    // eslint-disable-next-line import/no-internal-modules
    const jsLanguage = (await import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js')) as {
        language: monacoEditor.languages.IMonarchLanguage;
        conf: monacoEditor.languages.LanguageConfiguration;
    };

    // Step 3: Apply the JS tokenizer and language configuration to our custom language
    monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, jsLanguage.language);
    monaco.languages.setLanguageConfiguration(LANGUAGE_ID, jsLanguage.conf);

    // Step 4: Register the completion provider
    monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['$', '"', "'", '{', '.'],
        provideCompletionItems: (
            model: monacoEditor.editor.ITextModel,
            position: monacoEditor.Position,
        ): monacoEditor.languages.CompletionList => {
            // Parse the model URI to determine editor context
            const uriString = model.uri.toString();
            const parsed = parseEditorUri(uriString);

            // Get the word at the current position for range calculation
            const wordInfo = model.getWordUntilPosition(position);
            let range: monacoEditor.IRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: wordInfo.startColumn,
                endColumn: wordInfo.endColumn,
            };

            // Check if cursor is preceded by '$' (for operator completions)
            // Monaco's getWordUntilPosition() does not treat '$' as part of a word boundary.
            // When the user types '$g', wordInfo.startColumn points to 'g', not '$'.
            // Without this fix, selecting '$gt' would insert '$$gt' (double dollar).
            const lineContent = model.getLineContent(position.lineNumber);
            // -2 because columns are 1-based: e.g. startColumn=1 → index -1 → undefined (safe).
            // JS returns undefined for out-of-bounds array access, so (undefined === '$') → false.
            const charBefore = lineContent[wordInfo.startColumn - 2];

            if (charBefore === '$') {
                range = { ...range, startColumn: range.startColumn - 1 };
            }

            // Build completion items based on context
            const items = createCompletionItems({
                editorType: parsed?.editorType,
                sessionId: parsed?.sessionId,
                range,
                isDollarPrefix: charBefore === '$',
                monaco,
            });

            return { suggestions: items };
        },
    });

    // Step 5: Register the hover provider
    monaco.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover: (
            model: monacoEditor.editor.ITextModel,
            position: monacoEditor.Position,
        ): monacoEditor.languages.Hover | null => {
            const wordAtPosition = model.getWordAtPosition(position);
            if (!wordAtPosition) {
                return null;
            }

            const hover = getHoverContent(wordAtPosition.word);
            if (!hover) {
                return null;
            }

            // Set the range for the hover highlight
            return {
                ...hover,
                range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: wordAtPosition.startColumn,
                    endColumn: wordAtPosition.endColumn,
                },
            };
        },
    });
}

/**
 * Resets the registration state. For testing only.
 * @internal
 */
export function _resetRegistration(): void {
    registrationPromise = undefined;
}
