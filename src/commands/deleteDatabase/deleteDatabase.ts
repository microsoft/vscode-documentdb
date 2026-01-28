/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { checkCanProceedAndInformUser } from '../../services/taskService/resourceUsageHelper';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function deleteAzureDatabase(context: IActionContext, node: DatabaseItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    return deleteDatabase(context, node);
}

export async function deleteDatabase(context: IActionContext, node: DatabaseItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    // Check if any running tasks are using this database
    const canProceed = await checkCanProceedAndInformUser(
        {
            connectionId: node.cluster.clusterId,
            databaseName: node.databaseInfo.name,
        },
        l10n.t('delete this database'),
    );

    if (!canProceed) {
        return;
    }

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
        const client = await ClustersClient.getClient(node.cluster.clusterId);

        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            success = await client.dropDatabase(node.databaseInfo.name);
        });

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
