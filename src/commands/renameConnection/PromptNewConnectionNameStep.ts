/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { StorageNames, StorageService } from '../../services/storageService';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

export class PromptNewConnectionNameStep extends AzureWizardPromptStep<RenameConnectionWizardContext> {
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
            const resourceType = context.isEmulator ? 'emulators' : 'clusters';

            const storage = StorageService.get(StorageNames.Connections);
            const items = await storage.getItems(resourceType);

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
