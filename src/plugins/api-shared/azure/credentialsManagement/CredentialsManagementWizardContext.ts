/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';

export interface CredentialsManagementWizardContext extends IActionContext {
    // Required context
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    // Selected account information
    selectedAccount?: vscode.AuthenticationSessionAccountInformation;

    // Available options
    availableAccounts?: vscode.AuthenticationSessionAccountInformation[];
}
