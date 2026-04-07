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
 * @mongosh evaluation pipeline. Currently handles `help` / `help()`.
 *
 * Future extensions (Step 9 — Interactive Shell):
 * - `exit` / `quit` → signal shell exit
 * - `cls` / `clear` → signal screen clear
 * - `it` → cursor iteration (when persistent mode is added)
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

        return undefined;
    }
}
