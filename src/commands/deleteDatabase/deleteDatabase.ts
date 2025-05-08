/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function deleteAzureDatabase(context: IActionContext, node?: DatabaseItem): Promise<void> {
    if (!node) {
        return undefined;
    }

    return deleteDatabase(context, node);
}

export async function deleteDatabase(context: IActionContext, node: DatabaseItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    const databaseId = node.databaseInfo.name;
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Delete "{nodeName}"?', { nodeName: databaseId }),
        l10n.t('Delete database "{databaseId}" and its contents?', { databaseId }) +
            '\n' +
            l10n.t('This cannot be undone.'),
        databaseId,
    );

    if (!confirmed) {
        return;
    }

    try {
        const success = await deleteMongoDatabase(node);

        if (success) {
            showConfirmationAsInSettings(l10n.t('The "{databaseId}" database has been deleted.', { databaseId }));
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

async function deleteMongoDatabase(node: DatabaseItem): Promise<boolean> {
    const client = await ClustersClient.getClient(node.cluster.id);

    let success = false;
    await ext.state.showDeleting(node.id, async () => {
        success = await client.dropDatabase(node.databaseInfo.name);
    });

    return success;
}
