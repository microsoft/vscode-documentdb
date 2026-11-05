/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { type AzureSubscriptionProviderWithFilters } from '../plugins/api-shared/azure/AzureSubscriptionProviderWithFilters';
import { isTenantFilteredOut } from '../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers';
import { DiscoveryService } from '../services/discoveryServices';
import { resolveAzureSubscription, type AzureSubscriptionRequest } from './azureSubscription';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('../services/discoveryServices', () => ({
    DiscoveryService: { getProvider: vi.fn() },
}));
vi.mock('../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers', () => ({
    isTenantFilteredOut: vi.fn(),
}));

const azureSubscriptionProvider = {
    isSignedIn: vi.fn<AzureSubscriptionProviderWithFilters['isSignedIn']>(),
    signIn: vi.fn<AzureSubscriptionProviderWithFilters['signIn']>(),
    getSubscriptions: vi.fn<AzureSubscriptionProviderWithFilters['getSubscriptions']>(),
};

const provider = {
    azureSubscriptionProvider,
    configureCredentials: vi.fn<(context: IActionContext) => Promise<void>>(),
};

const request: AzureSubscriptionRequest = {
    providerId: 'azure-provider',
    subscriptionId: 'Subscription-ID',
    resourceName: 'linked-resource',
};

function subscription(tenantId: string, accountId: string, subscriptionId = 'subscription-id'): AzureSubscription {
    return {
        subscriptionId,
        tenantId,
        account: { id: accountId, label: accountId },
    } as AzureSubscription;
}

let context: IActionContext;

beforeEach((): void => {
    vi.resetAllMocks();
    context = {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
    } as IActionContext;
    (DiscoveryService.getProvider as Mock).mockReturnValue(provider);
    (callWithTelemetryAndErrorHandling as Mock).mockImplementation(
        async (_eventName: string, callback: (ctx: IActionContext) => Promise<void>): Promise<void> => {
            await callback(context);
        },
    );
    provider.configureCredentials.mockResolvedValue(undefined);
    azureSubscriptionProvider.isSignedIn.mockResolvedValue(true);
    azureSubscriptionProvider.signIn.mockResolvedValue(true);
    azureSubscriptionProvider.getSubscriptions.mockResolvedValue([]);
    vi.mocked(isTenantFilteredOut).mockReturnValue(false);
});

