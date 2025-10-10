/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzureSubscription,
    type AzureTenant,
    type VSCodeAzureSubscriptionProvider,
} from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface FilteringWizardContext extends IActionContext {
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider;

    // Initialized data
    availableTenants?: AzureTenant[];
    allSubscriptions?: AzureSubscription[];

    // User selections
    selectedTenants?: AzureTenant[];
    selectedSubscriptions?: AzureSubscription[];
}
