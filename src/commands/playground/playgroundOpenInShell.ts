/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { detectBlocks, resolveBlockAtLine } from '../../documentdb/playground/statementDetector';
import { ShellCommandIds } from '../../documentdb/shell/constants';
import { parsePlaygroundInvocation, resolvePlaygroundEditor } from './playgroundInvocation';

/**
 * Opens the current playground code block in an Interactive Shell.
 *
 * Gets the code block text, then opens a new shell with that text
 * pre-filled in the input line (not executed).
 *
 * Arguments: [uri: vscode.Uri, startLine: number, endLine: number]
 */
export async function playgroundOpenQueryInShell(context: IActionContext, ...args: unknown[]): Promise<void> {
    const invocation = parsePlaygroundInvocation(args);
    context.telemetry.properties.activationSource = invocation.activationSource;

    const editor = resolvePlaygroundEditor(invocation.uri);
    if (!editor) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }

    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(editor.document.uri);

    if (!connection) {
        void vscode.window.showWarningMessage(l10n.t('This playground has no connection.'));
        return;
    }

    const range =
        invocation.range ?? resolveBlockAtLine(detectBlocks(editor.document), editor.selection.active.line)?.block;
    if (!range) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }
    const blockText = editor.document.getText(new vscode.Range(range.startLine, 0, range.endLine + 1, 0)).trim();

    if (!blockText) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }

    await vscode.commands.executeCommand(ShellCommandIds.openWithInput, {
        clusterId: connection.clusterId,
        clusterDisplayName: connection.clusterDisplayName,
        databaseName: connection.databaseName,
        initialInput: blockText,
    });
}
