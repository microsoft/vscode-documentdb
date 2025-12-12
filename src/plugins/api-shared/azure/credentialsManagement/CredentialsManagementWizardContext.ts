/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';

export interface TenantWithSignInStatus {
    tenant: AzureTenant;
    isSignedIn: boolean;
}

export interface AccountWithTenantInfo {
    account: vscode.AuthenticationSessionAccountInformation;
    tenantsWithStatus: TenantWithSignInStatus[];
}

export interface CredentialsManagementWizardContext extends IActionContext {
    // Required context
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    // Selected account information
    selectedAccount?: vscode.AuthenticationSessionAccountInformation;

    // All accounts with their tenant info (fetched once in SelectAccountStep)
    // Initialized with [] so it's captured in propertiesBeforePrompt and survives back navigation
    allAccountsWithTenantInfo: AccountWithTenantInfo[];

    // Selected tenant
    selectedTenant?: AzureTenant;
}
