/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../../services/connectionStorageService';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

export class PromptNewConnectionNameStep extends AzureWizardPromptStep<RenameConnectionWizardContext> {
    public async prompt(context: RenameConnectionWizardContext): Promise<void> {
        const newConnectionName = await context.ui.showInputBox({
            title: l10n.t('Rename Connection'),
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

        // Don't validate if the name hasn't changed
        if (name.trim() === context.originalConnectionName) {
            return undefined;
        }

        try {
            const connectionType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;

            // Get the connection's current data to find its parentId
            const connectionData = await ConnectionStorageService.get(context.storageId, connectionType);
            const parentId = connectionData?.properties?.parentId;

            // Check for duplicate names only within the same parent folder
            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                name.trim(),
                parentId,
                connectionType,
                ItemType.Connection,
                context.storageId, // Exclude the current connection from the check
            );

            if (isDuplicate) {
                return l10n.t('A connection with this name already exists at this level.');
            }
        } catch (_error) {
            console.error(_error); // todo: push it to our telemetry
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
