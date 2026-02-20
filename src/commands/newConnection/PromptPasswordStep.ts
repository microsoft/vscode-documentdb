/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
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
            value: context.nativeAuthConfig?.connectionPassword,
            validateInput: (password?: string) => this.validateInput(context, password),
            // eslint-disable-next-line @typescript-eslint/require-await
            asyncValidationTask: async (password?: string) => {
                if (!password || password.length === 0) {
                    return l10n.t('Password cannot be empty');
                }
                return undefined;
            },
        });

        context.valuesToMask.push(password);
        // Update both structured config and legacy field
        context.nativeAuthConfig = {
            connectionUser: context.nativeAuthConfig?.connectionUser ?? '',
            connectionPassword: password,
        };
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }

    public validateInput(_context: NewConnectionWizardContext, password: string | undefined): string | undefined {
        password = password ?? '';

        if (password.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        // Validate the password value itself without reconstructing the full connection string.
        // The connection string was already validated during the connection string prompt step.
        // Reconstructing it here added unnecessary risk of failure from encoding round-trips.
        if (!DocumentDBConnectionString.validatePassword(password)) {
            return l10n.t('Password contains characters that cannot be safely encoded.');
        }

        return undefined;
    }
}
