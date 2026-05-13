/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Escapes markdown metacharacters so user data renders as literal text.
 *
 * Covers characters that Markdown/HTML would otherwise interpret:
 * `\`, `*`, `_`, `{`, `}`, `[`, `]`, `(`, `)`, `#`, `+`, `-`, `.`, `!`,
 * `|`, `<`, `>`, `` ` ``, `~`, `&`
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\*_{}[\]()#+\-.!|<>`~&]/g, '\\$&');
}
