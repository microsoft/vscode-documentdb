/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { QuickPickItemKind, ThemeIcon, Uri, window, type MessageItem, type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../../extensionVariables';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';
import { getDuplicateSubscriptions, getTenantFilteredSubscriptions } from '../subscriptionFiltering';
import { AzureContextProperties } from './AzureContextProperties';

export class SelectSubscriptionStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    iconPath = Uri.joinPath(
        ext.context.extensionUri,
        'resources',
        'from_node_modules',
        '@microsoft',
        'vscode-azext-azureutils',
        'resources',
        'azureSubscription.svg',
    );

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (
            context.properties[AzureContextProperties.AzureSubscriptionProvider] === undefined ||
            !(
                context.properties[AzureContextProperties.AzureSubscriptionProvider] instanceof
                VSCodeAzureSubscriptionProvider
            )
        ) {
            throw new Error('ServiceDiscoveryProvider is not set or is not of the correct type.');
        }

        const subscriptionProvider = context.properties[
            AzureContextProperties.AzureSubscriptionProvider
        ] as VSCodeAzureSubscriptionProvider;

        /**
         * This is an important step to ensure that the user is signed in to Azure before listing subscriptions.
         */
        if (!(await subscriptionProvider.isSignedIn())) {
            const signIn: MessageItem = { title: l10n.t('Sign In') };
            void window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
                .then((input) => {
                    if (input === signIn) {
                        void subscriptionProvider.signIn();
                    }
                });

            throw new UserCancelledError(l10n.t('User is not signed in to Azure.'));
        }

        // Store subscriptions outside the async function so we can access them later
        let subscriptions!: Awaited<ReturnType<typeof subscriptionProvider.getSubscriptions>>;

        // Create async function to provide better loading UX and debugging experience
        const getSubscriptionQuickPickItems = async (): Promise<(QuickPickItem & { id: string })[]> => {
            const allSubscriptions = await subscriptionProvider.getSubscriptions(false);
            subscriptions = getTenantFilteredSubscriptions(allSubscriptions);

            // This information is extracted to improve the UX, that's why there are fallbacks to 'undefined'
            // Note to future maintainers: we used to run getSubscriptions and getTenants "in parallel", however
            // this lead to incorrect responses from getSubscriptions. We didn't investigate
            const tenantPromise = subscriptionProvider.getTenants().catch(() => undefined);
            const timeoutPromise = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000));
            const knownTenants = await Promise.race([tenantPromise, timeoutPromise]);

            // Build tenant display name lookup for better UX
            const tenantDisplayNames = new Map<string, string>();

            if (knownTenants) {
                for (const tenant of knownTenants) {
                    if (tenant.tenantId && tenant.displayName) {
                        tenantDisplayNames.set(tenant.tenantId, tenant.displayName);
                    }
                }
            }

            // Check for empty state first
            if (subscriptions.length === 0) {
                // Show modal dialog for empty state
                const configureResult = await this.askToConfigureCredentials();
                if (configureResult === 'configure') {
                    await this.configureCredentialsFromWizard(context, subscriptionProvider);
                    await this.showRetryInstructions();
                }
                // Both paths abort the wizard
                throw new UserCancelledError('No subscriptions available');
            }

            // Use duplicate detection logic from subscriptionFiltering
            const duplicates = getDuplicateSubscriptions(subscriptions);

            const subscriptionItems = subscriptions
                .map((subscription) => {
                    const tenantName = tenantDisplayNames.get(subscription.tenantId);

                    // Handle duplicate subscription names by adding account label
                    const label = duplicates.includes(subscription)
                        ? `${subscription.name} (${subscription.account?.label})`
                        : subscription.name;

                    // Build description with tenant information
                    const description = tenantName
                        ? `${subscription.subscriptionId} (${tenantName})`
                        : subscription.subscriptionId;

                    return {
                        id: subscription.subscriptionId,
                        label,
                        description,
                        iconPath: this.iconPath,
                        alwaysShow: true,
                    };
                })
                .sort((a, b) => a.label.localeCompare(b.label));

            // Add edit entry at the top
            return [
                {
                    id: 'editAccountsAndTenants',
                    label: l10n.t('Sign in to other Azure accounts or tenants to access more subscriptions'),
                    iconPath: new ThemeIcon('key'),
                    alwaysShow: true,
                },
                { id: 'separator', label: '', kind: QuickPickItemKind.Separator },
                ...subscriptionItems,
            ];
        };

        const selectedItem = await context.ui.showQuickPick(getSubscriptionQuickPickItems(), {
            stepName: 'selectSubscription',
            placeHolder: l10n.t('Choose a Subscription…'),
            loadingPlaceHolder: l10n.t('Loading Subscriptions…'),
            enableGrouping: false,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        // Handle edit accounts and tenants selection
        if (selectedItem.id === 'editAccountsAndTenants') {
            await this.configureCredentialsFromWizard(context, subscriptionProvider);
            await this.showRetryInstructions();

            // Exit wizard - user needs to restart service discovery
            throw new UserCancelledError('Account and tenant filters updated');
        }

        // Use the subscriptions we already loaded (no second API call needed)
        context.properties[AzureContextProperties.SelectedSubscription] = subscriptions.find(
            (subscription) => subscription.subscriptionId === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async askToConfigureCredentials(): Promise<'configure' | 'cancel'> {
        const configure = l10n.t('Yes, Configure Credentials');

        const result = await window.showInformationMessage(
            l10n.t('No Azure Subscriptions Found'),
            {
                modal: true,
                detail: l10n.t(
                    'To connect to Azure resources, you need to configure your Azure credentials and tenant access.\n\n' +
                        'Would you like to configure your Azure credentials now?',
                ),
            },
            { title: configure },
        );

        return result?.title === configure ? 'configure' : 'cancel';
    }

    private async configureCredentialsFromWizard(
        context: NewConnectionWizardContext,
        subscriptionProvider: VSCodeAzureSubscriptionProvider,
    ): Promise<void> {
        // Add telemetry for credential configuration activation
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.nodeProvided = 'false';

        // Call the credentials management function directly using the subscription provider from context
        // The subscription provider in the wizard context is actually AzureSubscriptionProviderWithFilters
        const { configureAzureCredentials } = await import('../credentialsManagement');
        await configureAzureCredentials(
            context,
            subscriptionProvider as AzureSubscriptionProviderWithFilters,
            undefined,
        );
    }

    private async showRetryInstructions(): Promise<void> {
        await window.showInformationMessage(
            l10n.t('Credential Management Completed'),
            {
                modal: true,
                detail: l10n.t(
                    'The credential management flow has completed.\n\nPlease try Service Discovery again to see your available subscriptions.',
                ),
            },
            l10n.t('OK'),
        );
    }
}
