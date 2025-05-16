/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function deleteCollection(context: IActionContext, node: CollectionItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;

    const message = l10n.t('Delete collection "{collectionId}" and its contents?', {
        collectionId: node.collectionInfo.name,
    });
    const successMessage = l10n.t('The collection "{collectionId}" has been deleted.', {
        collectionId: node.collectionInfo.name,
    });

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: node.collectionInfo.name }),
        message + '\n' + l10n.t('This cannot be undone.'),
        node.collectionInfo.name,
    );

    if (!confirmed) {
        return;
    }

    try {
        const client = await ClustersClient.getClient(node.cluster.id);

        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            success = await client.dropCollection(node.databaseInfo.name, node.collectionInfo.name);
        });

        if (success) {
            showConfirmationAsInSettings(successMessage);
        }
    } finally {
        const lastSlashIndex = node.id.lastIndexOf('/');
        let parentId = node.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}
