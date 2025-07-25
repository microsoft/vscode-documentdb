/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptConnectionStringStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the connection string of your MongoDB cluster.');
        context.connectionString = (
            await context.ui.showInputBox({
                prompt: prompt,
                ignoreFocusOut: true,
                placeHolder: l10n.t('Starts with mongodb:// or mongodb+srv://'),
                validateInput: (connectionString?: string) => this.validateInput(connectionString),
                asyncValidationTask: (connectionString: string) => this.validateConnectionString(connectionString),
            })
        ).trim();

        const parsedConnectionString = new DocumentDBConnectionString(context.connectionString);
        context.username = parsedConnectionString.username;
        context.password = parsedConnectionString.password;

        context.valuesToMask.push(context.connectionString);
    }

    //eslint-disable-next-line @typescript-eslint/require-await
    private async validateConnectionString(connectionString: string): Promise<string | null | undefined> {
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

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.connectionString;
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
}
