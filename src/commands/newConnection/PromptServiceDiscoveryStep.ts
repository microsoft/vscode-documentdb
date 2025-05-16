/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { QuickPickItemKind, type QuickPickItem } from 'vscode';
import { DiscoveryService } from '../../services/discoveryServices';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptServiceDiscoveryStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const promptItems: (QuickPickItem & { id: string })[] = DiscoveryService.listProviders()
            // Map to QuickPickItem format
            .map((provider) => ({
                id: provider.id,
                label: provider.label,
                detail: provider.description,
                iconPath: provider.iconPath,

                group: 'Service Providers',
                alwaysShow: true,
            }))
            // Sort alphabetically
            .sort((a, b) => a.label.localeCompare(b.label));

        const selectedItem = await context.ui.showQuickPick(
            [
                ...promptItems,
                {
                    label: '',
                    kind: QuickPickItemKind.Separator,
                },
                {
                    id: 'learnMore',
                    label: l10n.t('Learn more…'),
                    detail: l10n.t('Learn more about integrating your cloud provider.'),
                    alwaysShow: true,
                    group: 'Learn More',
                },
            ],
            {
                enableGrouping: true,
                placeHolder: l10n.t('Choose your provider…'),
                stepName: 'selectProvider',
                suppressPersistence: true,
            },
        );

        if (selectedItem.id === 'learnMore') {
            context.telemetry.properties.emulatorLearnMoreSecurity = 'true';

            await openUrl('https://aka.ms/vscode-documentdb-discovery-providers');
            throw new UserCancelledError();
        }

        context.telemetry.properties.discoveryProviderId = selectedItem.id;
        context.discoveryProviderId = selectedItem.id;
    }

    public async getSubWizard(
        wizardContext: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext> | undefined> {
        if (!wizardContext.discoveryProviderId) {
            return undefined;
        }

        /*
         * Delegate to the provider, as only the provider knows the necessary steps to be shown
         * and how to assist the user effectively.
         *
         * The provider is expected to return a wizard containing both prompt and execute steps.
         * By the end of the process, the wizard should ensure that `wizardContext.connectionString` is set.
         */
        return DiscoveryService.getProvider(wizardContext.discoveryProviderId)?.getDiscoveryWizard(wizardContext);
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
