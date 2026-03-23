/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Sets the active scratchpad connection from a tree node context,
 * or shows instructions when invoked without a tree context (e.g., CodeLens click).
 */
export async function connectDatabase(_context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    if (node) {
        const service = ScratchpadService.getInstance();
        service.setConnection({
            clusterId: node.cluster.clusterId,
            clusterDisplayName: node.cluster.name,
            databaseName: node.databaseInfo.name,
        });

        void vscode.window.showInformationMessage(
            l10n.t('DocumentDB Scratchpad connected to {0}/{1}', node.cluster.name, node.databaseInfo.name),
        );
    } else {
        // No tree context — show instructions (per plan §2.3)
        void vscode.window.showInformationMessage(
            l10n.t(
                'To connect, right-click a database or collection in the DocumentDB panel and select "Connect Scratchpad to this database".',
            ),
        );
    }
}
