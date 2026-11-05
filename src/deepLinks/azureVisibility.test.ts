/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import {
    isTenantFilteredOut,
    removeUnselectedTenant,
    setSelectedSubscriptionIds,
} from '../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers';
import { getHiddenDiscoveryProviderIds, showDiscoveryProvider } from '../services/discoveryProviderVisibility';
import {
    applyVisibilityChanges,
    computeVisibilityChanges,
    hasVisibilityChanges,
    type VisibilityChanges,
} from './azureVisibility';

vi.mock('../services/discoveryProviderVisibility', (): object => ({
    getHiddenDiscoveryProviderIds: vi.fn(),
    showDiscoveryProvider: vi.fn(),
}));
vi.mock('../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers', (): object => ({
    isTenantFilteredOut: vi.fn(),
    removeUnselectedTenant: vi.fn(),
    setSelectedSubscriptionIds: vi.fn(),
}));
vi.mock('../extensionVariables', (): object => ({
    ext: {
        outputChannel: { info: vi.fn(), trace: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), appendLine: vi.fn() },
        context: { globalState: { get: vi.fn(), update: vi.fn() } },
        discoveryBranchDataProvider: { refresh: vi.fn() },
    },
}));

const providerId = 'azure-provider';
const subscription = {
    tenantId: 'target-tenant',
    subscriptionId: 'target-subscription',
    account: { id: 'target-account', label: 'Target account' },
} as AzureSubscription;
const targetEntry = `${subscription.tenantId}/${subscription.subscriptionId}`;
const noChanges: VisibilityChanges = { showProvider: false, unfilterTenant: false, addSubscription: false };
const configurationGet = vi.fn<(key: string) => string[] | undefined>();

beforeEach((): void => {
    vi.resetAllMocks();
    vi.mocked(getHiddenDiscoveryProviderIds).mockResolvedValue([]);
    vi.mocked(isTenantFilteredOut).mockReturnValue(false);
    vi.mocked(ext.context.globalState.get).mockReturnValue([]);
    configurationGet.mockReturnValue([targetEntry]);
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: configurationGet,
    } as unknown as vscode.WorkspaceConfiguration);
});

afterEach((): void => {
    vi.restoreAllMocks();
});

