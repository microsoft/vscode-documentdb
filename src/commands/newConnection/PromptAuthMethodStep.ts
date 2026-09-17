/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { createAuthMethodQuickPickItemsWithSupportInfo } from '../../documentdb/auth/AuthMethod';
import { traceAuthFlow, traceAuthOperation } from '../../utils/authTrace';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptAuthMethodStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const quickPickItems = createAuthMethodQuickPickItemsWithSupportInfo(context.availableAuthenticationMethods);

        Object.assign(context.telemetry.properties, {
            authMethod: undefined,
            authMethodSelectionSource: undefined,
            entraIdentityChoice: undefined,
            entraIdentityPrompted: undefined,
            entraIdentitySkipReason: undefined,
            managedIdentityKind: undefined,
            managedIdentityClientIdSource: undefined,
        });
        const selectedItem = await traceAuthOperation(
            'newConnection.authMethodPicker',
            () => context.ui.showQuickPick(quickPickItems, {
                placeHolder: vscode.l10n.t('Select an authentication method'),
                stepName: 'selectAuthMethod',
                ignoreFocusOut: true,
                suppressPersistence: true,
            }),
            { options: quickPickItems.map((item) => item.authMethod).join(','), reason: 'noMethodSelected' },
        );
        if (!selectedItem) {
            throw new Error(vscode.l10n.t('No authentication method selected.'));
        }

        context.telemetry.properties.authMethod = selectedItem.authMethod;
        context.telemetry.properties.authMethodSelectionSource = 'prompt';
        context.selectedAuthenticationMethod = selectedItem.authMethod;
        traceAuthFlow('newConnection.authMethodSelected', { method: selectedItem.authMethod ?? 'none' });
        context.authenticationMethodPrompted = true;
    }

    public configureBeforePrompt(context: NewConnectionWizardContext): void {
        if (!this.shouldPrompt(context)) {
            context.telemetry.properties.authMethod = context.selectedAuthenticationMethod;
            context.telemetry.properties.authMethodSelectionSource = 'preselected';
        }
        traceAuthFlow('newConnection.authMethodGate', {
            skipped: !this.shouldPrompt(context),
            reason: context.selectedAuthenticationMethod ? 'methodAlreadySelectedOrInferred' : 'noMethodSelected',
            method: context.selectedAuthenticationMethod ?? 'none',
        });
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.selectedAuthenticationMethod;
    }
}
