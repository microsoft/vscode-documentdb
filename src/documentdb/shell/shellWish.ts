/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ShellWish =
    | { readonly kind: 'wish'; readonly text: string }
    | { readonly kind: 'lucky' }
    | { readonly kind: 'usage' };

/**
 * Reads `wish <words>` typed at the shell prompt. Anything that is valid JavaScript about a
 * variable named `wish` (`wish = 1`, `wish(...)`, `wish.x`, `wish[0]`, `wish;`) stays JavaScript.
 */
export function parseShellWish(line: string): ShellWish | undefined {
    const match = /^wish(?:\s+([\s\S]*))?$/.exec(line.trim());
    if (!match) {
        return undefined;
    }
    const text = (match[1] ?? '').trim();
    if (text.length === 0) {
        return line.trim() === 'wish' ? { kind: 'usage' } : undefined;
    }
    if (/^(=(?!=)|[=!]==?|[.([;,?:+\-*/%&|^<>]|instanceof\b|in\b)/.test(text)) {
        return undefined;
    }
    if (/^(me\s+luck|lucky|i'?m\s+feeling\s+lucky)[.!]*$/i.test(text)) {
        return { kind: 'lucky' };
    }
    return { kind: 'wish', text: text.replace(/^["'`](.*)["'`]$/s, '$1') };
}
