/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Convenience function that combines the tokenizer and colorizer
 * into a single call for use by the shell PTY.
 */

import { shellLanguageRules } from './monarchRules';
import { tokenize } from './monarchRunner';
import { colorizeInput } from './tokenColorizer';

/**
 * Tokenize and colorize a shell input string in one step.
 *
 * @param input - The raw input string from the shell line buffer.
 * @returns The input with ANSI color codes for syntax highlighting.
 */
export function colorizeShellInput(input: string): string {
    const tokens = tokenize(input, shellLanguageRules);
    return colorizeInput(input, tokens);
}
