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

    constructor(helpProvider?: HelpProvider) {
        this._helpProvider = helpProvider ?? new HelpProvider();
    }

    /**
     * Check if the input is a command that should be intercepted.
     * Returns a result if intercepted, undefined if the input should
     * proceed through normal @mongosh evaluation.
     */
    tryIntercept(input: string): ShellEvaluationResult | undefined {
        const trimmed = input.trim();

        // Help command
        if (trimmed === 'help' || trimmed === 'help()') {
            return this._helpProvider.getHelpResult();
        }

        return undefined;
    }
}
