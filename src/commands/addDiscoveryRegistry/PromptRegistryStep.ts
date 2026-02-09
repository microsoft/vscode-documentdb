/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { QuickPickItemKind, type QuickPickItem } from 'vscode';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type AddRegistryWizardContext } from './AddRegistryWizardContext';

export class PromptRegistryStep extends AzureWizardPromptStep<AddRegistryWizardContext> {
    public async prompt(context: AddRegistryWizardContext): Promise<void> {
        const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

        const promptItems: (QuickPickItem & { id: string })[] = DiscoveryService.listProviders()
            // Filter out already enabled providers
            .filter((provider) => {
                return !activeDiscoveryProviderIds.includes(provider.id);
            })
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
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

        if (promptItems.length === 0) {
            promptItems.push({
                id: 'noProviders',
                label: l10n.t('All available providers have been added already.'),
                alwaysShow: true,
            });
        }

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
                    detail: l10n.t('Learn more about integrating your cloud providers.'),
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

        if (selectedItem.id === 'noProviders') {
            throw new UserCancelledError();
        }

        context.discoveryProviderId = selectedItem.id;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
