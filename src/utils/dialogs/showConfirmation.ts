/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { settingsKeys } from '../../settingsKeys';

export function showConfirmationAsInSettings(message: string) {
    const showSummary: boolean = vscode.workspace
        .getConfiguration()
        .get<boolean>(settingsKeys.showOperationSummaries, true);

    if (showSummary) {
        vscode.window.showInformationMessage(message);
    }
}
