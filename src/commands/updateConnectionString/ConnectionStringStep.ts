/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ConnectionStringStep extends AzureWizardPromptStep<UpdateCSWizardContext> {
    public async prompt(context: UpdateCSWizardContext): Promise<void> {
        const newConnectionString = await context.ui.showInputBox({
            prompt: l10n.t('Please edit the connection string.'),
            value: context.originalConnectionString,
            ignoreFocusOut: true,
            validateInput: (connectionString?: string) => this.validateInput(connectionString),
            asyncValidationTask: (name: string) => this.validateConnectionString(name),
        });

        // Trim the connection string to remove any invisible or whitespace characters
        // that may have been introduced during copy-paste before any parsing is done
        context.newConnectionString = newConnectionString.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public validateInput(this: void, connectionString: string | undefined): string | undefined {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!(connectionString.startsWith('mongodb://') || connectionString.startsWith('mongodb+srv://'))) {
            return l10n.t('"mongodb://" or "mongodb+srv://" must be the prefix of the connection string.');
        }

        return undefined;
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | undefined> {
        connectionString = connectionString ? connectionString.trim() : '';

        if (connectionString.length === 0) {
            return l10n.t('Invalid Connection String: {error}', {
                error: l10n.t('Connection string cannot be empty.'),
            });
        }

        try {
            new DocumentDBConnectionString(connectionString);
        } catch (error) {
            if (error instanceof Error && error.name === 'MongoParseError') {
                return error.message;
            } else {
                return l10n.t('Invalid Connection String: {error}', { error: parseError(error).message });
            }
        }

        return undefined;
    }
}
