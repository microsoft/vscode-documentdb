/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    AzureWizardExecuteStep,
    AzureWizardPromptStep,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { l10n as vscodel10n, window } from 'vscode';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../../services/connectionStorageService';
import { DocumentDBClusterItem } from '../../../tree/connections-view/DocumentDBClusterItem';
import { FolderItem } from '../../../tree/connections-view/FolderItem';
import { type TreeElement } from '../../../tree/TreeElement';
import { nonNullOrEmptyValue, nonNullValue } from '../../../utils/nonNull';
import { refreshView } from '../../refreshView/refreshView';

// ================================================================================================
// Context Interfaces
// ================================================================================================

interface RenameConnectionWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;

    originalConnectionName: string;
    newConnectionName?: string;
}

interface RenameFolderWizardContext extends IActionContext {
    folderId?: string;
    originalFolderName?: string;
    newFolderName?: string;
    parentFolderId?: string; // To check for duplicate names at the same level
    connectionType?: ConnectionType;
}

// ================================================================================================
// Prompt Steps - Connection
// ================================================================================================

class PromptNewConnectionNameStep extends AzureWizardPromptStep<RenameConnectionWizardContext> {
    public async prompt(context: RenameConnectionWizardContext): Promise<void> {
        const newConnectionName = await context.ui.showInputBox({
            prompt: l10n.t('Please enter a new connection name.'),
            value: context.originalConnectionName,
            ignoreFocusOut: true,
            asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
        });

        context.newConnectionName = newConnectionName.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async validateNameAvailable(
        context: RenameConnectionWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return l10n.t('A connection name is required.');
        }

        try {
            const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
            const items = await ConnectionStorageService.getAll(resourceType);

            if (items.filter((connection) => 0 === connection.name.localeCompare(name, undefined)).length > 0) {
                return l10n.t('The connection with the name "{0}" already exists.', name);
            }
        } catch (_error) {
            console.error(_error); // todo: push it to our telemetry
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}

// ================================================================================================
// Prompt Steps - Folder
// ================================================================================================

class PromptNewFolderNameStep extends AzureWizardPromptStep<RenameFolderWizardContext> {
    public async prompt(context: RenameFolderWizardContext): Promise<void> {
        const originalName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'PromptNewFolderNameStep',
        );
        const connectionType = nonNullValue(
            context.connectionType,
            'context.connectionType',
            'PromptNewFolderNameStep',
        );

        const newFolderName = await context.ui.showInputBox({
            prompt: l10n.t('Enter new folder name'),
            value: originalName,
            validateInput: async (value: string) => {
                if (!value || value.trim().length === 0) {
                    return l10n.t('Folder name cannot be empty');
                }

                // Don't validate if the name hasn't changed
                if (value.trim() === originalName) {
                    return undefined;
                }

                // Check for duplicate folder names at the same level
                const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    value.trim(),
                    context.parentFolderId,
                    connectionType,
                    ItemType.Folder,
                    context.folderId,
                );

                if (isDuplicate) {
                    return l10n.t('A folder with this name already exists at this level');
                }

                return undefined;
            },
        });

        context.newFolderName = newFolderName.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }
}

// ================================================================================================
// Execute Steps - Connection
// ================================================================================================

class RenameConnectionExecuteStep extends AzureWizardExecuteStep<RenameConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameConnectionWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connection = await ConnectionStorageService.get(context.storageId, resourceType);

        if (connection) {
            connection.name = nonNullValue(
                context.newConnectionName,
                'context.newConnectionName',
                'RenameConnectionExecuteStep',
            );

            try {
                await ConnectionStorageService.save(resourceType, connection, true);
            } catch (pushError) {
                console.error(`Failed to rename the connection "${context.storageId}":`, pushError);
                void window.showErrorMessage(vscodel10n.t('Failed to rename the connection.'));
            }
        } else {
            console.error(`Connection with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(vscodel10n.t('Failed to rename the connection.'));
        }
    }

    public shouldExecute(context: RenameConnectionWizardContext): boolean {
        return !!context.newConnectionName && context.newConnectionName !== context.originalConnectionName;
    }
}

// ================================================================================================
// Execute Steps - Folder
// ================================================================================================

class RenameFolderExecuteStep extends AzureWizardExecuteStep<RenameFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameFolderWizardContext): Promise<void> {
        const folderId = nonNullOrEmptyValue(context.folderId, 'context.folderId', 'RenameFolderExecuteStep');
        const newFolderName = nonNullOrEmptyValue(
            context.newFolderName,
            'context.newFolderName',
            'RenameFolderExecuteStep',
        );
        const originalFolderName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'RenameFolderExecuteStep',
        );
        const connectionType = nonNullValue(
            context.connectionType,
            'context.connectionType',
            'RenameFolderExecuteStep',
        );

        // Don't do anything if the name hasn't changed
        if (newFolderName === originalFolderName) {
            return;
        }

        const folder = nonNullValue(
            await ConnectionStorageService.get(folderId, connectionType),
            'ConnectionStorageService.get(folderId, connectionType)',
            'RenameFolderExecuteStep',
        );

        folder.name = newFolderName;
        await ConnectionStorageService.save(connectionType, folder, true);

        ext.outputChannel.appendLine(
            vscodel10n.t('Renamed folder from "{oldName}" to "{newName}"', {
                oldName: originalFolderName,
                newName: newFolderName,
            }),
        );
    }

    public shouldExecute(context: RenameFolderWizardContext): boolean {
        return !!context.newFolderName && context.newFolderName !== context.originalFolderName;
    }
}

// ================================================================================================
// Public Functions
// ================================================================================================

/**
 * Rename a connection
 */
export async function renameConnection(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(vscodel10n.t('No node selected.'));
    }

    const wizardContext: RenameConnectionWizardContext = {
        ...context,
        originalConnectionName: node.cluster.name,
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscodel10n.t('Rename Connection'),
        promptSteps: [new PromptNewConnectionNameStep()],
        executeSteps: [new RenameConnectionExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    await refreshView(context, Views.ConnectionsView);
}

/**
 * Rename a folder
 */
export async function renameFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(vscodel10n.t('No folder selected.'));
    }

    // Determine connection type - for now, use Clusters as default
    // TODO: This should be retrieved from the folder item
    const connectionType = ConnectionType.Clusters;

    // Get folder data to get parentId
    const folderData = await ConnectionStorageService.get(folderItem.storageId, connectionType);

    const wizardContext: RenameFolderWizardContext = {
        ...context,
        folderId: folderItem.storageId,
        originalFolderName: folderItem.name,
        parentFolderId: folderData?.properties.parentId,
        connectionType: connectionType,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscodel10n.t('Rename Folder'),
        promptSteps: [new PromptNewFolderNameStep()],
        executeSteps: [new RenameFolderExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    await refreshView(context, Views.ConnectionsView);
}

/**
 * Generic rename command that dispatches to the appropriate rename function
 * based on the selected item type (folder or connection).
 */
export async function renameItem(context: IActionContext, selectedItem?: TreeElement): Promise<void> {
    if (!selectedItem) {
        throw new Error(vscodel10n.t('No item selected to rename.'));
    }

    if (selectedItem instanceof FolderItem) {
        await renameFolder(context, selectedItem);
    } else if (selectedItem instanceof DocumentDBClusterItem) {
        await renameConnection(context, selectedItem);
    } else {
        throw new Error(vscodel10n.t('Selected item cannot be renamed.'));
    }
}
