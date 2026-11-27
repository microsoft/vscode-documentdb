/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { resolveAfterRunOutcome } from '../../documentdb/playground/afterRun';
import { settingsKeys } from '../../settingsKeys';
import { executePlaygroundCode } from './executePlaygroundCode';
import { parsePlaygroundInvocation, resolvePlaygroundEditor } from './playgroundInvocation';

/**
 * Runs the entire content of the active query playground file.
 */
export async function runAll(context: IActionContext, ...args: unknown[]): Promise<void> {
    const invocation = parsePlaygroundInvocation(args);
    context.telemetry.properties.activationSource = invocation.activationSource;
    const afterRun = resolveAfterRunOutcome(
        vscode.workspace.getConfiguration().get<unknown>(settingsKeys.playgroundAfterRun),
        invocation.screenReaderMode,
    );
    context.telemetry.properties.afterRun = afterRun;
    context.telemetry.properties.screenReaderMode = invocation.screenReaderMode ? 'true' : 'false';

    const editor = resolvePlaygroundEditor(invocation.uri);
    if (!editor) {
        return;
    }

    const code = editor.document.getText();
    if (!code.trim()) {
        void vscode.window.showInformationMessage(l10n.t('The playground file is empty. Add some code to run.'));
        return;
    }

    const confirmRunAll = vscode.workspace.getConfiguration().get<boolean>(settingsKeys.playgroundConfirmRunAll, true);

    if (confirmRunAll) {
        const confirmed = await vscode.window.showWarningMessage(
            l10n.t('Are you sure you want to run all code?'),
            {
                modal: true,
                detail:
                    l10n.t('This will execute all statements in the file against the connected cluster.') +
                    '\n\n' +
                    l10n.t(
                        'You can disable this confirmation by setting "{0}" to false.',
                        settingsKeys.playgroundConfirmRunAll,
                    ),
            },
            l10n.t('Run All'),
        );

        if (!confirmed) {
            context.telemetry.properties.runAllDialogConfirmed = 'false';
            return;
        }
        context.telemetry.properties.runAllDialogConfirmed = 'true';
    } else {
        context.telemetry.properties.runAllDialogConfirmed = 'skipped';
    }

    await executePlaygroundCode(code, 'runAll', editor.document.uri, { afterRun });
}
