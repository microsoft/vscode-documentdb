/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
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
            value: context.nativeAuthConfig?.connectionUser ?? '',
            validateInput: (username?: string) => this.validateInput(context, username),
            // eslint-disable-next-line @typescript-eslint/require-await
            asyncValidationTask: async (username?: string) => {
                if (!username || username.trim().length === 0) {
                    return l10n.t('Username cannot be empty');
                }
                return undefined;
            },
        });

        // Trim the username to remove leading/trailing whitespace
        const trimmedUsername = username.trim();

        context.valuesToMask.push(trimmedUsername, username);
        // Update structured config
        context.nativeAuthConfig = {
            connectionUser: trimmedUsername,
            connectionPassword: context.nativeAuthConfig?.connectionPassword ?? '',
        };
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }

    public validateInput(_context: NewConnectionWizardContext, username: string | undefined): string | undefined {
        username = username ? username.trim() : '';

        if (username.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        // Validate the username value itself without reconstructing the full connection string.
        // The connection string was already validated during the connection string prompt step.
        // Reconstructing it here added unnecessary risk of failure from encoding round-trips.
        if (!DocumentDBConnectionString.validateUsername(username)) {
            return l10n.t('Username contains characters that cannot be safely encoded.');
        }

        return undefined;
    }
}
