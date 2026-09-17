/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { traceAuthFlow, traceAuthOperation } from '../../../utils/authTrace';

import {
    AuthMethodId,
    authMethodsFromString,
    createAuthMethodQuickPickItems,
    getAuthMethodFamily,
    isSupportedAuthMethod,
} from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ChooseAuthMethodStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const availableMethods = context.availableAuthMethods ?? [AuthMethodId.NativeAuth];
        const supportedMethods = authMethodsFromString(availableMethods);
        const availableFamilies = [...new Set(supportedMethods.map(getAuthMethodFamily))];

        if (availableMethods.length === 1 && !isSupportedAuthMethod(availableMethods[0])) {
            throw new Error(l10n.t('Unsupported authentication method: {0}', availableMethods[0]));
        }

        if (supportedMethods.length === availableMethods.length && availableFamilies.length === 1) {
            traceAuthFlow('authenticate.authMethodPicker.skipped', {
                reason: 'singleSupportedFamily', method: availableFamilies[0],
            });
            context.selectedAuthMethod = availableFamilies[0];
            context.isAuthMethodUpdated = true;
            context.authenticationMethodPrompted = false;
            return;
        }

        // Create quick pick items for each auth method - show all methods with support info
        const quickPickItems = createAuthMethodQuickPickItems(supportedMethods, {
            showSupportInfo: true,
            filterUnsupported: false,
        });

        const unknownMethodIds = availableMethods.filter((methodId) => !isSupportedAuthMethod(methodId));
        context.telemetry.properties.unknownAuthMethods = unknownMethodIds.join(',');

        // Add unknown methods to quickPickItems
        for (const methodId of unknownMethodIds) {
            quickPickItems.push({
                label: methodId,
                detail: l10n.t('Unsupported authentication method.'),
                alwaysShow: true,
            });
        }

        const selectedItem = await traceAuthOperation('authenticate.authMethodPicker', () => context.ui.showQuickPick(quickPickItems, {
            placeHolder: l10n.t('Select an authentication method for "{resourceName}"', {
                resourceName: context.resourceName,
            }),
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            suppressPersistence: true,
            ignoreFocusOut: true,
        }), {
            options: quickPickItems.map((item) => item.authMethod ?? 'unsupported').join(','),
            unknownMethodCount: unknownMethodIds.length,
            reason: 'multipleOrUnknownFamilies',
        });

        if (isSupportedAuthMethod(selectedItem.authMethod) === false) {
            throw new Error(l10n.t('The selected authentication method is not supported.'));
        }

        context.selectedAuthMethod = selectedItem.authMethod;
        traceAuthFlow('authenticate.authMethodSelected', { method: selectedItem.authMethod });
        context.isAuthMethodUpdated = true;
        context.authenticationMethodPrompted = true;
    }

    public configureBeforePrompt(context: AuthenticateWizardContext): void {
        traceAuthFlow('authenticate.authMethodGate', {
            skipped: !this.shouldPrompt(context),
            reason: context.selectedAuthMethod ? 'methodAlreadySelected' : 'noMethodSelected',
        });
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return !context.selectedAuthMethod;
    }
}
