/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ConnectionStringStep extends AzureWizardPromptStep<UpdateCSWizardContext> {
    public async prompt(context: UpdateCSWizardContext): Promise<void> {
        const newConnectionString = await context.ui.showInputBox({
            prompt: l10n.t('Please edit the connection string.'),
            value: context.originalConnectionString,
            ignoreFocusOut: true,
            asyncValidationTask: (name: string) => this.validateConnectionString(name),
        });

        context.newConnectionString = newConnectionString.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async validateConnectionString(connectionString: string): Promise<string | undefined> {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            return l10n.t('Invalid Connection String: {error}', {
                error: l10n.t('Connection string cannot be empty.'),
            });
        }

        if (!(connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://'))) {
            return l10n.t('"mongodb://" or "mongodb+srv://" must be the prefix of the connection string.');
        }

        return undefined;
    }
}
