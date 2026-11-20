/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import {
    AzureSubscriptionProviderBase,
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

    it('forces fresh account enumeration while preserving other account options', async () => {
        const baseAccounts = vi.spyOn(VSCodeAzureSubscriptionProvider.prototype, 'getAccounts').mockResolvedValue([]);
        const provider = new AzureSubscriptionProviderWithFilters();
        const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
        const options = { filter: false, noCache: false, token };

        await provider.getAccounts();
        await provider.getAccounts(options);

        expect(baseAccounts.mock.calls).toEqual([[{ noCache: true }], [{ ...options, noCache: true }]]);
        expect(options.noCache).toBe(false);
        provider.dispose();
    });

    it('finds newly signed-in accounts without an event while reusing existing tenant and subscription caches', async () => {
        const getAccounts = vi.mocked(vscode.authentication.getAccounts);
        const firstAccount = { id: 'first-account', label: 'First account' };
        const secondAccount = { id: 'second-account', label: 'Second account' };
        getAccounts.mockResolvedValueOnce([firstAccount]).mockResolvedValue([firstAccount, secondAccount]);
        const getTenants = vi
            .spyOn(AzureSubscriptionProviderBase.prototype, 'getTenantsForAccount')
            .mockImplementation(async (account) => [{ account, tenantId: `tenant-${account.id}` }]);
        const getSubscriptions = vi
            .spyOn(AzureSubscriptionProviderBase.prototype, 'getSubscriptionsForTenant')
            .mockImplementation(async ({ account, tenantId }) => [
                {
                    account,
                    tenantId,
                    subscriptionId: `subscription-${account.id}`,
                    name: account.label,
                    authentication: { getSession: vi.fn(), getSessionWithScopes: vi.fn() },
                    credential: { getToken: vi.fn() },
                    environment: account.environment,
                    isCustomCloud: false,
                },
            ]);
        const provider = new AzureSubscriptionProviderWithFilters();
        const options = { filter: false, noCache: false, maximumTenants: 20, dedupe: false };

        try {
            const first = await provider.getAvailableSubscriptions(options);
            const second = await provider.getAvailableSubscriptions(options);

            expect(first.map((subscription) => subscription.subscriptionId)).toEqual(['subscription-first-account']);
            expect(second.map((subscription) => subscription.subscriptionId)).toEqual([
                'subscription-first-account',
                'subscription-second-account',
            ]);
            expect(getTenants.mock.calls.map(([account]) => account.id)).toEqual(['first-account', 'second-account']);
            expect(getSubscriptions.mock.calls.map(([tenant]) => tenant.account.id)).toEqual([
                'first-account',
                'second-account',
            ]);
            expect(getTenants.mock.calls.every(([, passedOptions]) => passedOptions === options)).toBe(true);
            expect(getSubscriptions.mock.calls.every(([, passedOptions]) => passedOptions === options)).toBe(true);
            expect(options.noCache).toBe(false);

            const freshOptions = { ...options, noCache: true };
            await provider.getAvailableSubscriptions(freshOptions);
            expect(getTenants).toHaveBeenCalledTimes(4);
            expect(getSubscriptions).toHaveBeenCalledTimes(4);
            expect(getTenants.mock.calls.slice(2).every(([, passedOptions]) => passedOptions === freshOptions)).toBe(
                true,
            );
            expect(
                getSubscriptions.mock.calls.slice(2).every(([, passedOptions]) => passedOptions === freshOptions),
            ).toBe(true);
        } finally {
            provider.dispose();
        }
    });

    it.each(['cloud', 'session'] as const)('handles tenant and subscription caches after a %s change', async (kind) => {
        const cloudListener = vi.mocked(vscode.workspace.onDidChangeConfiguration);
        const sessionListener = vi.mocked(vscode.authentication.onDidChangeSessions);
        const getAccounts = vi.mocked(vscode.authentication.getAccounts);
        cloudListener.mockClear();
        sessionListener.mockClear();
        getAccounts.mockClear();
        getAccounts.mockResolvedValue([{ id: 'fixture-account', label: 'Fixture account' }]);
        const getTenants = vi
            .spyOn(AzureSubscriptionProviderBase.prototype, 'getTenantsForAccount')
            .mockImplementation(async (account) => [{ account, tenantId: 'fixture-tenant' }]);
        const getSubscriptions = vi
            .spyOn(AzureSubscriptionProviderBase.prototype, 'getSubscriptionsForTenant')
            .mockResolvedValue([]);
        vi.useFakeTimers();
        const provider = new AzureSubscriptionProviderWithFilters();

        try {
            await provider.getAvailableSubscriptions({ filter: false });
            await provider.getAvailableSubscriptions({ filter: false });
            expect(getAccounts).toHaveBeenCalledTimes(2);
            expect(getTenants).toHaveBeenCalledOnce();
            expect(getSubscriptions).toHaveBeenCalledOnce();

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
            expect(getAccounts).toHaveBeenCalledTimes(3);
            expect(getTenants).toHaveBeenCalledTimes(kind === 'cloud' ? 2 : 1);
            expect(getSubscriptions).toHaveBeenCalledTimes(kind === 'cloud' ? 2 : 1);
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
