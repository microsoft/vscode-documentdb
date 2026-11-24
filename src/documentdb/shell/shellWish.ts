/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isExpressionIncomplete } from './bracketDepthCounter';

export type ShellWish =
    | { readonly kind: 'wish'; readonly text: string }
    | { readonly kind: 'lucky' }
    | { readonly kind: 'open' }
    | { readonly kind: 'usage' };

/**
 * Reads `wish <words>` typed at the shell prompt; `wish open` grants the card the last wish printed.
 * Anything that is valid JavaScript about a variable named `wish` (`wish = 1`, `wish(...)`, `wish.x`,
 * `wish[0]`, `wish;`) stays JavaScript.
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
    // Only the bare word: "wish open the dashboard" is still a wish.
    if (/^open[.!]*$/i.test(text)) {
        return { kind: 'open' };
    }
    if (/^(me\s+luck|lucky|i'?m\s+feeling\s+lucky)[.!]*$/i.test(text)) {
        return { kind: 'lucky' };
    }
    return { kind: 'wish', text: text.replace(/^["'`](.*)["'`]$/s, '$1') };
}

/**
 * The non-empty lines of a command a wish wrote, to join onto one prompt line. Undefined when joining
 * would change it: a `//` comment would swallow the lines after it, or a line starts a new statement
 * ("use shop" then "db.orders.find()") instead of continuing a chained call or an open bracket.
 */
export function wishedCommandLines(command: string): string[] | undefined {
    const lines = command
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.slice(0, -1).some((line) => line.includes('//'))) {
        return undefined;
    }
    const continues = lines.every(
        (line, index) =>
            index === 0 || line.startsWith('.') || isExpressionIncomplete(lines.slice(0, index).join('\n')),
    );
    return continues ? lines : undefined;
}

/** C0 and C1 controls a terminal acts on, so the prompt could show one command while another runs. */
export function withoutControlCharacters(command: string): string {
    // eslint-disable-next-line no-control-regex
    return command.replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}
