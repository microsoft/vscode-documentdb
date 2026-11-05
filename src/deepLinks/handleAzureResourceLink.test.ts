/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { settingsKeys } from '../settingsKeys';
import { revealInDiscoveryView, type DiscoveryRevealResult } from '../tree/discovery-view/discoveryViewHelpers';
import { readAzureResource } from './azureResource';
import { parseAzureResourceLink, type AzureResourceLink } from './azureResourceLink';
import { resolveAzureSubscription } from './azureSubscription';
import {
    applyVisibilityChanges,
    computeVisibilityChanges,
    hasVisibilityChanges,
    type VisibilityChanges,
} from './azureVisibility';
import { handleAzureResourceLinkRequest, type AzureResourceLinkRequest } from './handleAzureResourceLink';

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), trace: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), appendLine: vi.fn() } },
}));

vi.mock('./azureResourceLink', (): typeof import('./azureResourceLink') => ({
    parseAzureResourceLink: vi.fn(),
}));
vi.mock('./azureSubscription', (): typeof import('./azureSubscription') => ({
    resolveAzureSubscription: vi.fn(),
}));
vi.mock('./azureResource', (): typeof import('./azureResource') => ({
    readAzureResource: vi.fn(),
}));
vi.mock('./azureVisibility', (): typeof import('./azureVisibility') => ({
    computeVisibilityChanges: vi.fn(),
    hasVisibilityChanges: vi.fn(),
    applyVisibilityChanges: vi.fn(),
}));
vi.mock(
    '../tree/discovery-view/discoveryViewHelpers',
    (): Pick<typeof import('../tree/discovery-view/discoveryViewHelpers'), 'revealInDiscoveryView'> => ({
        revealInDiscoveryView: vi.fn(),
    }),
);

const link: AzureResourceLink = {
    resourceId:
        '/subscriptions/subscription-id/resourceGroups/my-group/providers/Microsoft.DocumentDB/mongoClusters/my-resource',
    subscriptionId: 'subscription-id',
    resourceGroup: 'my-group',
    name: 'my-resource',
    kind: 'vcore',
    providerId: 'vcore-provider',
    tenantId: 'tenant-id',
};
const subscription = {
    name: 'My subscription',
    subscriptionId: link.subscriptionId,
    tenantId: link.tenantId,
} as AzureSubscription;
const request: AzureResourceLinkRequest = {
    resourceId: link.resourceId,
    tenantId: link.tenantId,
    database: 'sales',
    collection: 'orders',
};
const changes: VisibilityChanges = { showProvider: true, unfilterTenant: true, addSubscription: true };
const noChanges: VisibilityChanges = { showProvider: false, unfilterTenant: false, addSubscription: false };
const revealResult: DiscoveryRevealResult = {
    clusterNode: {} as DiscoveryRevealResult['clusterNode'],
    clusterId: 'stable-cluster-id',
    databaseNode: {} as DiscoveryRevealResult['databaseNode'],
};
const getSetting = vi.fn().mockReturnValue(true);
let context: IActionContext;

beforeEach((): void => {
    vi.resetAllMocks();
    context = {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        errorHandling: {},
    } as unknown as IActionContext;
    vi.mocked(parseAzureResourceLink).mockReturnValue(link);
    vi.mocked(resolveAzureSubscription).mockResolvedValue(subscription);
    vi.mocked(readAzureResource).mockResolvedValue({ name: 'My-Resource' });
    vi.mocked(computeVisibilityChanges).mockResolvedValue(changes);
    vi.mocked(hasVisibilityChanges).mockImplementation(
        (value): boolean => value.showProvider || value.unfilterTenant || value.addSubscription,
    );
    vi.mocked(applyVisibilityChanges).mockResolvedValue(undefined);
    vi.mocked(revealInDiscoveryView).mockResolvedValue(revealResult);
    getSetting.mockReturnValue(true);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: getSetting,
    } as unknown as vscode.WorkspaceConfiguration);
    (vscode.window.showInformationMessage as Mock)
        .mockResolvedValueOnce('Open')
        .mockResolvedValue('Change filters and open');
});

