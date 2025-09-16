/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class LargeCollectionWarningStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const title = l10n.t('Large Collection Copy Operation');
        const detail = l10n.t(
            "You're attempting to copy a large number of documents. This process can be slow because it downloads all documents from the source to your computer and then uploads them to the destination, which can take a significant amount of time and bandwidth.\n\nFor larger data migrations, we recommend using a dedicated migration tool for a faster experience.\n\nNote: You can disable this warning or adjust the document count threshold in the extension settings.",
        );

        const tellMeMoreButton = l10n.t('Tell me more');
        const continueButton = l10n.t('Continue');

        // Show modal dialog with custom buttons
        const response = await vscode.window.showInformationMessage(
            title,
            {
                modal: true,
                detail: detail,
            },
            { title: continueButton },
            { title: tellMeMoreButton },
        );

        if (!response) {
            // User pressed Esc or clicked the X button - treat as cancellation
            context.telemetry.properties.largeCollectionWarningResult = 'cancelled';
            throw new UserCancelledError();
        }

        context.telemetry.properties.largeCollectionWarningResult = response.title;

        if (response.title === tellMeMoreButton) {
            // User chose to see documentation - abort the wizard flow

            const migrationUrl = 'https://github.com/microsoft/vscode-cosmosdb/';

            try {
                // Try to open with Simple Browser first (extension may not be available)
                await vscode.commands.executeCommand('simpleBrowser.api.open', migrationUrl, {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: false,
                });
                context.telemetry.properties.documentationOpenMethod = 'simpleBrowser';
            } catch {
                await openUrl(migrationUrl);
                context.telemetry.properties.documentationOpenMethod = 'openUrl';
            }

            // Abort the wizard flow after opening documentation
            throw new UserCancelledError();
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
