/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../../services/connectionStorageService';
import {
    buildConnectionsViewTreePath,
    focusAndRevealInConnectionsView,
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
        // Move all items (no conflicts at this point - verified in previous step)
        for (const item of context.itemsToMove) {
            await ConnectionStorageService.updateParentId(item.id, context.connectionType, context.targetFolderId);
        }

        // Refresh the tree view
        ext.connectionsBranchDataProvider.refresh();

        // Build path to target folder for reveal
        const isEmulator = context.connectionType === ConnectionType.Emulators;
        const targetPath = context.targetFolderId
            ? buildConnectionsViewTreePath(context.targetFolderId, isEmulator)
            : // Root level - just reveal the connections view itself
              'connectionsView' + (isEmulator ? '/localEmulators' : '');

        // Reveal target folder
        await focusAndRevealInConnectionsView(context, targetPath, {
            select: true,
            focus: true,
            expand: true, // Expand to show moved items
        });

        // Show confirmation message
        const targetName = context.targetFolderPath ?? l10n.t('/ (Root)');
        showConfirmationAsInSettings(
            l10n.t('Moved {0} item(s) to "{1}".', context.itemsToMove.length.toString(), targetName),
        );

        // Set telemetry
        context.telemetry.properties.operation = 'move';
        context.telemetry.measurements.itemCount = context.itemsToMove.length;
        context.telemetry.properties.targetType = context.targetFolderId ? 'folder' : 'root';
    }

    public shouldExecute(context: MoveItemsWizardContext): boolean {
        return context.itemsToMove.length > 0;
    }
}
