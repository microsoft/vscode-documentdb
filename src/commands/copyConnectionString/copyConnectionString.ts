/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';

export async function copyAzureConnectionString(context: IActionContext, node?: ClusterItemBase) {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await copyConnectionString(context, node);
}

export async function copyConnectionString(context: IActionContext, node: ClusterItemBase): Promise<void> {
    const connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;

        return node.getConnectionString();
    });

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to extract the connection string from the selected account.'),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
    }
}
