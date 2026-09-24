/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Theme-resolved ANSI controls shared by Interactive Shell renderers. */
export const shellAnsi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    defaultForeground: '\x1b[39m',
    underline: '\x1b[4m',
    noUnderline: '\x1b[24m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
} as const;

/** Semantic visual roles used across Interactive Shell input, output, and chrome. */
export const shellStyles = {
    error: shellAnsi.red,
    muted: shellAnsi.gray,
    emphasis: shellAnsi.bold,
    value: `${shellAnsi.bold}${shellAnsi.defaultForeground}`,
    ghostText: shellAnsi.dim,
    spinner: shellAnsi.blue,
    syntax: {
        keyword: shellAnsi.cyan,
        string: shellAnsi.green,
        escape: shellAnsi.yellow,
        invalid: shellAnsi.red,
        number: shellAnsi.yellow,
        comment: shellAnsi.gray,
        regexp: shellAnsi.red,
        constructor: shellAnsi.cyan,
        operator: shellAnsi.yellow,
        command: shellAnsi.magenta,
    },
    result: {
        key: shellAnsi.cyan,
        string: shellAnsi.green,
        number: shellAnsi.yellow,
        boolean: shellAnsi.magenta,
    },
    completion: {
        collection: shellAnsi.cyan,
        action: shellAnsi.yellow,
        field: shellAnsi.green,
        operator: shellAnsi.magenta,
        other: shellAnsi.gray,
    },
} as const;
