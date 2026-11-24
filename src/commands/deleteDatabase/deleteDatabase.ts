/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient, type ConnectionBinding } from '../../documentdb/ClustersClient';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ext } from '../../extensionVariables';
import { checkCanProceedAndInformUser } from '../../services/taskService/resourceUsageHelper';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { rethrowBoundCommandUnavailable } from '../rethrowBoundCommandUnavailable';
import { runBoundNamespaceCommand } from '../runBoundNamespaceCommand';

interface DeleteDatabaseCommandOptions {
    readonly binding?: ConnectionBinding;
}

export async function deleteAzureDatabase(
    context: IActionContext,
    node: DatabaseItem,
    _nodes?: DatabaseItem[],
    options?: DeleteDatabaseCommandOptions,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    return deleteDatabase(context, node, options);
}

export async function deleteDatabase(
    context: IActionContext,
    node: DatabaseItem,
    options?: DeleteDatabaseCommandOptions,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;
    const confirmationEpoch = options?.binding ? ClustersClient.getEpoch(node.cluster.clusterId) : undefined;

    // Check if any running tasks are using this database
    const canProceed = await checkCanProceedAndInformUser(
        {
            clusterId: node.cluster.clusterId,
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
        { fallbackWord: 'delete' },
    );

    if (!confirmed) {
        return;
    }

    try {
        const { clusterId } = node.cluster;
        const drop = (client: ClustersClient): Promise<boolean> => client.dropDatabase(databaseId);
        const binding = options?.binding;
        const runDrop = binding
            ? (): Promise<boolean> => runBoundNamespaceCommand(clusterId, binding, drop, confirmationEpoch)
            : drop.bind(undefined, await ClustersClient.getClient(clusterId));

        let success = false;
        await ext.state.showDeleting(node.id, async () => {
            success = await runDrop();
        });

        if (success) {
            SchemaStore.getInstance().clearDatabase(node.cluster.clusterId, node.databaseInfo.name);
            showConfirmationAsInSettings(l10n.t('The "{databaseId}" database has been deleted.', { databaseId }));
        }
    } catch (error) {
        if (options?.binding) {
            rethrowBoundCommandUnavailable(context, error);
        }
        throw error;
    } finally {
        const lastSlashIndex = node.id.lastIndexOf('/');
        let parentId = node.id;
        if (lastSlashIndex !== -1) {
            parentId = parentId.substring(0, lastSlashIndex);
        }
        ext.state.notifyChildrenChanged(parentId);
    }
}
