/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Escapes markdown metacharacters so user data renders as literal text.
 *
 * Covers characters that Markdown/HTML would otherwise interpret:
 * `\`, `*`, `_`, `{`, `}`, `[`, `]`, `(`, `)`, `#`, `+`, `-`, `.`, `!`,
 * `|`, `<`, `>`, `` ` ``, `~`, `&`, `:`
 *
 * Escaping `:` prevents GFM from autolinking bare `scheme://` URLs.
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\*_{}[\]()#+\-.!|<>`~&:]/g, '\\$&');
}

/**
 * Renders user data as a Markdown inline code span that cannot be broken out of.
 *
 * The delimiter is longer than any backtick run in the value, with CommonMark boundary
 * padding where needed. Values containing line breaks are shown as JSON strings so a
 * blank line cannot split the span.
 */
export function formatInlineCode(value: string): string {
    const text = /[\r\n]/.test(value) ? JSON.stringify(value) : value;
    const runs: string[] = text.match(/`+/g) ?? [];
    const longestRun = runs.reduce((length, run) => Math.max(length, run.length), 0);
    const delimiter = '`'.repeat(longestRun + 1);
    const needsPadding = /^`|`$/.test(text) || (/^ | $/.test(text) && /[^ ]/.test(text));
    const padding = needsPadding ? ' ' : '';
    return `${delimiter}${padding}${text}${padding}${delimiter}`;
}
