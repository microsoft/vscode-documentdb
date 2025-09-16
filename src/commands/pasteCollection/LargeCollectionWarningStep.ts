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
            'This copy and paste operation can be slow because the data is being read and written by your system. For larger migrations, a dedicated migration approach can be better.',
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
            { title: tellMeMoreButton },
            { title: continueButton },
        );

        if (!response) {
            // User pressed Esc or clicked the X button - treat as cancellation
            context.telemetry.properties.largeCollectionWarningResult = 'cancelled';
            throw new UserCancelledError();
        }

        if (response.title === tellMeMoreButton) {
            // User chose to see documentation - abort the wizard flow
            context.telemetry.properties.largeCollectionWarningResult = 'tellMeMore';

            // Open documentation (placeholder URL as requested)
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

        // User chose to continue
        context.telemetry.properties.largeCollectionWarningResult = 'continue';
    }

    public shouldPrompt(): boolean {
        // The conditional logic is handled in the main wizard file
        // This step is only added to the wizard when needed
        return true;
    }
}
