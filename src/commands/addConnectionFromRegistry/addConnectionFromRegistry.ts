/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type DocumentDBResourceItem } from '../../plugins/service-azure/discovery-tree/documentdb/DocumentDBResourceItem';
import { StorageNames, StorageService, type StorageItem } from '../../services/storageService';
import { revealConnectionsViewElement } from '../../tree/api/revealConnectionsViewElement';
import {
    buildConnectionsViewTreePath,
    waitForConnectionsViewReady,
} from '../../tree/connections-view/connectionsViewHelpers';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';

export async function addConnectionFromRegistry(context: IActionContext, node: DocumentDBResourceItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;

        return node.getConnectionString();
    });

    if (!connectionString) {
        throw new Error(l10n.t('Unable to retrieve connection string for the selected cluster.'));
    }

    const parsedCS = new DocumentDBConnectionString(connectionString);
    const label =
        parsedCS.username && parsedCS.username.length > 0
            ? `${parsedCS.username}@${parsedCS.hosts.join(',')}`
            : parsedCS.hosts.join(',');

    const storageId = generateDocumentDBStorageId(connectionString);

    const storageItem: StorageItem = {
        id: storageId,
        name: label,
        properties: { isEmulator: false, api: API.MongoClusters },
        secrets: [connectionString],
    };

    await StorageService.get(StorageNames.Connections).push('clusters', storageItem, true);

    ext.connectionsBranchDataProvider.refresh();

    await waitForConnectionsViewReady(context);

    // Reveal the connection
    const connectionPath = buildConnectionsViewTreePath(storageItem.id, false);
    await revealConnectionsViewElement(context, connectionPath, {
        select: true,
        focus: false,
        expand: false, // Don't expand immediately to avoid login prompts
    });

    showConfirmationAsInSettings(l10n.t('New connection has been added to your DocumentDB Connections.'));
}
