/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentd./playground/PlaygroundService';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Sets the active query playground connection from a tree node context,
 * or shows instructions when invoked without a tree context (e.g., CodeLens click).
 */
export async function connectDatabase(_context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    if (node) {
        const service = PlaygroundService.getInstance();
        service.setConnection({
            clusterId: node.cluster.clusterId,
            clusterDisplayName: node.cluster.name,
            databaseName: node.databaseInfo.name,
        });

        void vscode.window.showInformationMessage(
            l10n.t('Query Playground connected to {0}/{1}', node.cluster.name, node.databaseInfo.name),
        );
    } else {
        // No tree context — show instructions as modal dialog
        void vscode.window.showInformationMessage(l10n.t('No database connected'), {
            modal: true,
            detail: l10n.t(
                'Right-click a database or collection in the DocumentDB panel and select "Connect query playground to this database".',
            ),
        });
    }
}
