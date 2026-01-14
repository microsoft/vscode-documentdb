/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../../services/connectionStorageService';
import {
    buildFullTreePath,
    focusAndRevealInConnectionsView,
    withConnectionsViewProgress,
} from '../../../tree/connections-view/connectionsViewHelpers';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';

/**
 * Step to execute the move operation.
 * Moves items, refreshes the tree, reveals the target folder, and shows confirmation.
 */
export class ExecuteStep extends AzureWizardExecuteStep<MoveItemsWizardContext> {
    public priority: number = 100;

    public async execute(context: MoveItemsWizardContext): Promise<void> {
        await withConnectionsViewProgress(async () => {
            // Move all items (no conflicts at this point - verified in previous step)
            for (const item of context.itemsToMove) {
                await ConnectionStorageService.updateParentId(item.id, context.connectionType, context.targetFolderId);
            }

            // Refresh the tree view
            ext.connectionsBranchDataProvider.refresh();

            // Build path to target folder for reveal (includes full parent hierarchy for nested folders)
            const isEmulator = context.connectionType === ConnectionType.Emulators;
            const targetPath = context.targetFolderId
                ? await buildFullTreePath(context.targetFolderId, context.connectionType)
                : // Root level - just reveal the connections view itself
                  'connectionsView' + (isEmulator ? '/localEmulators' : '');

            // Reveal target folder
            await focusAndRevealInConnectionsView(context, targetPath, {
                select: true,
                focus: true,
                expand: true, // Expand to show moved items
            });
        });

        // Show confirmation message
        const targetName = context.targetFolderPath ?? l10n.t('/ (Root)');
        showConfirmationAsInSettings(
            l10n.t('Moved {0} item(s) to "{1}".', context.itemsToMove.length.toString(), targetName),
        );

        // Set telemetry - count folders and connections separately
        const foldersCount = context.itemsToMove.filter((item) => item.properties.type === ItemType.Folder).length;
        const connectionsCount = context.itemsToMove.length - foldersCount;

        context.telemetry.properties.operation = 'move';
        context.telemetry.properties.connectionType = context.connectionType;
        context.telemetry.properties.targetType = context.targetFolderId ? 'folder' : 'root';
        context.telemetry.measurements.itemCount = context.itemsToMove.length;
        context.telemetry.measurements.foldersCount = foldersCount;
        context.telemetry.measurements.connectionsCount = connectionsCount;
    }

    public shouldExecute(context: MoveItemsWizardContext): boolean {
        return context.itemsToMove.length > 0;
    }
}
