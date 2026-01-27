/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { nonNullProp, nonNullValue } from '../../../../utils/nonNull';
import {
    type AccountWithTenantInfo,
    type CredentialsManagementWizardContext,
    type TenantWithSignInStatus,
} from './CredentialsManagementWizardContext';

interface AccountQuickPickItem extends vscode.QuickPickItem {
    account?: vscode.AuthenticationSessionAccountInformation;
    isSignInOption?: boolean;
    isLearnMoreOption?: boolean;
    isExitOption?: boolean;
}

export class SelectAccountStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        // Create async function to provide loading UX
        const getAccountQuickPickItems = async (): Promise<AccountQuickPickItem[]> => {
            // Use cached data when navigating back, otherwise fetch
            // Note: allAccountsWithTenantInfo is initialized with [] in wizard context creation
            // so it's captured in propertiesBeforePrompt and survives back navigation
            // (AzureWizard filters out null/undefined values when capturing propertiesBeforePrompt)
            if (context.allAccountsWithTenantInfo.length === 0) {
                const loadStartTime = Date.now();
                context.allAccountsWithTenantInfo = await this.getAccountsWithTenantInfo(context);
                context.telemetry.measurements.accountsLoadingTimeMs = Date.now() - loadStartTime;
            }

            const accountsWithInfo = context.allAccountsWithTenantInfo;
            context.telemetry.measurements.initialAccountCount = accountsWithInfo.length;

            const accountItems: AccountQuickPickItem[] = accountsWithInfo.map((info) => {
                const totalTenants = info.tenantsWithStatus.length;
                const signedInCount = info.tenantsWithStatus.filter((t) => t.isSignedIn).length;

                let detail: string;
                if (totalTenants === 0) {
                    detail = l10n.t('No tenants available');
                } else if (totalTenants === 1) {
                    detail =
                        signedInCount === 1
                            ? l10n.t('1 tenant available (1 signed in)')
                            : l10n.t('1 tenant available (0 signed in)');
                } else {
                    detail = l10n.t(
                        '{0} tenants available ({1} signed in)',
                        totalTenants.toString(),
                        signedInCount.toString(),
                    );
                }

                return {
                    label: info.account.label,
                    detail,
                    iconPath: new vscode.ThemeIcon('account'),
                    account: info.account,
                };
            });

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
                        label: l10n.t('Exit'),
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
                    label: l10n.t('Exit'),
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

    private async getAccountsWithTenantInfo(
        context: CredentialsManagementWizardContext,
    ): Promise<AccountWithTenantInfo[]> {
        try {
            // Get all tenants which include the accounts
            const tenants = await context.azureSubscriptionProvider.getTenants();

            // Check sign-in status for all tenants in parallel
            const knownTenantsWithStatus: TenantWithSignInStatus[] = await Promise.all(
                tenants.map(async (tenant) => {
                    const tenantId = nonNullProp(tenant, 'tenantId', 'tenant.tenantId', 'SelectAccountStep.ts');
                    const isSignedIn = await context.azureSubscriptionProvider.isSignedIn(tenantId, tenant.account);
                    return { tenant, isSignedIn };
                }),
            );

            // Group tenants by account
            const accountMap = new Map<string, AccountWithTenantInfo>();

            for (const tenantWithStatus of knownTenantsWithStatus) {
                const accountId = tenantWithStatus.tenant.account.id;
                if (!accountMap.has(accountId)) {
                    accountMap.set(accountId, {
                        account: tenantWithStatus.tenant.account,
                        tenantsWithStatus: [],
                    });
                }
                const info = accountMap.get(accountId)!;
                info.tenantsWithStatus.push(tenantWithStatus);
            }

            return Array.from(accountMap.values()).sort((a, b) =>
                a.account.label.localeCompare(b.account.label, undefined, { numeric: true }),
            );
        } catch (error) {
            ext.outputChannel.error(
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
            ext.outputChannel.info(l10n.t('Starting Azure sign-in process…'));
            const success = await context.azureSubscriptionProvider.signIn();
            if (success) {
                ext.outputChannel.info(l10n.t('Azure sign-in completed successfully'));
            } else {
                ext.outputChannel.warn(l10n.t('Azure sign-in was cancelled or failed'));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(l10n.t('Azure sign-in failed: {0}', errorMessage));
            throw error;
        }
    }
}
