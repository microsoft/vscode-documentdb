/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { getConfirmationWithClick } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function hideIndex(context: IActionContext, node: IndexItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No index selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.indexName = node.indexInfo.name;

    // Prevent hiding the _id index
    if (node.indexInfo.name === '_id_') {
        throw new Error(l10n.t('The "_id_" index cannot be hidden.'));
    }

    // Check if already hidden
    if (node.indexInfo.hidden) {
        throw new Error(l10n.t('Index "{indexName}" is already hidden.', { indexName: node.indexInfo.name }));
    }

    const indexName = node.indexInfo.name;
    const collectionName = node.collectionInfo.name;

    const confirmed = await getConfirmationWithClick(
        l10n.t('Hide index?'),
        l10n.t('Hide index "{indexName}" from collection "{collectionName}"?', { indexName, collectionName }) +
            '\n' +
            l10n.t('This will prevent the query planner from using this index.'),
    );

    if (!confirmed) {
        return;
    }

    try {
        const client = await ClustersClient.getClient(node.cluster.clusterId);

        let success = false;
        await ext.state.showCreatingChild(node.id, l10n.t('Hiding index…'), async () => {
            const result = await client.hideIndex(
                node.databaseInfo.name,
                node.collectionInfo.name,
                node.indexInfo.name,
            );

            // Check for errors in the response
            if (result.ok === 0 || result.errmsg) {
                const errorMessage =
                    typeof result.errmsg === 'string' ? result.errmsg : l10n.t('Failed to hide index.');
                throw new Error(errorMessage);
            }

            success = result.ok === 1;
        });

        if (success) {
            showConfirmationAsInSettings(l10n.t('Index "{indexName}" has been hidden.', { indexName }));
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
