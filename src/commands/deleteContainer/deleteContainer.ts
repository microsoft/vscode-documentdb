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

export async function deleteContainer(context: IActionContext, node: CollectionItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const containerId = node.collectionInfo.name;
    const message = l10n.t('Delete collection "{containerId}" and its contents?', { containerId });
    const successMessage = l10n.t('The collection "{containerId}" has been deleted.', { containerId });

    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: containerId }),
        message + '\n' + l10n.t('This cannot be undone.'),
        containerId,
    );

    if (!confirmed) {
        return;
    }

    try {
        const success = await deleteMongoCollection(node);

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

async function deleteMongoCollection(node: CollectionItem): Promise<boolean> {
    const client = await ClustersClient.getClient(node.cluster.id);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        success = await client.dropCollection(node.databaseInfo.name, node.collectionInfo.name);
    });

    return success;
}
