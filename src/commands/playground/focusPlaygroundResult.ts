/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { ext } from '../../extensionVariables';

export async function focusPlaygroundResult(_context: IActionContext): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const sourceUri =
        document?.languageId === PLAYGROUND_LANGUAGE_ID
            ? document.uri
            : document && ext.playgroundResultProvider.getSourceUri(document.uri);
    if (!sourceUri || !(await ext.playgroundResultProvider.focusResult(sourceUri))) {
        await vscode.window.showInformationMessage(l10n.t('No Query Playground result is open.'));
    }
}

export async function focusPlayground(_context: IActionContext): Promise<void> {
    const resultUri = vscode.window.activeTextEditor?.document.uri;
    const sourceUri = resultUri && ext.playgroundResultProvider.getSourceUri(resultUri);
    if (!sourceUri) {
        await vscode.window.showInformationMessage(l10n.t('No Query Playground is available to focus.'));
        return;
    }
    const editor = vscode.window.visibleTextEditors.find(
        (candidate) => candidate.document.uri.toString() === sourceUri.toString(),
    );
    let document =
        editor?.document ??
        vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === sourceUri.toString());
    if (!document && sourceUri.scheme === 'untitled') {
        await vscode.window.showInformationMessage(l10n.t('No Query Playground is available to focus.'));
        return;
    }
    if (!document) {
        try {
            document = await vscode.workspace.openTextDocument(sourceUri);
        } catch {
            await vscode.window.showInformationMessage(l10n.t('No Query Playground is available to focus.'));
            return;
        }
    }
    await vscode.window.showTextDocument(document, {
        viewColumn: editor?.viewColumn ?? vscode.ViewColumn.Active,
        preserveFocus: false,
    });
}
