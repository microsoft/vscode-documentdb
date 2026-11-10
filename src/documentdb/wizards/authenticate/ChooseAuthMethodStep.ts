/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Links } from '../../../constants';
import { traceAuthFlow, traceAuthOperation } from '../../../utils/authTrace';
import { openUrl } from '../../../utils/openUrl';

import {
    AuthMethodId,
    authMethodsFromString,
    createAuthMethodQuickPickItems,
    getAllAuthMethods,
    getAuthMethodFamily,
    isSupportedAuthMethod,
} from '../../auth/AuthMethod';
import { evaluateEntraDestinationFromSettings } from '../../auth/entraDestinationSettings';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ChooseAuthMethodStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        Object.assign(context.telemetry.properties, {
            authMethod: undefined,
            authMethodSelectionSource: undefined,
            entraIdentityChoice: undefined,
            entraIdentityPrompted: undefined,
            entraIdentitySkipReason: undefined,
            managedIdentityKind: undefined,
            managedIdentityClientIdSource: undefined,
        });
        const entraDestinationAllowed =
            context.connectionString !== undefined
                ? evaluateEntraDestinationFromSettings(context.connectionString).allowed
                : (context.entraDestinationAllowed ?? false);
        if (context.availableAuthMethods?.length === 0) {
            context.availableAuthMethods = getAllAuthMethods()
                .filter(
                    (method) =>
                        entraDestinationAllowed || getAuthMethodFamily(method.id) !== AuthMethodId.MicrosoftEntraID,
                )
                .map((method) => method.id);
        }
        const availableMethods = context.availableAuthMethods ?? [AuthMethodId.NativeAuth];
        const supportedMethods = authMethodsFromString(availableMethods).filter(
            (method) => entraDestinationAllowed || getAuthMethodFamily(method) !== AuthMethodId.MicrosoftEntraID,
        );
        const availableFamilies = [...new Set(supportedMethods.map(getAuthMethodFamily))];

        if (availableMethods.length === 1 && !isSupportedAuthMethod(availableMethods[0])) {
            throw new Error(l10n.t('Unsupported authentication method: {0}', availableMethods[0]));
        }

        if (supportedMethods.length === availableMethods.length && availableFamilies.length === 1) {
            context.telemetry.properties.authMethod = availableFamilies[0];
            context.telemetry.properties.authMethodSelectionSource = 'autoSelected';
            traceAuthFlow('authenticate.authMethodPicker.skipped', {
                reason: 'singleSupportedFamily',
                method: availableFamilies[0],
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
            entraDestinationAllowed,
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

        let selectedItem: (typeof quickPickItems)[number];
        do {
            selectedItem = await traceAuthOperation(
                'authenticate.authMethodPicker',
                () =>
                    context.ui.showQuickPick(quickPickItems, {
                        placeHolder:
                            !entraDestinationAllowed && context.connectionStringAuthFacts?.usesOidc
                                ? l10n.t("This server can't use Microsoft Entra ID. Choose another method.")
                                : l10n.t('Select an authentication method for "{resourceName}"', {
                                      resourceName: context.resourceName,
                                  }),
                        title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
                        suppressPersistence: true,
                        ignoreFocusOut: true,
                    }),
                {
                    options: quickPickItems.map((item) => item.authMethod ?? 'unsupported').join(','),
                    unknownMethodCount: unknownMethodIds.length,
                    reason: 'multipleOrUnknownFamilies',
                },
            );
            if (selectedItem.entraUnavailable) {
                await openUrl(Links.EntraTrustedServers);
            }
        } while (selectedItem.entraUnavailable);
        if (isSupportedAuthMethod(selectedItem.authMethod) === false) {
            throw new Error(l10n.t('The selected authentication method is not supported.'));
        }

        context.telemetry.properties.authMethod = selectedItem.authMethod;
        context.telemetry.properties.authMethodSelectionSource = 'prompt';
        context.selectedAuthMethod = selectedItem.authMethod;
        traceAuthFlow('authenticate.authMethodSelected', { method: selectedItem.authMethod });
        context.isAuthMethodUpdated = true;
        context.authenticationMethodPrompted = true;
    }

    public configureBeforePrompt(context: AuthenticateWizardContext): void {
        if (!this.shouldPrompt(context)) {
            context.telemetry.properties.authMethod = context.selectedAuthMethod;
            context.telemetry.properties.authMethodSelectionSource = 'preselected';
        }
        traceAuthFlow('authenticate.authMethodGate', {
            skipped: !this.shouldPrompt(context),
            reason: context.selectedAuthMethod ? 'methodAlreadySelected' : 'noMethodSelected',
        });
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return !context.selectedAuthMethod;
    }
}
