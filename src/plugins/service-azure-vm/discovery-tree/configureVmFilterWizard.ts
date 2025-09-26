/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription, type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    AzureWizard,
    AzureWizardPromptStep,
    UserCancelledError,
    type IActionContext,
    type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import {
    getDuplicateSubscriptions,
    getSelectedSubscriptionIds,
    getTenantFilteredSubscriptions,
    setSelectedSubscriptionIds,
} from '../../api-shared/azure/subscriptionFiltering/subscriptionFiltering';

export interface ConfigureVmFilterWizardContext extends IActionContext {
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider;
}

class SubscriptionFilterStep extends AzureWizardPromptStep<ConfigureVmFilterWizardContext> {
    public async prompt(context: ConfigureVmFilterWizardContext): Promise<void> {
        const azureSubscriptionProvider = context.azureSubscriptionProvider;

        if (!(await azureSubscriptionProvider.isSignedIn())) {
            const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
            void vscode.window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
                .then(async (input) => {
                    if (input === signIn) {
                        await azureSubscriptionProvider.signIn();
                        ext.discoveryBranchDataProvider.refresh();
                    }
                });

            throw new UserCancelledError(l10n.t('User is not signed in to Azure.'));
        }

        const selectedSubscriptionIds = getSelectedSubscriptionIds();

        const subscriptionQuickPickItemsProvider: () => Promise<
            IAzureQuickPickItem<AzureSubscription>[]
        > = async () => {
            const allSubscriptions = await azureSubscriptionProvider.getSubscriptions(false); // Get all unfiltered subscriptions
            const subscriptions = getTenantFilteredSubscriptions(allSubscriptions); // Apply tenant filtering
            const duplicates = getDuplicateSubscriptions(subscriptions);

            return subscriptions
                .map(
                    (subscription) =>
                        <IAzureQuickPickItem<AzureSubscription>>{
                            label: duplicates.includes(subscription)
                                ? subscription.name + ` (${subscription.account?.label})`
                                : subscription.name,
                            description: subscription.subscriptionId,
                            data: subscription,
                            group: subscription.account.label,
                            iconPath: vscode.Uri.joinPath(
                                ext.context.extensionUri,
                                'resources',
                                'from_node_modules',
                                '@microsoft',
                                'vscode-azext-azureutils',
                                'resources',
                                'azureSubscription.svg',
                            ),
                        },
                )
                .sort((a, b) => a.label.localeCompare(b.label));
        };

        const picks = await context.ui.showQuickPick(subscriptionQuickPickItemsProvider(), {
            canPickMany: true,
            placeHolder: l10n.t('Select Subscriptions to Display'),
            isPickSelected: (pick) => {
                return (
                    selectedSubscriptionIds.length === 0 ||
                    selectedSubscriptionIds.includes(
                        (pick as IAzureQuickPickItem<AzureSubscription>).data.subscriptionId,
                    )
                );
            },
            suppressPersistence: true, // Recommended for multi-step wizards
        });

        if (picks !== undefined) {
            // User made a choice (could be an empty array if they deselected all)
            const newSelectedIds = picks.map((pick) => `${pick.data.tenantId}/${pick.data.subscriptionId}`);
            await setSelectedSubscriptionIds(newSelectedIds);
            context.telemetry.properties.subscriptionsConfigured = 'true';
            context.telemetry.properties.subscriptionCount = String(newSelectedIds.length);
        } else {
            // User cancelled the quick pick (e.g., pressed Esc)
            context.telemetry.properties.subscriptionsConfigured = 'cancelled';
            // Do not change existing selection if cancelled
        }
    }

    public shouldPrompt(_context: ConfigureVmFilterWizardContext): boolean {
        return true; // Always show this step
    }
}

class TagFilterStep extends AzureWizardPromptStep<ConfigureVmFilterWizardContext> {
    public async prompt(context: ConfigureVmFilterWizardContext): Promise<void> {
        const defaultTag = ext.context.globalState.get<string>('azure-vm-discovery.tag', 'DocumentDB');

        const result = await context.ui.showInputBox({
            prompt: l10n.t('Enter the Azure VM tag to filter by'),
            value: defaultTag,
            placeHolder: l10n.t('e.g., DocumentDB, Environment, Project'),
            validateInput: (value: string) => {
                if (!value) {
                    return l10n.t('Tag cannot be empty.');
                }
                if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
                    return l10n.t('Tag can only contain alphanumeric characters, underscores, periods, and hyphens.');
                }
                if (value.length > 256) {
                    return l10n.t('Tag cannot be longer than 256 characters.');
                }
                return undefined;
            },
        });

        if (result !== undefined) {
            // Input box returns undefined if cancelled
            await ext.context.globalState.update('azure-vm-discovery.tag', result);
            context.telemetry.properties.tagConfigured = 'true';
            context.telemetry.properties.tagValue = result;
        } else {
            context.telemetry.properties.tagConfigured = 'cancelled';
            // Do not change existing tag if cancelled
        }
    }

    public shouldPrompt(_context: ConfigureVmFilterWizardContext): boolean {
        return true; // Always show this step
    }
}

export async function configureVmFilter(
    baseContext: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
): Promise<void> {
    const wizardContext: ConfigureVmFilterWizardContext = {
        ...baseContext,
        azureSubscriptionProvider: azureSubscriptionProvider,
        telemetry: {
            // Ensure telemetry object and its properties are initialized
            properties: { ...(baseContext.telemetry?.properties || {}) },
            measurements: { ...(baseContext.telemetry?.measurements || {}) },
            suppressIfSuccessful: baseContext.telemetry?.suppressIfSuccessful || false,
            suppressAll: baseContext.telemetry?.suppressAll || false,
        },
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Configure Azure VM Discovery Filters'),
        promptSteps: [new SubscriptionFilterStep(), new TagFilterStep()],
        executeSteps: [], // Configuration happens in prompt steps, no separate execution steps
    });

    await wizard.prompt();
    // Data is saved by the prompt steps themselves.
}
