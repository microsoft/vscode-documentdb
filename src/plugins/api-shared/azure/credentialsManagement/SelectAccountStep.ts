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
}

export class SelectAccountStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        // Get all authenticated accounts
        const accounts = await this.getAvailableAccounts(context);
        context.availableAccounts = accounts;

        // Create quick pick items
        const accountItems: AccountQuickPickItem[] = this.createAccountPickItems(accounts);

        // Add separator and additional options
        const separatorItems: AccountQuickPickItem[] = [
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('$(plus) Sign in with a different account'),
                detail: l10n.t('Add a new Azure account to VS Code'),
                isSignInOption: true,
            },
            {
                label: l10n.t('$(question) Learn More'),
                detail: l10n.t('Learn more about Azure authentication in VS Code'),
                isLearnMoreOption: true,
            },
        ];

        const allItems = [...accountItems, ...separatorItems];

        const selectedItem = await context.ui.showQuickPick(allItems, {
            stepName: 'selectAccount',
            placeHolder: l10n.t('Select an Azure account'),
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: 'Loading...',
        });

        if (selectedItem.isSignInOption) {
            await this.handleSignIn(context);
            // Set flag to restart wizard after sign-in
            context.shouldRestartWizard = true;
            context.newAccountSignedIn = true;
            throw new UserCancelledError(l10n.t('Restarting wizard after sign-in'));
        } else if (selectedItem.isLearnMoreOption) {
            await this.handleLearnMore();
            throw new UserCancelledError(l10n.t('User selected learn more'));
        } else {
            context.selectedAccount = nonNullValue(
                selectedItem.account,
                'selectedItem.account',
                'SelectAccountStep.ts',
            );
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        return !context.selectedAccount && !context.shouldRestartWizard;
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

    private createAccountPickItems(accounts: vscode.AuthenticationSessionAccountInformation[]): AccountQuickPickItem[] {
        if (accounts.length === 0) {
            return [
                {
                    label: l10n.t('No Azure accounts found'),
                    detail: l10n.t('Sign in to Azure to continue'),
                    picked: true,
                    isSignInOption: true,
                },
            ];
        }

        return accounts.map((account) => ({
            label: account.label,
            description: account.id,
            iconPath: new vscode.ThemeIcon('account'),
            account,
        }));
    }

    private async handleSignIn(context: CredentialsManagementWizardContext): Promise<void> {
        try {
            ext.outputChannel.appendLine(l10n.t('Starting Azure sign-in process...'));
            const success = await context.azureSubscriptionProvider.signIn();

            if (success) {
                ext.outputChannel.appendLine(l10n.t('Azure sign-in completed successfully'));
                // Refresh discovery tree to reflect new authentication
                ext.discoveryBranchDataProvider.refresh();
            } else {
                ext.outputChannel.appendLine(l10n.t('Azure sign-in was cancelled or failed'));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.appendLine(l10n.t('Azure sign-in failed: {0}', errorMessage));
            void vscode.window.showErrorMessage(l10n.t('Failed to sign in to Azure: {0}', errorMessage));
            throw error;
        }
    }

    private async handleLearnMore(): Promise<void> {
        const learnMoreUrl =
            'https://docs.microsoft.com/en-us/azure/developer/javascript/tutorial-vscode-azure-cli-node-01';
        await vscode.env.openExternal(vscode.Uri.parse(learnMoreUrl));
    }
}
