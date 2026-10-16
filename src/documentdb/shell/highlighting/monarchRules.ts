/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-useless-escape -- Regex patterns vendored from Monaco Editor; preserved as-is */

/**
 * Vendored and extended Monarch tokenizer rules for the DocumentDB interactive shell.
 *
 * Based on the JavaScript variant of the Monaco Editor's Monarch tokenizer rules
 * (monaco-editor/esm/vs/basic-languages/typescript/typescript.ts and
 *  monaco-editor/esm/vs/basic-languages/javascript/javascript.ts).
 *
 * The Monaco Editor is MIT-licensed:
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *   https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt
 *
 * Extended with DocumentDB-specific token categories:
 *   - BSON constructors (ObjectId, ISODate, etc.)
 *   - Shell commands (show, use, it, exit, etc.)
 *   - $-prefixed query/aggregation operators ($gt, $match, etc.)
 */

// ─── Rule types ──────────────────────────────────────────────────────────────

/**
 * A single Monarch tokenizer rule. Each variant corresponds to a different
 * action the state machine can take when a regex matches.
 */
export type MonarchRule =
    | { regex: RegExp; action: string } // match → emit token
    | { regex: RegExp; action: string; next: string } // match → emit token + push/pop state
    | { regex: RegExp; actionCases: Record<string, string>; next?: string } // match → lookup cases + optional next
    | { regex: RegExp; actionByGroup: string[]; next?: string } // match → one token per group + optional next
    | { include: string }; // include another state's rules

/**
 * The complete set of tokenizer rules for the shell language.
 */
export interface MonarchLanguageRules {
    readonly keywords: readonly string[];
    readonly bsonConstructors: readonly string[];
    readonly shellCommands: readonly string[];
    readonly operators: readonly string[];
    readonly symbols: RegExp;
    readonly escapes: RegExp;
    readonly digits: RegExp;
    readonly octaldigits: RegExp;
    readonly binarydigits: RegExp;
    readonly hexdigits: RegExp;
    readonly regexpctl: RegExp;
    readonly regexpesc: RegExp;
    readonly tokenizer: Record<string, MonarchRule[]>;
}

// ─── JavaScript keywords (from Monaco's JS language definition) ──────────────

const keywords: readonly string[] = [
    'break',
    'case',
    'catch',
    'class',
    'continue',
    'const',
    'constructor',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'null',
    'return',
    'set',
    'static',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'async',
    'await',
    'of',
];

// ─── DocumentDB extensions ───────────────────────────────────────────────────

const bsonConstructors: readonly string[] = [
    'ObjectId',
    'ISODate',
    'NumberLong',
    'NumberInt',
    'NumberDecimal',
    'BinData',
    'UUID',
    'Timestamp',
    'MinKey',
    'MaxKey',
];

const shellCommands: readonly string[] = ['show', 'use', 'it', 'exit', 'quit', 'cls', 'clear', 'help'];

// ─── Operators (from Monaco's TypeScript language definition) ─────────────────

const operators: readonly string[] = [
    '<=',
    '>=',
    '==',
    '!=',
    '===',
    '!==',
    '=>',
    '+',
    '-',
    '**',
    '*',
    '/',
    '%',
    '++',
    '--',
    '<<',
    '</',
    '>>',
    '>>>',
    '&',
    '|',
    '^',
    '!',
    '~',
    '&&',
    '||',
    '??',
    '?',
    ':',
    '=',
    '+=',
    '-=',
    '*=',
    '**=',
    '/=',
    '%=',
    '<<=',
    '>>=',
    '>>>=',
    '&=',
    '|=',
    '^=',
    '@',
];

// ─── Named regex patterns ────────────────────────────────────────────────────

