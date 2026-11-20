/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import {
    ExtendedEnvironment,
    NotSignedInError,
    VSCodeAzureSubscriptionProvider,
    type AzureSubscription,
    type AzureTenant,
} from '@microsoft/vscode-azext-azureauth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { AzureSubscriptionProviderWithFilters } from './AzureSubscriptionProviderWithFilters';

vi.mock('../../../extensionVariables', () => ({ ext: { outputChannel: { warn: vi.fn() } } }));

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<typeof vscode>();
    return {
        ...actual,
        authentication: {
            ...actual.authentication,
            getAccounts: vi.fn(),
            onDidChangeSessions: vi.fn(() => ({ dispose: vi.fn() })),
        },
        workspace: {
            ...actual.workspace,
            onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
        },
    };
});

describe('AzureSubscriptionProviderWithFilters', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('bypasses the cache for one requested listing, not for routine listings', async () => {
        const baseListing = vi.spyOn(VSCodeAzureSubscriptionProvider.prototype, 'getAvailableSubscriptions');
        baseListing.mockResolvedValue([]);
        const provider = new AzureSubscriptionProviderWithFilters();
        const options = { filter: true, maximumTenants: Number.POSITIVE_INFINITY };

        await provider.getAvailableSubscriptions(options);
        provider.requestFreshListing();
        const explicit = provider.getAvailableSubscriptions(options);
        const routine = provider.getAvailableSubscriptions(options);
        await Promise.all([explicit, routine]);

        expect(baseListing.mock.calls).toEqual([[options], [{ ...options, noCache: true }], [options]]);
        expect(options).not.toHaveProperty('noCache');
        provider.dispose();
    });

    it('returns an empty list only for the SDK no-session error', async () => {
        const failure = new Error('ARM listing failed');
        vi.spyOn(VSCodeAzureSubscriptionProvider.prototype, 'getAvailableSubscriptions')
            .mockRejectedValueOnce(new NotSignedInError())
            .mockRejectedValueOnce(failure);
        const provider = new AzureSubscriptionProviderWithFilters();

        await expect(provider.getAvailableSubscriptions()).resolves.toEqual([]);
        await expect(provider.getAvailableSubscriptions()).rejects.toBe(failure);
        provider.dispose();
    });

    it.each(['cloud', 'session'] as const)('reloads cached accounts after a %s change', async (kind) => {
        const cloudListener = vi.mocked(vscode.workspace.onDidChangeConfiguration);
        const sessionListener = vi.mocked(vscode.authentication.onDidChangeSessions);
        const getAccounts = vi.mocked(vscode.authentication.getAccounts);
        cloudListener.mockClear();
        sessionListener.mockClear();
        getAccounts.mockClear();
        getAccounts.mockResolvedValue([{ id: 'fixture-account', label: 'Fixture account' }]);
        vi.useFakeTimers();
        const provider = new AzureSubscriptionProviderWithFilters();
        vi.spyOn(provider, 'getTenantsForAccount').mockResolvedValue([]);

        try {
            await provider.getAvailableSubscriptions({ filter: false });
            await provider.getAvailableSubscriptions({ filter: false });
            expect(getAccounts).toHaveBeenCalledOnce();

            if (kind === 'cloud') {
                cloudListener.mock.calls[0][0]({
                    affectsConfiguration: (section): boolean => section === 'microsoft-sovereign-cloud',
                });
            } else {
                // The SDK suppresses session events during and just after account enumeration.
                await vi.runOnlyPendingTimersAsync();
                sessionListener.mock.calls[0][0]({ provider: { id: 'microsoft', label: 'Microsoft' } });
            }

            await provider.getAvailableSubscriptions({ filter: false });
            expect(getAccounts).toHaveBeenCalledTimes(2);
        } finally {
            provider.dispose();
            vi.useRealTimers();
        }

        expect(cloudListener.mock.results[0].value.dispose).toHaveBeenCalledOnce();
        expect(sessionListener.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    });

    it('keeps subscriptions beyond ten tenants and emits only bounded warnings for skipped failures', async () => {
        const provider = new AzureSubscriptionProviderWithFilters();
        const environment = new ExtendedEnvironment(Environment.AzureCloud, false);
        const account = { id: 'private-account-id', label: 'private-account-label', environment };
        const failedAccount = { ...account, id: 'failed-account-id' };
        const tenants: AzureTenant[] = Array.from({ length: 11 }, (_, index) => ({
            account,
            tenantId: `private-tenant-${index}`,
        }));
        const subscription: AzureSubscription = {
            account,
            authentication: { getSession: vi.fn(), getSessionWithScopes: vi.fn() },
            credential: { getToken: vi.fn() },
            environment,
            isCustomCloud: false,
            name: 'Private subscription',
            subscriptionId: 'private-subscription-id',
            tenantId: tenants[10].tenantId,
        };
        const failure = new Error('ARM error with private details');
        vi.spyOn(provider, 'getAccounts').mockResolvedValue([account, failedAccount]);
        vi.spyOn(provider, 'getTenantsForAccount').mockImplementation(async (requestedAccount) => {
            if (requestedAccount === failedAccount) {
                throw failure;
            }
            return tenants;
        });
        const getSubscriptionsForTenant = vi
            .spyOn(provider, 'getSubscriptionsForTenant')
            .mockImplementation(async ({ tenantId }) => {
                switch (tenantId) {
                    case tenants[0].tenantId:
                        throw failure;
                    case tenants[1].tenantId:
                        throw new NotSignedInError();
                    case subscription.tenantId:
                        return [subscription];
                    default:
                        return [];
                }
            });

        await expect(
            provider.getAvailableSubscriptions({ filter: false, maximumTenants: Number.POSITIVE_INFINITY }),
        ).resolves.toEqual([subscription]);

        expect(getSubscriptionsForTenant).toHaveBeenCalledTimes(11);
        const warnings = vi.mocked(ext.outputChannel.warn).mock.calls;
        expect(warnings).toHaveLength(2);
        expect(warnings).toEqual(
            expect.arrayContaining([
                ['Skipped an Azure account because its tenants could not be listed.'],
                ['Skipped an Azure tenant because its subscriptions could not be listed.'],
            ]),
        );
        provider.dispose();
    });
});
