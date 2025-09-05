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
        'MongoClusters.svg',
    );

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }

        const managementClient = await createCosmosDBManagementClient(
            context,
            context.properties[AzureContextProperties.SelectedSubscription] as unknown as AzureSubscription,
        );

        const allAccounts = await uiUtils.listAllIterator(managementClient.databaseAccounts.list());
        const accounts = allAccounts.filter((account) => account.kind === 'MongoDB');

        const promptItems: (QuickPickItem & { id: string })[] = accounts
            .map((account) => ({
                id: account.id!,
                label: account.name!,
                description: account.id,
                iconPath: this.iconPath,

                alwaysShow: true,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        const selectedItem = await context.ui.showQuickPick([...promptItems], {
            stepName: 'selectRUCluster',
            placeHolder: l10n.t('Choose a RU cluster…'),
            loadingPlaceHolder: l10n.t('Loading RU clusters…'),
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        context.properties[AzureContextProperties.SelectedCluster] = accounts.find(
            (account) => account.id === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