const symbols = /[=><!~?:&|+\-*\/\^%]+/;
const escapes = /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/;
const digits = /\d+(_+\d+)*/;
const octaldigits = /[0-7]+(_+[0-7]+)*/;
const binarydigits = /[0-1]+(_+[0-1]+)*/;
const hexdigits = /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/;
const regexpctl = /[(){}\[\]\$\^|\-*+?\.]/;
const regexpesc = /\\(?:[bBdDfnrstvwWn0\\\/]|[(){}\[\]\$\^|\-*+?\.]|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/;

// ─── Tokenizer state machine ─────────────────────────────────────────────────
//
// States: root, common, whitespace, comment, jsdoc, regexp, regexrange,
//         string_double, string_single, string_backtick, bracketCounting
//
// All @name references from the original Monaco source have been inlined directly
// in the regex patterns below. The executor does not need to resolve @name references.

const tokenizer: Record<string, MonarchRule[]> = {
    root: [{ regex: /[{}]/, action: 'delimiter.bracket' }, { include: 'common' }],

    common: [
        // $-prefixed DocumentDB API operators — must come before general identifiers
        { regex: /\$[a-zA-Z_]\w*/, action: 'documentdb.operator' },

        // Lowercase identifiers and keywords
        // NOTE: Key order matters — resolveCases checks keys in insertion order
        // and returns the first match. shellCommands must be checked before keywords.
        {
            regex: /#?[a-z_$][\w$]*/,
            actionCases: {
                '@shellCommands': 'shell.command',
                '@keywords': 'keyword',
                '@default': 'identifier',
            },
        },

        // PascalCase identifiers — check for BSON constructors first
        {
            regex: /[A-Z][\w$]*/,
            actionCases: {
                '@bsonConstructors': 'bson.constructor',
                '@default': 'type.identifier',
            },
        },

        // Whitespace and comments
        { include: 'whitespace' },

        // Regular expression literal — ensure it is terminated before beginning
        // (otherwise it is an operator)
        {
            regex: /\/(?=([^\\\/]|\\.)+\/([dgimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/,
            action: 'regexp',
            next: 'regexp',
        },

        // Delimiters and operators
        { regex: /[()\[\]]/, action: '@brackets' },
        { regex: /[<>](?![=><!~?:&|+\-*\/\^%]+)/, action: '@brackets' },
        { regex: /!(?=([^=]|$))/, action: 'delimiter' },
        {
            regex: symbols,
            actionCases: {
                '@operators': 'delimiter',
                '@default': '',
            },
        },

        // Numbers — order matters: float before int
        { regex: /(\d+(_+\d+)*)[eE]([\-+]?(\d+(_+\d+)*))?/, action: 'number.float' },
        { regex: /(\d+(_+\d+)*)\.(\d+(_+\d+)*)([eE][\-+]?(\d+(_+\d+)*))?/, action: 'number.float' },
        { regex: /0[xX]([0-9a-fA-F]+(_+[0-9a-fA-F]+)*)n?/, action: 'number.hex' },
        { regex: /0[oO]?([0-7]+(_+[0-7]+)*)n?/, action: 'number.octal' },
        { regex: /0[bB]([0-1]+(_+[0-1]+)*)n?/, action: 'number.binary' },
        { regex: /(\d+(_+\d+)*)n?/, action: 'number' },

        // Delimiter: after number because of .\d floats
        { regex: /[;,.]/, action: 'delimiter' },

        // Strings
        { regex: /"([^"\\]|\\.)*$/, action: 'string.invalid' }, // unterminated double-quoted
        { regex: /'([^'\\]|\\.)*$/, action: 'string.invalid' }, // unterminated single-quoted
        { regex: /"/, action: 'string', next: 'string_double' },
        { regex: /'/, action: 'string', next: 'string_single' },
        { regex: /`/, action: 'string', next: 'string_backtick' },
    ],

    whitespace: [
        { regex: /[ \t\r\n]+/, action: '' },
        { regex: /\/\*\*(?!\/)/, action: 'comment.doc', next: 'jsdoc' },
        { regex: /\/\*/, action: 'comment', next: 'comment' },
        { regex: /\/\/.*$/, action: 'comment' },
    ],

    comment: [
        { regex: /[^\/*]+/, action: 'comment' },
        { regex: /\*\//, action: 'comment', next: '@pop' },
        { regex: /[\/*]/, action: 'comment' },
    ],

    jsdoc: [
        { regex: /[^\/*]+/, action: 'comment.doc' },
        { regex: /\*\//, action: 'comment.doc', next: '@pop' },
        { regex: /[\/*]/, action: 'comment.doc' },
    ],

    regexp: [
        {
            regex: /(\{)(\d+(?:,\d*)?)(\})/,
            actionByGroup: ['regexp.escape.control', 'regexp.escape.control', 'regexp.escape.control'],
        },
        {
            regex: /(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/,
            actionByGroup: ['regexp.escape.control', 'regexp.escape.control'],
            next: 'regexrange',
        },
        {
            regex: /(\()(\?:|\?=|\?!)/,
            actionByGroup: ['regexp.escape.control', 'regexp.escape.control'],
        },
        { regex: /[()]/, action: 'regexp.escape.control' },
        { regex: regexpctl, action: 'regexp.escape.control' },
        { regex: /[^\\\/]/, action: 'regexp' },
        { regex: regexpesc, action: 'regexp.escape' },
        { regex: /\\\./, action: 'regexp.invalid' },
        {
            regex: /(\/)([dgimsuy]*)/,
            actionByGroup: ['regexp', 'keyword.other'],
            next: '@pop',
        },
    ],

    regexrange: [
        { regex: /-/, action: 'regexp.escape.control' },
        { regex: /\^/, action: 'regexp.invalid' },
        { regex: regexpesc, action: 'regexp.escape' },
        { regex: /[^\]]/, action: 'regexp' },
        { regex: /\]/, action: 'regexp.escape.control', next: '@pop' },
    ],

    string_double: [
        { regex: /[^\\"]+/, action: 'string' },
        { regex: escapes, action: 'string.escape' },
        { regex: /\\./, action: 'string.escape.invalid' },
        { regex: /"/, action: 'string', next: '@pop' },
    ],

    string_single: [
        { regex: /[^\\']+/, action: 'string' },
        { regex: escapes, action: 'string.escape' },
        { regex: /\\./, action: 'string.escape.invalid' },
        { regex: /'/, action: 'string', next: '@pop' },
    ],

    string_backtick: [
        { regex: /\$\{/, action: 'delimiter.bracket', next: 'bracketCounting' },
        { regex: /[^\\`$]+/, action: 'string' },
        { regex: escapes, action: 'string.escape' },
        { regex: /\\./, action: 'string.escape.invalid' },
        { regex: /`/, action: 'string', next: '@pop' },
    ],

    bracketCounting: [
        { regex: /\{/, action: 'delimiter.bracket', next: 'bracketCounting' },
        { regex: /\}/, action: 'delimiter.bracket', next: '@pop' },
        { include: 'common' },
    ],
};

// ─── Exported rules object ───────────────────────────────────────────────────

export const shellLanguageRules: MonarchLanguageRules = {
    keywords,
    bsonConstructors,
    shellCommands,
    operators,
    symbols,
    escapes,
    digits,
    octaldigits,
    binarydigits,
    hexdigits,
    regexpctl,
    regexpesc,
    tokenizer,
};
