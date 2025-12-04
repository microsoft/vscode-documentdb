/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { getThemeAgnosticIconPath } from '../../../constants';
import { createResourceManagementClient } from '../../../utils/azureClients';
import { AzureContextProperties } from '../../api-shared/azure/wizard/AzureContextProperties';

export class SelectClusterStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    iconPath = getThemeAgnosticIconPath('AzureDocumentDb.svg');

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (
            context.properties[AzureContextProperties.SelectedSubscription] === undefined // ||
            // !(context.properties[AzureContextProperties.SelectedSubscription] instanceof AzureSubscription)
        ) {
            throw new Error('SelectedSubscription is not set.');
        }

        // Create async function to provide better loading UX and debugging experience
        const getClusterQuickPickItems = async (): Promise<(QuickPickItem & { id: string })[]> => {
            const client = await createResourceManagementClient(
                context,
                context.properties[AzureContextProperties.SelectedSubscription] as unknown as AzureSubscription,
            );

            const accounts = await uiUtils.listAllIterator(
                client.resources.list({ filter: "resourceType eq 'Microsoft.DocumentDB/mongoClusters'" }),
            );

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

        const selectedItem = await context.ui.showQuickPick(getClusterQuickPickItems(), {
            stepName: 'selectCluster',
            placeHolder: l10n.t('Choose a cluster…'),
            loadingPlaceHolder: l10n.t('Loading Clusters…'),
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        // Get accounts again to find the selected one (likely cached by Azure SDK)
        const client = await createResourceManagementClient(
            context,
            context.properties[AzureContextProperties.SelectedSubscription] as unknown as AzureSubscription,
        );
        const accounts = await uiUtils.listAllIterator(
            client.resources.list({ filter: "resourceType eq 'Microsoft.DocumentDB/mongoClusters'" }),
        );

        context.properties[AzureContextProperties.SelectedCluster] = accounts.find(
            (account) => account.id === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
