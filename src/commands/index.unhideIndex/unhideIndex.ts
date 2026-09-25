/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { confirmIndexAction } from '../../utils/dialogs/confirmIndexAction';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { getIndexConfirmationStats } from '../index.shared/getIndexConfirmationStats';

export async function unhideIndex(context: IActionContext, node: IndexItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No index selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.indexName = node.indexInfo.name;

    // Check if index is actually hidden
    if (!node.indexInfo.hidden) {
        throw new Error(l10n.t('Index "{indexName}" is not hidden.', { indexName: node.indexInfo.name }));
    }

    const indexName = node.indexInfo.name;
    const collectionName = node.collectionInfo.name;

    const { sizeBytes, usageOps } = await getIndexConfirmationStats(node);
    const confirmed = await confirmIndexAction('unhide', {
        indexName,
        collectionName,
        sizeBytes,
        usageOps,
    });

    if (!confirmed) {
        return;
    }

    try {
        const client = await ClustersClient.getClient(node.cluster.clusterId);

        let success = false;
        await ext.state.runWithTemporaryDescription(node.id, l10n.t('Unhiding…'), async () => {
            const result = await client.unhideIndex(
                node.databaseInfo.name,
                node.collectionInfo.name,
                node.indexInfo.name,
            );

            // Check for errors in the response
            if (result.ok === 0 || result.errmsg) {
                const errorMessage =
                    typeof result.errmsg === 'string' ? result.errmsg : l10n.t('Failed to unhide index.');
                throw new Error(errorMessage);
            }

            success = result.ok === 1;
        });

        if (success) {
            showConfirmationAsInSettings(l10n.t('Index "{indexName}" has been unhidden.', { indexName }));
        }
    } catch (error) {
        // Failed user action -> modal (matches the webview matrix); suppress
        // azext's default non-modal error and rethrow for telemetry.
        const detail = error instanceof Error ? error.message : String(error);
        context.errorHandling.suppressDisplay = true;
        void vscode.window.showErrorMessage(l10n.t('Failed to unhide index "{indexName}".', { indexName }), {
            modal: true,
            detail,
        });
        throw error;
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
