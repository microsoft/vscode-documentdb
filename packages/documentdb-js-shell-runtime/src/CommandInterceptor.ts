/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HelpProvider } from './HelpProvider';
import { type ShellEvaluationResult } from './types';

/**
 * Pre-eval command routing for shell input.
 *
 * Intercepts commands that should be handled without going through the
 * @mongosh evaluation pipeline. Handles:
 * - `help` / `help()` → show help text
 * - `exit` / `quit` → signal shell exit
 * - `cls` / `clear` → signal screen clear
 */
export class CommandInterceptor {
    private readonly _helpProvider: HelpProvider;

    /**
     * Matches standalone `help` invocations:
     * - `help` (bare keyword)
     * - `help()` (function call, no arguments)
     * - `` help`...` `` (tagged template literal — any content between backticks)
     *
     * Does NOT match when `help` is part of a larger expression
     * (e.g. `helper()`, `var help = 1`, `help("topic")`).
     */
    private static readonly HELP_PATTERN = /^help(?:\(\)|\s*`[^]*`)?$/;

    /**
     * Matches standalone `exit` or `quit` keywords, with optional parens and trailing semicolon.
     * - `exit`, `quit` (bare keywords)
     * - `exit()`, `quit()` (function call form — common in mongosh)
     * - `exit;`, `quit;`, `exit();`, `quit();` (with semicolon)
     * - `  exit  `, `  quit  ` (with whitespace — trimmed before matching)
     *
     * Does NOT match:
     * - `exit(0)`, `quit(0)` (function calls with arguments)
     * - `exitFunction()`, `var exit = 1` (substrings)
     * - `db.exit` (property access)
     */
    private static readonly EXIT_PATTERN = /^(?:exit|quit)(?:\(\))?;?$/;

    /**
     * Matches standalone `cls` or `clear` keywords, with optional trailing semicolon.
     * - `cls`, `clear` (bare keywords)
     * - `cls;`, `clear;` (with semicolon)
     *
     * Does NOT match:
     * - `clear()`, `cls()` (function calls)
     * - `clearInterval()`, `clearTimeout()` (substrings)
     */
    private static readonly CLEAR_PATTERN = /^(?:cls|clear);?$/;

    constructor(helpProvider?: HelpProvider) {
        this._helpProvider = helpProvider ?? new HelpProvider();
    }

    /**
     * Check if the input is a command that should be intercepted.
     * Returns a result if intercepted, undefined if the input should
     * proceed through normal evaluation.
     */
    tryIntercept(input: string): ShellEvaluationResult | undefined {
        const trimmed = input.trim();

        // Help command (bare, function call, or tagged template literal)
        if (CommandInterceptor.HELP_PATTERN.test(trimmed)) {
            return this._helpProvider.getHelpResult();
        }

        // Exit / quit — signal shell close
        if (CommandInterceptor.EXIT_PATTERN.test(trimmed)) {
            return {
                type: 'exit',
                printable: '',
                durationMs: 0,
            };
        }

        // Clear / cls — signal screen clear
        if (CommandInterceptor.CLEAR_PATTERN.test(trimmed)) {
            return {
                type: 'clear',
                printable: '',
                durationMs: 0,
            };
        }

        return undefined;
    }
}
