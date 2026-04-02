/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Determines whether the cursor is inside a string literal.
 *
 * Scans the text from the beginning up to the cursor offset, tracking whether
 * we are inside a single-quoted or double-quoted string. Escaped quotes
 * (preceded by `\`) do not toggle the state.
 *
 * This is a lightweight heuristic for suppressing auto-trigger completions
 * when the trigger character (`:`, `,`, `[`) appears inside a string value
 * rather than as structural syntax.
 *
 * @param text - the full text of the editor
 * @param cursorOffset - the 0-based character offset of the cursor
 * @returns true if the cursor is inside a string literal
 */
export function isCursorInsideString(text: string, cursorOffset: number): boolean {
    let inString: "'" | '"' | false = false;

    for (let i = 0; i < cursorOffset && i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            // Check for escape character
            if (ch === '\\') {
                // Skip the next character (escaped)
                i++;
                continue;
            }
            // Check for closing quote
            if (ch === inString) {
                inString = false;
            }
        } else {
            // Check for opening quote
            if (ch === '"' || ch === "'") {
                inString = ch;
            }
        }
    }

    return inString !== false;
}
