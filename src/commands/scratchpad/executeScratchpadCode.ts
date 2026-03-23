/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScratchpadEvaluator } from '../../documentdb/scratchpad/ScratchpadEvaluator';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { formatError, formatResult } from '../../documentdb/scratchpad/resultFormatter';

/** Shared evaluator instance — lazily created, reused across runs. */
let evaluator: ScratchpadEvaluator | undefined;

/**
 * Executes scratchpad code and displays the result in a read-only side panel.
 * Used by both `runAll` and `runSelected` commands.
 */
export async function executeScratchpadCode(code: string): Promise<void> {
    const service = ScratchpadService.getInstance();
    const connection = service.getConnection();
    if (!connection) {
        return;
    }

    if (!evaluator) {
        evaluator = new ScratchpadEvaluator();
    }

    service.setExecuting(true);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n.t('Running scratchpad query…'),
            cancellable: false,
        },
        async () => {
            try {
                const result = await evaluator!.evaluate(connection, code);
                const formattedOutput = formatResult(result, code);

                await openReadOnlyContent(
                    { label: l10n.t('Scratchpad Results'), fullId: `scratchpad-results-${Date.now()}` },
                    formattedOutput,
                    '.jsonc',
                    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
                );
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const formattedOutput = formatError(error, code, 0);

                await openReadOnlyContent(
                    { label: l10n.t('Scratchpad Error'), fullId: `scratchpad-error-${Date.now()}` },
                    formattedOutput,
                    '.jsonc',
                    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
                );

                void vscode.window.showErrorMessage(l10n.t('Scratchpad execution failed: {0}', errorMessage));
            } finally {
                service.setExecuting(false);
            }
        },
    );
}
