/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptUsernameStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the username for {experience}', {
            experience: context.experience!.shortName,
        });

        const username = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            value: context.username,
            validateInput: (username?: string) => this.validateInput(context, username),
        });

        const parsedConnectionString = new DocumentDBConnectionString(context.connectionString!);
        parsedConnectionString.username = username;

        context.connectionString = parsedConnectionString.toString();
        context.username = username;

        context.valuesToMask.push(username);
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public validateInput(context: NewConnectionWizardContext, username: string | undefined): string | undefined {
        username = username ? username.trim() : '';

        if (username.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        try {
            const parsedConnectionString = new DocumentDBConnectionString(context.connectionString!);
            parsedConnectionString.username = username;

            const connectionString = parsedConnectionString.toString();

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
