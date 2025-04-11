/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, openUrl, UserCancelledError, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { QuickPickItemKind, type QuickPickItem } from 'vscode';
import { ServiceDiscoveryService } from '../../services/serviceDiscoveryServices';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptServiceDiscoveryStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const promptItems: (QuickPickItem & { id: string })[] = ServiceDiscoveryService.listProviders()
            .map((provider) => ({
                id: provider.id,
                label: provider.label,
                detail: provider.description,
                iconPath: provider.iconPath,

                alwaysShow: true,
            }))
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

            await openUrl(
                'https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-develop-emulator?pivots=api-mongodb&tabs=windows%2Ccsharp#import-the-emulators-tlsssl-certificate',
            );
            throw new UserCancelledError();
        }

        context.serviceDiscoveryProviderId = selectedItem.id;
    }

    public async getSubWizard(
        wizardContext: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext> | undefined> {
        if (!wizardContext.serviceDiscoveryProviderId) {
            return undefined;
        }

        // delegate to the provider, only it knows what steps it needs and how to help the user
        // we expect the provider to return a wizard with prompt and execute steps so that in the end
        // the wizardContext.connectionString is set
        return ServiceDiscoveryService.getProvider(wizardContext.serviceDiscoveryProviderId)?.getDiscoveryWizard(
            wizardContext,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
