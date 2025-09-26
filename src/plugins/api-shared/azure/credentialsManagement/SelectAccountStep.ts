/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface AccountQuickPickItem extends vscode.QuickPickItem {
    account?: vscode.AuthenticationSessionAccountInformation;
    isSignInOption?: boolean;
    isLearnMoreOption?: boolean;
    isExitOption?: boolean;
}

export class SelectAccountStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        // Create async function to provide better loading UX and debugging experience
        const getAccountQuickPickItems = async (): Promise<AccountQuickPickItem[]> => {
            const loadStartTime = Date.now();

            const accounts = await this.getAvailableAccounts(context);
            context.availableAccounts = accounts;

            // Add telemetry for account availability
            context.telemetry.measurements.availableAccountsCount = accounts.length;
            context.telemetry.measurements.accountsLoadingTimeMs = Date.now() - loadStartTime;

            const accountItems: AccountQuickPickItem[] = accounts.map((account) => ({
                label: account.label,
                iconPath: new vscode.ThemeIcon('account'),
                account,
            }));

            // Handle empty accounts case
            if (accountItems.length === 0) {
                context.telemetry.properties.noAccountsAvailable = 'true';
                return [
                    {
                        label: l10n.t('Sign in to Azure to continue…'),
                        detail: l10n.t('DocumentDB for VS Code is not signed in to Azure'),
                        iconPath: new vscode.ThemeIcon('sign-in'),
                        isSignInOption: true,
                    },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    {
                        label: l10n.t('Exit without making changes'),
                        iconPath: new vscode.ThemeIcon('close'),
                        isExitOption: true,
                    },
                ];
            }

            // Show signed-in accounts + option to add more
            return [
                ...accountItems,
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                {
                    label: l10n.t('Sign in with a different account…'),
                    iconPath: new vscode.ThemeIcon('sign-in'),
                    isSignInOption: true,
                },
                {
                    label: l10n.t('Exit without making changes'),
                    iconPath: new vscode.ThemeIcon('close'),
                    isExitOption: true,
                },
            ];
        };

        const selectedItem = await context.ui.showQuickPick(getAccountQuickPickItems(), {
            stepName: 'selectAccount',
            placeHolder: l10n.t('Azure accounts used for service discovery'),
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading Azure Accounts Used for Service Discovery…'),
        });

        // Add telemetry for account selection method
        if (selectedItem.isSignInOption) {
            context.telemetry.properties.accountSelectionMethod = 'signIn';

            await this.handleSignIn(context);

            // After successful sign-in, exit the wizard gracefully
            // No need to restart - the account has been added successfully
            throw new UserCancelledError('accountAddedSuccessfully');
        } else if (selectedItem.isExitOption) {
            context.telemetry.properties.accountSelectionMethod = 'exit';

            // User chose to exit - throw UserCancelledError to gracefully exit wizard
            throw new UserCancelledError('exitAccountManagement');
        } else {
            context.telemetry.properties.accountSelectionMethod = 'existingAccount';
        }

        context.selectedAccount = nonNullValue(selectedItem.account, 'selectedItem.account', 'SelectAccountStep.ts');
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        return !context.selectedAccount;
    }

    private async getAvailableAccounts(
        context: CredentialsManagementWizardContext,
    ): Promise<vscode.AuthenticationSessionAccountInformation[]> {
        try {
            // Get all tenants which include the accounts
            const tenants = await context.azureSubscriptionProvider.getTenants();

            // Extract unique accounts from tenants
            const accounts = tenants.map((tenant) => tenant.account);
            const uniqueAccounts = accounts.filter(
                (account, index, self) => index === self.findIndex((a) => a.id === account.id),
            );

            return uniqueAccounts.sort((a, b) => a.label.localeCompare(b.label));
        } catch (error) {
            ext.outputChannel.appendLine(
                l10n.t(
                    'Failed to retrieve Azure accounts: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
            return [];
        }
    }

    private async handleSignIn(context: CredentialsManagementWizardContext): Promise<void> {
        try {
            ext.outputChannel.appendLine(l10n.t('Starting Azure sign-in process…'));
            const success = await context.azureSubscriptionProvider.signIn();
            if (success) {
                ext.outputChannel.appendLine(l10n.t('Azure sign-in completed successfully'));
            } else {
                ext.outputChannel.appendLine(l10n.t('Azure sign-in was cancelled or failed'));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.appendLine(l10n.t('Azure sign-in failed: {0}', errorMessage));
            throw error;
        }
    }
}
