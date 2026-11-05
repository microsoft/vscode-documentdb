/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
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
    (vscode.window.showInformationMessage as Mock).mockResolvedValue('Open');
});

describe('handleAzureResourceLinkRequest', (): void => {
    it('parses, resolves, reads, computes, confirms, applies, and reveals using the ARM display name', async (): Promise<void> => {
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
            vi.mocked(resolveAzureSubscription).mock.invocationCallOrder[0],
            vi.mocked(readAzureResource).mock.invocationCallOrder[0],
            vi.mocked(computeVisibilityChanges).mock.invocationCallOrder[0],
            vi.mocked(vscode.window.showInformationMessage).mock.invocationCallOrder[0],
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
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('lists the resource, target, every filter change, and the Azure Resources note in one confirmation', async (): Promise<void> => {
        await handleAzureResourceLinkRequest(context, request);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            'You clicked a link that wants to open an Azure resource in VS Code.',
            {
                modal: true,
                detail: [
                    'Resource: My-Resource (Azure DocumentDB)',
                    'Resource group: my-group',
                    'Subscription: My subscription',
                    'Database: sales',
                    'Collection: orders',
                    'Opens: Collection View',
                    '',
                    'To show this resource, these filters will change:',
                    '• The Azure DocumentDB discovery provider will be shown in the Discovery view.',
                    '• Tenant tenant-id will no longer be hidden by your tenant filter.',
                    '• Subscription My subscription will be added to your Azure subscription filter. This also shows it in the Azure Resources view.',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Open',
        );
    });

    it('omits the filter block and skips applying visibility when there are no changes', async (): Promise<void> => {
        vi.mocked(computeVisibilityChanges).mockResolvedValue(noChanges);

        await expect(handleAzureResourceLinkRequest(context, { resourceId: link.resourceId })).resolves.toBe(revealResult);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            expect.any(String),
            {
                modal: true,
                detail: [
                    'Resource: My-Resource (Azure DocumentDB)',
                    'Resource group: my-group',
                    'Subscription: My subscription',
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
                detail: expect.stringContaining('Resource: My-Resource (Azure Cosmos DB for MongoDB (RU))'),
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
            'Open',
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
        'stops without changing visibility when confirmation returns %s',
        async (choice): Promise<void> => {
            (vscode.window.showInformationMessage as Mock).mockResolvedValue(choice);

            await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

            expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureConfirmation');
            expect(context.telemetry.properties.failureStage).toBe('confirm');
            expect(applyVisibilityChanges).not.toHaveBeenCalled();
            expect(revealInDiscoveryView).not.toHaveBeenCalled();
        },
    );

    it('applies filter changes without any dialog when confirmations are disabled', async (): Promise<void> => {
        getSetting.mockReturnValue(false);

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
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
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(applyVisibilityChanges).not.toHaveBeenCalled();
        expect(revealInDiscoveryView).not.toHaveBeenCalled();
    });

    it('propagates read failures without confirmation or visibility changes', async (): Promise<void> => {
        const error = new Error('ARM read failed');
        vi.mocked(readAzureResource).mockRejectedValue(error);

        await expect(handleAzureResourceLinkRequest(context, request)).rejects.toBe(error);

        expect(context.telemetry.properties.failureStage).toBe('readAzureResource');
        expect(computeVisibilityChanges).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(applyVisibilityChanges).not.toHaveBeenCalled();
        expect(revealInDiscoveryView).not.toHaveBeenCalled();
    });

    it('returns undefined when reveal reports the cluster did not connect', async (): Promise<void> => {
        vi.mocked(revealInDiscoveryView).mockResolvedValue(undefined);

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties.failureStage).toBe('revealCluster');
    });
});
