/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from '../NewLocalConnectionWizardContext';

// TODO: create one that can be shared for adding an account and adding an emulator
export class PromptMongoRUEmulatorConnectionStringStep extends AzureWizardPromptStep<NewLocalConnectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: NewLocalConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the connection string of your local connection');
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
        context.userName = parsedConnectionString.username;
        context.password = parsedConnectionString.password;
        context.port = extractPortFromConnectionString(parsedConnectionString);

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

    public shouldPrompt(context: NewLocalConnectionWizardContext): boolean {
        return context.mode === NewEmulatorConnectionMode.CustomConnectionString;
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

function extractPortFromConnectionString(parsedConnectionString: DocumentDBConnectionString): number | undefined {
    try {
        const { hosts } = parsedConnectionString;

        // Access the first host and split it by ':' to separate hostname and port, then extract the port part
        const portStr = hosts?.[0]?.split(':')[1];

        // Convert the port string to a number using base 10
        const port = parseInt(portStr ?? '', 10);

        // If the parsed port is not a number (NaN), return undefined; otherwise, return the port number
        return isNaN(port) ? undefined : port;
    } catch {
        // If an error occurs during parsing, default to returning undefined
        return undefined;
    }
}
