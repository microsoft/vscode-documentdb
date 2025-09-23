/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';

export interface CredentialsManagementWizardContext extends IActionContext {
    // Required context
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    // Selected account information
    selectedAccount?: vscode.AuthenticationSessionAccountInformation;
    selectedTenants?: AzureTenant[];

    // Available options
    availableAccounts?: vscode.AuthenticationSessionAccountInformation[];
    availableTenants?: Map<string, AzureTenant[]>; // accountId -> tenants

    // State tracking
    shouldRestartWizard?: boolean;
    newAccountSignedIn?: boolean;
}
