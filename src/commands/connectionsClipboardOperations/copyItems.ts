/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';

/**
 * Copy selected items to clipboard for later paste operation
 */
export async function copyItems(context: IActionContext, ...selectedItems: TreeElement[]): Promise<void> {
    context.telemetry.properties.operation = 'copy';

    if (!selectedItems || selectedItems.length === 0) {
        void vscode.window.showWarningMessage(l10n.t('No items selected to copy.'));
        return;
    }

    // Store items in clipboard
    ext.clipboardState = {
        items: selectedItems,
        operation: 'copy',
    };

    context.telemetry.measurements.itemCount = selectedItems.length;

    // Set context key to enable paste command
    await vscode.commands.executeCommand('setContext', 'documentdb.clipboardHasItems', true);

    void vscode.window.showInformationMessage(
        l10n.t('Copied {count} item(s) to clipboard.', { count: selectedItems.length }),
    );
}
