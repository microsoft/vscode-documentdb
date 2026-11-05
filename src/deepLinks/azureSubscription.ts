/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
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
): Promise<AzureSubscription | undefined> {
    context.telemetry.properties.failureStage = 'azureSignIn';
    const provider = DiscoveryService.getProvider(request.providerId);
    if (!isAzureSubscriptionDiscoveryProvider(provider)) {
        throw new Error(vscode.l10n.t('Azure discovery is not available.'));
    }

    const { azureSubscriptionProvider } = provider;
    const isSignedIn = await azureSubscriptionProvider.isSignedIn();
    context.telemetry.properties.azureSignInRequired = isSignedIn ? 'false' : 'true';
    if (!isSignedIn) {
        const signInButton = vscode.l10n.t('Sign in');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Sign in to Azure to open {0}.', request.resourceName),
            { modal: true },
            signInButton,
        );
        if (choice !== signInButton || !(await azureSubscriptionProvider.signIn())) {
            context.telemetry.properties.userCancelledAtStep = 'AzureSignIn';
            return undefined;
        }
    }

    context.telemetry.properties.failureStage = 'resolveSubscription';
    context.telemetry.properties.tenantSignInRequired = 'false';
    for (let attempt = 0; attempt < 2; attempt++) {
        const subscriptions = await azureSubscriptionProvider.getSubscriptions(false);
        const candidates = subscriptions.filter(
            (subscription) =>
                subscription.subscriptionId.toLowerCase() === request.subscriptionId.toLowerCase() &&
                (request.tenantId === undefined || subscription.tenantId.toLowerCase() === request.tenantId.toLowerCase()),
        );
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
        const signInButton = vscode.l10n.t('Sign in to tenant');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('None of your signed-in Azure accounts can access subscription {0}.', request.subscriptionId),
            {
                modal: true,
                detail: vscode.l10n.t('The link names tenant {0}. Sign in to that tenant to continue.', request.tenantId),
            },
            signInButton,
        );
        if (choice !== signInButton) {
            context.telemetry.properties.userCancelledAtStep = 'AzureTenantSignIn';
            return undefined;
        }
        await azureSubscriptionProvider.signIn(request.tenantId);
    }

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
