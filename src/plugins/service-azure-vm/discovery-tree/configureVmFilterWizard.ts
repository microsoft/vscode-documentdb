/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import {
    configureAzureSubscriptionFilter,
    type SubscriptionFilteringOptions,
} from '../../api-shared/azure/subscriptionFiltering/configureAzureSubscriptionFilter';
import { type VmFilteringWizardContext } from './VmFilteringWizardContext';
import { VmTagFilterStep } from './VmTagFilterStep';

/**
 * Configures the Azure VM discovery filters, including both subscription/tenant filtering and VM-specific tag filtering
 */
export async function configureVmFilter(
    baseContext: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
): Promise<void> {
    const options: SubscriptionFilteringOptions<VmFilteringWizardContext> = {
        title: l10n.t('Configure Azure VM Discovery Filters'),
        additionalPromptSteps: [new VmTagFilterStep()],
        contextExtender: (context) =>
            ({
                ...context,
                // Initialize VM-specific properties
                vmTag: undefined,
            }) as VmFilteringWizardContext,
    };

    await configureAzureSubscriptionFilter(baseContext, azureSubscriptionProvider, options);
}
