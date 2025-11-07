/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function dropIndex(context: IActionContext, node: IndexItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No index selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.indexName = node.indexInfo.name;

    // Prevent deleting the _id index
    if (node.indexInfo.name === '_id_') {
        throw new Error(l10n.t('The _id index cannot be deleted.'));
    }

    const message = l10n.t('Delete index "{indexName}" from collection "{collectionName}"?', {
        indexName: node.indexInfo.name,
        collectionName: node.collectionInfo.name,
    });
    const successMessage = l10n.t('Index "{indexName}" has been deleted.', { indexName: node.indexInfo.name });

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete index "{indexName}"?', { indexName: node.indexInfo.name }),
        message + '\n' + l10n.t('This cannot be undone.'),
        node.indexInfo.name,
    );

    if (!confirmed) {
        return;
    }

    try {
        const client = await ClustersClient.getClient(node.cluster.id);

        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            const result = await client.dropIndex(node.databaseInfo.name, node.collectionInfo.name, node.indexInfo.name);
            success = result.ok === 1;
        });

        if (success) {
            showConfirmationAsInSettings(successMessage);
        }
    } finally {
        // Refresh parent (collection's indexes folder)
        const lastSlashIndex = node.id.lastIndexOf('/');
        let parentId = node.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}