describe('Azure deep-link visibility', (): void => {
    it.each<VisibilityChanges>([
        { showProvider: true, unfilterTenant: false, addSubscription: false },
        { showProvider: false, unfilterTenant: true, addSubscription: false },
        { showProvider: false, unfilterTenant: false, addSubscription: true },
        { showProvider: true, unfilterTenant: true, addSubscription: true },
    ])('computes and applies %j with a single refresh', async (expected): Promise<void> => {
        vi.mocked(getHiddenDiscoveryProviderIds).mockResolvedValue(expected.showProvider ? [providerId] : []);
        vi.mocked(isTenantFilteredOut).mockReturnValue(expected.unfilterTenant);
        const existingEntries = expected.addSubscription ? ['other-tenant/other-subscription'] : [targetEntry];
        configurationGet.mockReturnValue(existingEntries);

        const changes = await computeVisibilityChanges(providerId, subscription);

        expect(changes).toEqual(expected);
        expect(ext.outputChannel.trace).toHaveBeenCalledWith(
            `[DeepLink] Visibility changes: showProvider=${expected.showProvider} unfilterTenant=${expected.unfilterTenant} addSubscription=${expected.addSubscription}`,
        );
        expect(hasVisibilityChanges(changes)).toBe(true);
        expect(isTenantFilteredOut).toHaveBeenCalledExactlyOnceWith(subscription.tenantId, subscription.account.id);
        expect(showDiscoveryProvider).not.toHaveBeenCalled();
        expect(removeUnselectedTenant).not.toHaveBeenCalled();
        expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();

        await applyVisibilityChanges(providerId, subscription, changes);

        if (expected.showProvider) {
            expect(showDiscoveryProvider).toHaveBeenCalledExactlyOnceWith(providerId);
        } else {
            expect(showDiscoveryProvider).not.toHaveBeenCalled();
        }
        if (expected.unfilterTenant) {
            expect(removeUnselectedTenant).toHaveBeenCalledExactlyOnceWith(
                subscription.tenantId,
                subscription.account.id,
            );
        } else {
            expect(removeUnselectedTenant).not.toHaveBeenCalled();
        }
        if (expected.addSubscription) {
            expect(setSelectedSubscriptionIds).toHaveBeenCalledExactlyOnceWith([...existingEntries, targetEntry]);
        } else {
            expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        }
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith();
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Discovery view refreshed');
    });

    it.each([false, true])('never writes an empty selection (fallback: %s)', async (useFallback): Promise<void> => {
        configurationGet.mockReturnValue(useFallback ? undefined : []);
        vi.mocked(ext.context.globalState.get).mockReturnValue(useFallback ? [] : ['other-tenant/other-subscription']);
        vi.mocked(getHiddenDiscoveryProviderIds).mockResolvedValue([providerId]);

        const changes = await computeVisibilityChanges(providerId, subscription);
        expect(changes.addSubscription).toBe(false);
        await applyVisibilityChanges(providerId, subscription, changes);

        expect(showDiscoveryProvider).toHaveBeenCalledExactlyOnceWith(providerId);
        expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith();
        if (!useFallback) {
            expect(ext.context.globalState.get).not.toHaveBeenCalled();
        }
    });

    it('preserves existing raw entries unchanged and in order when adding', async (): Promise<void> => {
        const existingEntries = ['Tenant-Z/Subscription-Z', 'tenant-a/subscription-a', 'Tenant-Z/Subscription-Z'];
        configurationGet.mockReturnValue(existingEntries);

        const changes = await computeVisibilityChanges(providerId, subscription);
        await applyVisibilityChanges(providerId, subscription, changes);

        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('azureResourceGroups');
        expect(configurationGet).toHaveBeenCalledWith('selectedSubscriptions');
        expect(setSelectedSubscriptionIds).toHaveBeenCalledExactlyOnceWith([...existingEntries, targetEntry]);
        expect(existingEntries).toEqual(['Tenant-Z/Subscription-Z', 'tenant-a/subscription-a', 'Tenant-Z/Subscription-Z']);
        expect(ext.context.globalState.get).not.toHaveBeenCalled();
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
    });

    it('uses the raw fallback entries when the primary setting is undefined', async (): Promise<void> => {
        const existingEntries = ['Tenant-Z/Subscription-Z', 'tenant-a/subscription-a'];
        configurationGet.mockReturnValue(undefined);
        vi.mocked(ext.context.globalState.get).mockReturnValue(existingEntries);

        const changes = await computeVisibilityChanges(providerId, subscription);
        expect(changes.addSubscription).toBe(true);
        await applyVisibilityChanges(providerId, subscription, changes);

        expect(ext.context.globalState.get).toHaveBeenCalledWith('azure-discovery.selectedSubscriptions', []);
        expect(setSelectedSubscriptionIds).toHaveBeenCalledExactlyOnceWith([...existingEntries, targetEntry]);
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith();
    });

    it('recognizes an already selected subscription regardless of casing', async (): Promise<void> => {
        configurationGet.mockReturnValue([`different-tenant/${subscription.subscriptionId.toUpperCase()}`]);

        const changes = await computeVisibilityChanges(providerId, subscription);
        expect(changes).toEqual(noChanges);
        await applyVisibilityChanges(providerId, subscription, changes);

        expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
    });

    it('does nothing and does not refresh when there are no changes', async (): Promise<void> => {
        const changes = await computeVisibilityChanges(providerId, subscription);
        expect(changes).toEqual(noChanges);
        expect(hasVisibilityChanges(changes)).toBe(false);
        vi.mocked(vscode.workspace.getConfiguration).mockClear();
        configurationGet.mockClear();

        await applyVisibilityChanges(providerId, subscription, changes);

        expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
        expect(configurationGet).not.toHaveBeenCalled();
        expect(showDiscoveryProvider).not.toHaveBeenCalled();
        expect(removeUnselectedTenant).not.toHaveBeenCalled();
        expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
    });

    it('does not narrow the selection if it becomes empty before applying', async (): Promise<void> => {
        configurationGet.mockReturnValue(['other-tenant/other-subscription']);
        const changes = await computeVisibilityChanges(providerId, subscription);
        expect(changes.addSubscription).toBe(true);
        configurationGet.mockReturnValue([]);

        await applyVisibilityChanges(providerId, subscription, changes);

        expect(setSelectedSubscriptionIds).not.toHaveBeenCalled();
        expect(ext.discoveryBranchDataProvider.refresh).not.toHaveBeenCalled();
    });
});