describe('handleAzureResourceLinkRequest', (): void => {
    it('logs the parsed link and confirmation without Azure identifiers', async (): Promise<void> => {
        await handleAzureResourceLinkRequest(context, request);

        expect(ext.outputChannel.trace).toHaveBeenNthCalledWith(1, '[DeepLink] Azure link parsed: kind=vcore resource=my-resource');
        expect(ext.outputChannel.trace).toHaveBeenNthCalledWith(2, '[DeepLink] Showing Azure confirmation');
        const logged = vi.mocked(ext.outputChannel.trace).mock.calls.flat().join(' ');
        expect(logged).not.toContain(link.subscriptionId);
        expect(logged).not.toContain('tenant-id');
        expect(logged).not.toContain(link.resourceId);
    });

    it('parses, confirms, resolves, reads, computes, confirms filter changes, applies, and reveals using the ARM display name', async (): Promise<void> => {
        const result = await handleAzureResourceLinkRequest(context, request);

        expect(result).toBe(revealResult);
        expect(parseAzureResourceLink).toHaveBeenCalledExactlyOnceWith(request.resourceId, request.tenantId);
        expect(resolveAzureSubscription).toHaveBeenCalledExactlyOnceWith(context, {
            providerId: link.providerId,
            subscriptionId: link.subscriptionId,
            tenantId: link.tenantId,
            resourceName: link.name,
        });
        expect(readAzureResource).toHaveBeenCalledExactlyOnceWith(context, subscription, {
            kind: link.kind,
            resourceGroup: link.resourceGroup,
            name: link.name,
        });
        expect(computeVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription);
        expect(hasVisibilityChanges).toHaveBeenCalledWith(changes);
        expect(applyVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription, changes);
        expect(revealInDiscoveryView).toHaveBeenCalledExactlyOnceWith(context, {
            providerId: link.providerId,
            subscriptionId: link.subscriptionId,
            azureResourceId: link.resourceId,
            displayName: 'My-Resource',
            database: 'sales',
            collection: 'orders',
        });
        const callOrder = [
            vi.mocked(parseAzureResourceLink).mock.invocationCallOrder[0],
            vi.mocked(vscode.window.showInformationMessage).mock.invocationCallOrder[0],
            vi.mocked(resolveAzureSubscription).mock.invocationCallOrder[0],
            vi.mocked(readAzureResource).mock.invocationCallOrder[0],
            vi.mocked(computeVisibilityChanges).mock.invocationCallOrder[0],
            vi.mocked(vscode.window.showInformationMessage).mock.invocationCallOrder[1],
            vi.mocked(applyVisibilityChanges).mock.invocationCallOrder[0],
            vi.mocked(revealInDiscoveryView).mock.invocationCallOrder[0],
        ];
        expect(callOrder).toEqual([...callOrder].sort((a, b): number => a - b));
        expect(context.valuesToMask).toEqual(
            expect.arrayContaining([link.subscriptionId, link.resourceGroup, link.name]),
        );
        expect(context.telemetry.properties).toEqual({
            azureResourceKind: 'vcore',
            visibilityProviderShown: 'true',
            visibilityTenantUnfiltered: 'true',
            visibilitySubscriptionAdded: 'true',
            failureStage: 'revealCluster',
        });
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith();
        expect(getSetting).toHaveBeenCalledExactlyOnceWith(settingsKeys.showUrlHandlingConfirmations, true);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Azure confirmation: accepted');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Showing filter change confirmation');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Filter change confirmation: accepted');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Applying filter changes');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Revealing My-Resource in the Discovery view');
    });

    it('shows link details first and every filter change with the resolved subscription name second', async (): Promise<void> => {
        await handleAzureResourceLinkRequest(context, request);

        expect(vscode.window.showInformationMessage).toHaveBeenNthCalledWith(
            1,
            'You clicked a link that wants to open an Azure resource in VS Code.',
            {
                modal: true,
                detail: [
                    'Resource: my-resource (Azure DocumentDB)',
                    'Resource group: my-group',
                    'Subscription ID: subscription-id',
                    'Database: sales',
                    'Collection: orders',
                    'Opens: Collection View',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Open',
        );
        expect(vscode.window.showInformationMessage).toHaveBeenNthCalledWith(
            2,
            'To show My-Resource, the extension needs to change your filters.',
            {
                modal: true,
                detail: [
                    '• The Azure DocumentDB discovery provider will be shown in the Discovery view.',
                    '• Tenant tenant-id will no longer be hidden by your tenant filter.',
                    '• Subscription My subscription will be added to your Azure subscription filter. This also shows it in the Azure Resources view.',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Change filters and open',
        );
    });

    it('shows only the first confirmation and skips applying visibility when there are no changes', async (): Promise<void> => {
        vi.mocked(computeVisibilityChanges).mockResolvedValue(noChanges);

        await expect(handleAzureResourceLinkRequest(context, { resourceId: link.resourceId })).resolves.toBe(revealResult);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            expect.any(String),
            {
                modal: true,
                detail: [
                    'Resource: my-resource (Azure DocumentDB)',
                    'Resource group: my-group',
                    'Subscription ID: subscription-id',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Open',
        );
        expect(context.telemetry.properties).toMatchObject({
            visibilityProviderShown: 'false',
            visibilityTenantUnfiltered: 'false',
            visibilitySubscriptionAdded: 'false',
        });
        expect(applyVisibilityChanges).not.toHaveBeenCalled();
        expect(ext.outputChannel.trace).not.toHaveBeenCalledWith('[DeepLink] Showing filter change confirmation');
        expect(ext.outputChannel.trace).not.toHaveBeenCalledWith('[DeepLink] Applying filter changes');
        expect(revealInDiscoveryView).toHaveBeenCalledWith(
            context,
            expect.objectContaining({ database: undefined, collection: undefined }),
        );
    });

    it('uses the RU resource and provider labels', async (): Promise<void> => {
        vi.mocked(parseAzureResourceLink).mockReturnValue({ ...link, kind: 'ru', providerId: 'ru-provider' });

        await handleAzureResourceLinkRequest(context, request);

        expect(context.telemetry.properties.azureResourceKind).toBe('ru');
        expect(readAzureResource).toHaveBeenCalledWith(context, subscription, expect.objectContaining({ kind: 'ru' }));
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                detail: expect.stringContaining('Resource: my-resource (Azure Cosmos DB for MongoDB (RU))'),
            }),
            'Open',
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                detail: expect.stringContaining(
                    '• The Azure Cosmos DB for MongoDB (RU) discovery provider will be shown in the Discovery view.',
                ),
            }),
            'Change filters and open',
        );
        expect(applyVisibilityChanges).toHaveBeenCalledWith('ru-provider', subscription, changes);
    });

    it.each([
        [{ database: 'sales', collection: 'orders' }, 'Opens: Collection View'],
        [{ open: 'dashboard' }, 'Opens: Cluster Dashboard'],
        [{ open: 'shell' }, 'Opens: Shell'],
        [{}, undefined],
        [{ database: 'sales' }, undefined],
    ] satisfies [Partial<AzureResourceLinkRequest>, string | undefined][])(
        'describes the surface for %j',
        async (target, opensLine): Promise<void> => {
            await handleAzureResourceLinkRequest(context, { resourceId: link.resourceId, ...target });

            const options = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][1] as vscode.MessageOptions;
            const surfaceLines = options.detail?.split('\n').filter((line): boolean => line.startsWith('Opens:'));
            expect(surfaceLines).toEqual(opensLine === undefined ? [] : [opensLine]);
        },
    );

    it.each([undefined, 'Not Open'])(
        'stops before subscription resolution when the first confirmation returns %s',
        async (choice): Promise<void> => {
            (vscode.window.showInformationMessage as Mock).mockReset().mockResolvedValue(choice);

            await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

            expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Azure confirmation: dismissed');
            expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureConfirmation');
            expect(context.telemetry.properties.failureStage).toBe('confirm');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
            expect(resolveAzureSubscription).not.toHaveBeenCalled();
            expect(readAzureResource).not.toHaveBeenCalled();
            expect(computeVisibilityChanges).not.toHaveBeenCalled();
            expect(hasVisibilityChanges).not.toHaveBeenCalled();
            expect(applyVisibilityChanges).not.toHaveBeenCalled();
            expect(revealInDiscoveryView).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, 'Not Change filters and open'])(
        'stops without applying changes when filter confirmation returns %s',
        async (choice): Promise<void> => {
            (vscode.window.showInformationMessage as Mock).mockResolvedValueOnce(choice);

            await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

            expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Filter change confirmation: dismissed');
            expect(ext.outputChannel.trace).not.toHaveBeenCalledWith('[DeepLink] Applying filter changes');
            expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureFilterChanges');
            expect(context.telemetry.properties.failureStage).toBe('confirmFilterChanges');
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
            expect(computeVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription);
            expect(applyVisibilityChanges).not.toHaveBeenCalled();
            expect(revealInDiscoveryView).not.toHaveBeenCalled();
        },
    );

    it('applies filter changes without any dialog when confirmations are disabled', async (): Promise<void> => {
        getSetting.mockReturnValue(false);

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Azure confirmation skipped (confirmations disabled)');
        expect(ext.outputChannel.trace).not.toHaveBeenCalledWith('[DeepLink] Showing filter change confirmation');
        expect(applyVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription, changes);
        expect(revealInDiscoveryView).toHaveBeenCalledTimes(1);
    });

    it('stops after subscription cancellation and preserves its telemetry', async (): Promise<void> => {
        vi.mocked(resolveAzureSubscription).mockImplementation(async (): Promise<undefined> => {
            context.telemetry.properties.failureStage = 'azureSignIn';
            context.telemetry.properties.userCancelledAtStep = 'AzureSignIn';
            return undefined;
        });

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties.failureStage).toBe('azureSignIn');
        expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureSignIn');
        expect(readAzureResource).not.toHaveBeenCalled();
        expect(computeVisibilityChanges).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(applyVisibilityChanges).not.toHaveBeenCalled();
        expect(revealInDiscoveryView).not.toHaveBeenCalled();
    });

    it('propagates read failures after the first confirmation without changing visibility', async (): Promise<void> => {
        const error = new Error('ARM read failed');
        vi.mocked(readAzureResource).mockRejectedValue(error);

        await expect(handleAzureResourceLinkRequest(context, request)).rejects.toBe(error);

        expect(context.telemetry.properties.failureStage).toBe('readAzureResource');
        expect(computeVisibilityChanges).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(applyVisibilityChanges).not.toHaveBeenCalled();
        expect(revealInDiscoveryView).not.toHaveBeenCalled();
    });

    it('returns undefined when reveal reports the cluster did not connect', async (): Promise<void> => {
        vi.mocked(revealInDiscoveryView).mockResolvedValue(undefined);

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties.failureStage).toBe('revealCluster');
    });
});
