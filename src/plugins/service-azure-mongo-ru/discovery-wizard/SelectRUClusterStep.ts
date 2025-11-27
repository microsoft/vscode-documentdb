/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { Uri, type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { AzureContextProperties } from '../../api-shared/azure/wizard/AzureContextProperties';

export class SelectRUClusterStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    iconPath = Uri.joinPath(
        ext.context.extensionUri,
        'resources',
        'from_node_modules',
        '@microsoft',
        'vscode-azext-azureutils',
        'resources',
        'azureIcons',
        'AzureCosmosDb.svg',
    );

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }

        // Create async function to provide better loading UX and debugging experience
        const getRUClusterQuickPickItems = async (): Promise<(QuickPickItem & { id: string })[]> => {
            const managementClient = await createCosmosDBManagementClient(
                context,
                context.properties[AzureContextProperties.SelectedSubscription] as unknown as AzureSubscription,
            );

            const allAccounts = await uiUtils.listAllIterator(managementClient.databaseAccounts.list());
            const accounts = allAccounts.filter((account) => account.kind === 'MongoDB');

            const promptItems: (QuickPickItem & { id: string })[] = accounts
                .filter((account) => account.name) // Filter out accounts without a name
                .map((account) => ({
                    id: account.id!,
                    label: account.name!,
                    description: account.id,
                    iconPath: this.iconPath,

                    alwaysShow: true,
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            return promptItems;
        };

        const selectedItem = await context.ui.showQuickPick(getRUClusterQuickPickItems(), {
            stepName: 'selectRUCluster',
            placeHolder: l10n.t('Choose a RU cluster…'),
            loadingPlaceHolder: l10n.t('Loading Clusters…'),
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        // Get accounts again to find the selected one (likely cached by Azure SDK)
        const managementClient = await createCosmosDBManagementClient(
            context,
            context.properties[AzureContextProperties.SelectedSubscription] as unknown as AzureSubscription,
        );
        const allAccounts = await uiUtils.listAllIterator(managementClient.databaseAccounts.list());
        const accounts = allAccounts.filter((account) => account.kind === 'MongoDB');

        context.properties[AzureContextProperties.SelectedCluster] = accounts.find(
            (account) => account.id === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
