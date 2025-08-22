/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptPasswordStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter the password for {experience}', {
            experience: context.experience!.shortName,
        });

        const password = await context.ui.showInputBox({
            prompt: prompt,
            ignoreFocusOut: true,
            password: true,
            value: context.password,
            validateInput: (password?: string) => this.validateInput(context, password),
        });

        context.valuesToMask.push(password);
        context.password = password;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }

    public validateInput(context: NewConnectionWizardContext, password: string | undefined): string | undefined {
        password = password ? password.trim() : '';

        if (password.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        try {
            const parsedConnectionString = new DocumentDBConnectionString(context.connectionString!);
            parsedConnectionString.password = password;

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
