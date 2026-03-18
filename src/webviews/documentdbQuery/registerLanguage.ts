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
import { getCompletionContext } from './completionStore';
import { detectCursorContext } from './cursorContext';
import { createCompletionItems } from './documentdbQueryCompletionProvider';
import { getHoverContent } from './documentdbQueryHoverProvider';
import { isCursorInsideString } from './isCursorInsideString';
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
        triggerCharacters: ['$', '"', "'", '{', '.', ':', ',', '['],
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

            // Detect cursor context for context-sensitive completions
            const text = model.getValue();
            const cursorOffset = model.getOffsetAt(position);

            // Suppress completions when the cursor is inside a string literal.
            // This prevents trigger characters like ':', ',', '[' from firing
            // inside strings like { name: "has:colon" } or { msg: "has[bracket" }.
            if (isCursorInsideString(text, cursorOffset)) {
                return { suggestions: [] };
            }

            const sessionId = parsed?.sessionId;

            // Build field lookup from completion store to enrich context with BSON types
            const fieldLookup = (fieldName: string): string | undefined => {
                if (!sessionId) return undefined;
                const ctx = getCompletionContext(sessionId);
                return ctx?.fields.find((f) => f.fieldName === fieldName)?.bsonType;
            };

            const cursorContext = detectCursorContext(text, cursorOffset, fieldLookup);

            // Detect whether the editor content has braces. When the user clears
            // the editor (deleting initial `{  }`), completions need to include
            // wrapping braces so inserted snippets produce valid query syntax.
            const needsWrapping = !text.includes('{');

            // Build completion items based on context
            const items = createCompletionItems({
                editorType: parsed?.editorType,
                sessionId,
                range,
                isDollarPrefix: charBefore === '$',
                monaco,
                cursorContext,
                needsWrapping,
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
            // Build field lookup from completion store for field hover info
            const uriString = model.uri.toString();
            const parsedUri = parseEditorUri(uriString);
            const hoverFieldLookup = parsedUri?.sessionId
                ? (word: string) => {
                      const ctx = getCompletionContext(parsedUri.sessionId);
                      return ctx?.fields.find((f) => f.fieldName === word);
                  }
                : undefined;

            // Try to extract a quoted string key (e.g., "address.street")
            // Monaco's getWordAtPosition treats quotes and dots as word boundaries,
            // so for { "address.street": 1 } hovering on "address" would only match
            // "address", not the full field name "address.street".
            const lineContent = model.getLineContent(position.lineNumber);
            const col0 = position.column - 1; // 0-based

            const quotedResult = extractQuotedKey(lineContent, col0);
            if (quotedResult) {
                const hover = getHoverContent(quotedResult.key, hoverFieldLookup);
                if (hover) {
                    return {
                        ...hover,
                        range: {
                            startLineNumber: position.lineNumber,
                            endLineNumber: position.lineNumber,
                            startColumn: quotedResult.start + 1, // 1-based
                            endColumn: quotedResult.end + 1, // 1-based
                        },
                    };
                }
            }

            // Fall back to standard word-based hover
            const wordAtPosition = model.getWordAtPosition(position);
            if (!wordAtPosition) {
                return null;
            }

            const hover = getHoverContent(wordAtPosition.word, hoverFieldLookup);
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

/**
 * Extracts a quoted key string if the cursor is inside one.
 *
 * For `{ "address.street": 1 }`, when the cursor is anywhere between the
 * opening and closing quotes, returns the unquoted key `"address.street"`
 * along with the 0-based start/end positions of the full quoted string
 * (including the quotes themselves, for hover range highlighting).
 *
 * Returns null if the cursor is not inside a quoted string.
 *
 * @param line - the full line content
 * @param col0 - 0-based column position of the cursor
 */
export function extractQuotedKey(line: string, col0: number): { key: string; start: number; end: number } | null {
    if (col0 < 0 || col0 >= line.length) return null;

    // If cursor is on a quote, it could be the closing quote.
    // Try treating the current position as the closing quote first.
    const chAtCursor = line[col0];
    if (chAtCursor === '"' || chAtCursor === "'") {
        // Not escaped?
        if (col0 === 0 || line[col0 - 1] !== '\\') {
            // Try to find a matching opening quote before this one
            const result = tryMatchAsClosingQuote(line, col0, chAtCursor);
            if (result) return result;
        }
    }

    // Scan backward to find the opening quote
    let openQuoteIdx = -1;
    let quoteChar: string | undefined;

    for (let i = col0; i >= 0; i--) {
        const ch = line[i];
        if (ch === '"' || ch === "'") {
            if (i > 0 && line[i - 1] === '\\') continue;
            openQuoteIdx = i;
            quoteChar = ch;
            break;
        }
        if (ch === '{' || ch === '}' || ch === ':' || ch === ',') {
            return null;
        }
    }

    if (openQuoteIdx < 0 || !quoteChar) return null;

    // Scan forward to find the closing quote
    let closeQuoteIdx = -1;
    for (let i = openQuoteIdx + 1; i < line.length; i++) {
        if (line[i] === '\\') {
            i++;
            continue;
        }
        if (line[i] === quoteChar) {
            closeQuoteIdx = i;
            break;
        }
    }

    if (closeQuoteIdx < 0) return null;
    if (col0 < openQuoteIdx || col0 > closeQuoteIdx) return null;

    const key = line.substring(openQuoteIdx + 1, closeQuoteIdx);
    return { key, start: openQuoteIdx, end: closeQuoteIdx + 1 };
}

function tryMatchAsClosingQuote(
    line: string,
    closeIdx: number,
    quoteChar: string,
): { key: string; start: number; end: number } | null {
    // Scan backward from before the closing quote to find the opening quote
    for (let i = closeIdx - 1; i >= 0; i--) {
        if (line[i] === '\\') continue;
        if (line[i] === quoteChar) {
            if (i > 0 && line[i - 1] === '\\') continue;
            const key = line.substring(i + 1, closeIdx);
            return { key, start: i, end: closeIdx + 1 };
        }
        // Stop at structural chars
        if (line[i] === '{' || line[i] === '}' || line[i] === ':' || line[i] === ',') {
            return null;
        }
    }
    return null;
}
