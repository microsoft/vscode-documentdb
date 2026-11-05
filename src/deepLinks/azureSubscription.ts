/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { type AzureSubscriptionProviderWithFilters } from '../plugins/api-shared/azure/AzureSubscriptionProviderWithFilters';
import { isTenantFilteredOut } from '../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers';
import { DiscoveryService } from '../services/discoveryServices';

/** A discovery provider that lists Azure subscriptions. Both Azure Mongo providers satisfy it. */
export interface AzureSubscriptionDiscoveryProvider {
    readonly azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;
}

export interface AzureSubscriptionRequest {
    readonly providerId: string;
    readonly subscriptionId: string;
    readonly tenantId?: string;
    /** Resource name from the link, for messages only. */
    readonly resourceName: string;
}

function isAzureSubscriptionDiscoveryProvider(provider: unknown): provider is AzureSubscriptionDiscoveryProvider {
    return (
        typeof provider === 'object' &&
        provider !== null &&
        'azureSubscriptionProvider' in provider &&
        provider.azureSubscriptionProvider !== undefined &&
        provider.azureSubscriptionProvider !== null
    );
}

/** Returns the subscription, or undefined when the user cancelled a sign-in prompt. Throws when it cannot be resolved. */
export async function resolveAzureSubscription(
    context: IActionContext,
    request: AzureSubscriptionRequest,
    report?: (message: string) => void,
): Promise<AzureSubscription | undefined> {
    context.telemetry.properties.failureStage = 'azureSignIn';
    const provider = DiscoveryService.getProvider(request.providerId);
    if (!isAzureSubscriptionDiscoveryProvider(provider)) {
        throw new Error(vscode.l10n.t('Azure discovery is not available.'));
    }

    const { azureSubscriptionProvider } = provider;
    ext.outputChannel.trace('[DeepLink] Checking Azure sign-in');
    report?.(vscode.l10n.t('Checking Azure sign-in…'));
    const isSignedIn = await azureSubscriptionProvider.isSignedIn();
    ext.outputChannel.trace(`[DeepLink] Azure sign-in: ${isSignedIn ? 'signed in' : 'sign-in required'}`);
    context.telemetry.properties.azureSignInRequired = isSignedIn ? 'false' : 'true';
    if (!isSignedIn) {
        const signInButton = vscode.l10n.t('Sign in');
        ext.outputChannel.trace('[DeepLink] Showing Azure sign-in confirmation');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Sign in'),
            { modal: true, detail: vscode.l10n.t('Sign in to Azure to open {0}.', request.resourceName) },
            signInButton,
        );
        ext.outputChannel.trace(`[DeepLink] Azure sign-in confirmation: ${choice === signInButton ? 'accepted' : 'dismissed'}`);
        if (choice !== signInButton || !(await azureSubscriptionProvider.signIn())) {
            ext.outputChannel.trace('[DeepLink] Azure sign-in stopped');
            context.telemetry.properties.userCancelledAtStep = 'AzureSignIn';
            return undefined;
        }
        ext.outputChannel.trace('[DeepLink] Azure sign-in: signed in');
    }

    context.telemetry.properties.failureStage = 'resolveSubscription';
    context.telemetry.properties.tenantSignInRequired = 'false';
    for (let attempt = 0; attempt < 2; attempt++) {
        ext.outputChannel.trace('[DeepLink] Listing subscriptions');
        report?.(vscode.l10n.t('Looking for the subscription in your Azure accounts…'));
        const subscriptions = await azureSubscriptionProvider.getSubscriptions(false);
        const candidates = subscriptions.filter(
            (subscription) =>
                subscription.subscriptionId.toLowerCase() === request.subscriptionId.toLowerCase() &&
                (request.tenantId === undefined || subscription.tenantId.toLowerCase() === request.tenantId.toLowerCase()),
        );
        ext.outputChannel.trace(`[DeepLink] ${candidates.length} matching subscription(s) found`);
        context.telemetry.properties.subscriptionAccountCount = String(candidates.length);
        const subscription =
            candidates.find((candidate) => !isTenantFilteredOut(candidate.tenantId, candidate.account.id)) ?? candidates[0];
        if (subscription) {
            return subscription;
        }

        if (attempt > 0 || request.tenantId === undefined) {
            break;
        }

        context.telemetry.properties.tenantSignInRequired = 'true';
        ext.outputChannel.trace('[DeepLink] Tenant sign-in offered');
        const signInButton = vscode.l10n.t('Sign in to tenant');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Sign in to tenant'),
            {
                modal: true,
                detail: [
                    vscode.l10n.t(
                        'None of your signed-in Azure accounts can access subscription {0}.',
                        request.subscriptionId,
                    ),
                    vscode.l10n.t('The link names tenant {0}. Sign in to that tenant to continue.', request.tenantId),
                ].join('\n'),
            },
            signInButton,
        );
        ext.outputChannel.trace(`[DeepLink] Tenant sign-in ${choice === signInButton ? 'chosen' : 'dismissed'}`);
        if (choice !== signInButton) {
            context.telemetry.properties.userCancelledAtStep = 'AzureTenantSignIn';
            return undefined;
        }
        report?.(vscode.l10n.t('Signing in to tenant…'));
        await azureSubscriptionProvider.signIn(request.tenantId);
    }

    ext.outputChannel.trace('[DeepLink] Subscription not found');
    context.errorHandling.buttons = [
        {
            title: vscode.l10n.t('Manage Azure accounts'),
            callback: async (): Promise<void> => {
                await callWithTelemetryAndErrorHandling('globalUriHandler.manageAzureAccounts', async (ctx): Promise<void> => {
                    await provider.configureCredentials?.(ctx);
                });
            },
        },
    ];
    throw new Error(
        vscode.l10n.t('None of your signed-in Azure accounts can access subscription {0}.', request.subscriptionId),
    );
}