describe('resolveAzureSubscription', (): void => {
    it('prompts a signed-out user, signs in, and resolves an unfiltered subscription', async (): Promise<void> => {
        const found = subscription('tenant-id', 'account-id');
        azureSubscriptionProvider.isSignedIn.mockResolvedValue(false);
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([found]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Sign in');

        await expect(resolveAzureSubscription(context, request)).resolves.toBe(found);

        expect(DiscoveryService.getProvider).toHaveBeenCalledWith(request.providerId);
        expect(azureSubscriptionProvider.isSignedIn).toHaveBeenCalledWith();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Sign in to Azure to open linked-resource.',
            { modal: true },
            'Sign in',
        );
        expect(azureSubscriptionProvider.signIn).toHaveBeenCalledWith();
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenCalledExactlyOnceWith(false);
        expect(context.telemetry.properties).toEqual({
            failureStage: 'resolveSubscription',
            azureSignInRequired: 'true',
            tenantSignInRequired: 'false',
            subscriptionAccountCount: '1',
        });
    });

    it('returns undefined without listing subscriptions when the Azure sign-in prompt is dismissed', async (): Promise<void> => {
        azureSubscriptionProvider.isSignedIn.mockResolvedValue(false);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await expect(resolveAzureSubscription(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties).toEqual({
            failureStage: 'azureSignIn',
            azureSignInRequired: 'true',
            userCancelledAtStep: 'AzureSignIn',
        });
        expect(azureSubscriptionProvider.signIn).not.toHaveBeenCalled();
        expect(azureSubscriptionProvider.getSubscriptions).not.toHaveBeenCalled();
    });

    it('treats a false Azure sign-in result as cancellation', async (): Promise<void> => {
        azureSubscriptionProvider.isSignedIn.mockResolvedValue(false);
        azureSubscriptionProvider.signIn.mockResolvedValue(false);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Sign in');

        await expect(resolveAzureSubscription(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureSignIn');
        expect(context.telemetry.properties.failureStage).toBe('azureSignIn');
        expect(azureSubscriptionProvider.getSubscriptions).not.toHaveBeenCalled();
    });

    it('uses the case-insensitive tenant hint to select between accounts sharing a subscription ID', async (): Promise<void> => {
        const otherTenant = subscription('other-tenant', 'account-one');
        const hintedTenant = subscription('tenant-id', 'account-two');
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([otherTenant, hintedTenant]);

        await expect(resolveAzureSubscription(context, { ...request, tenantId: 'TENANT-ID' })).resolves.toBe(hintedTenant);

        expect(context.telemetry.properties).toEqual({
            failureStage: 'resolveSubscription',
            azureSignInRequired: 'false',
            tenantSignInRequired: 'false',
            subscriptionAccountCount: '1',
        });
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(azureSubscriptionProvider.signIn).not.toHaveBeenCalled();
    });

    it('prefers the first non-filtered account when there is no tenant hint', async (): Promise<void> => {
        const filtered = subscription('tenant-one', 'account-one');
        const visible = subscription('tenant-two', 'account-two');
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([filtered, visible]);
        vi.mocked(isTenantFilteredOut).mockImplementation((tenantId, accountId): boolean =>
            tenantId === filtered.tenantId && accountId === filtered.account.id,
        );

        await expect(resolveAzureSubscription(context, request)).resolves.toBe(visible);

        expect(isTenantFilteredOut).toHaveBeenNthCalledWith(1, filtered.tenantId, filtered.account.id);
        expect(isTenantFilteredOut).toHaveBeenNthCalledWith(2, visible.tenantId, visible.account.id);
        expect(context.telemetry.properties.subscriptionAccountCount).toBe('2');
    });

    it('falls back to the first candidate when all matching tenants are filtered out', async (): Promise<void> => {
        const first = subscription('tenant-one', 'account-one');
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([first, subscription('tenant-two', 'account-two')]);
        vi.mocked(isTenantFilteredOut).mockReturnValue(true);

        await expect(resolveAzureSubscription(context, request)).resolves.toBe(first);

        expect(context.telemetry.properties.subscriptionAccountCount).toBe('2');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('signs into the hinted tenant and retries unfiltered subscription resolution exactly once', async (): Promise<void> => {
        const found = subscription('tenant-id', 'account-id');
        azureSubscriptionProvider.getSubscriptions.mockResolvedValueOnce([]).mockResolvedValueOnce([found]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Sign in to tenant');

        await expect(resolveAzureSubscription(context, { ...request, tenantId: 'TENANT-ID' })).resolves.toBe(found);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            'None of your signed-in Azure accounts can access subscription Subscription-ID.',
            {
                modal: true,
                detail: 'The link names tenant TENANT-ID. Sign in to that tenant to continue.',
            },
            'Sign in to tenant',
        );
        expect(azureSubscriptionProvider.signIn).toHaveBeenCalledExactlyOnceWith('TENANT-ID');
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenCalledTimes(2);
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenNthCalledWith(1, false);
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenNthCalledWith(2, false);
        expect(context.telemetry.properties).toEqual({
            failureStage: 'resolveSubscription',
            azureSignInRequired: 'false',
            tenantSignInRequired: 'true',
            subscriptionAccountCount: '1',
        });
    });

    it('throws with a working Manage Azure accounts button when the tenant retry still cannot find the subscription', async (): Promise<void> => {
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([
            subscription('other-tenant', 'account-id'),
            subscription('tenant-id', 'account-id', 'different-subscription'),
        ]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Sign in to tenant');

        await expect(resolveAzureSubscription(context, { ...request, tenantId: 'tenant-id' })).rejects.toThrow(
            'None of your signed-in Azure accounts can access subscription Subscription-ID.',
        );

        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenCalledTimes(2);
        expect(azureSubscriptionProvider.signIn).toHaveBeenCalledExactlyOnceWith('tenant-id');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties).toEqual({
            failureStage: 'resolveSubscription',
            azureSignInRequired: 'false',
            tenantSignInRequired: 'true',
            subscriptionAccountCount: '0',
        });
        expect(context.errorHandling.buttons).toEqual([
            { title: 'Manage Azure accounts', callback: expect.any(Function) },
        ]);
        await context.errorHandling.buttons?.[0].callback();
        expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledExactlyOnceWith(
            'globalUriHandler.manageAzureAccounts',
            expect.any(Function),
        );
        expect(provider.configureCredentials).toHaveBeenCalledExactlyOnceWith(context);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('returns undefined when the tenant sign-in prompt is dismissed', async (): Promise<void> => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await expect(resolveAzureSubscription(context, { ...request, tenantId: 'tenant-id' })).resolves.toBeUndefined();

        expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureTenantSignIn');
        expect(context.telemetry.properties.tenantSignInRequired).toBe('true');
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenCalledTimes(1);
        expect(azureSubscriptionProvider.signIn).not.toHaveBeenCalled();
        expect(context.errorHandling.buttons).toBeUndefined();
    });

    it('throws without a tenant prompt when no subscription matches and there is no tenant hint', async (): Promise<void> => {
        azureSubscriptionProvider.getSubscriptions.mockResolvedValue([
            subscription('tenant-id', 'account-id', 'different-subscription'),
        ]);

        await expect(resolveAzureSubscription(context, request)).rejects.toThrow(
            'None of your signed-in Azure accounts can access subscription Subscription-ID.',
        );

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(azureSubscriptionProvider.signIn).not.toHaveBeenCalled();
        expect(azureSubscriptionProvider.getSubscriptions).toHaveBeenCalledExactlyOnceWith(false);
        expect(context.telemetry.properties.tenantSignInRequired).toBe('false');
        expect(context.telemetry.properties.subscriptionAccountCount).toBe('0');
        expect(context.errorHandling.buttons?.[0].title).toBe('Manage Azure accounts');
    });

    it.each([undefined, {}, { azureSubscriptionProvider: undefined }, { azureSubscriptionProvider: null }])(
        'throws when Azure discovery is unavailable (%j)',
        async (provider: unknown): Promise<void> => {
            (DiscoveryService.getProvider as Mock).mockReturnValue(provider);

            await expect(resolveAzureSubscription(context, request)).rejects.toThrow('Azure discovery is not available.');

            expect(context.telemetry.properties.failureStage).toBe('azureSignIn');
            expect(azureSubscriptionProvider.isSignedIn).not.toHaveBeenCalled();
            expect(azureSubscriptionProvider.getSubscriptions).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        },
    );
});
