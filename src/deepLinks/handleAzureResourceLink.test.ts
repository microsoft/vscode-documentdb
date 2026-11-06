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
    ext: {
        outputChannel: {
            info: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            appendLine: vi.fn(),
        },
    },
}));

vi.mock('./azureResourceLink', () => ({
    parseAzureResourceLink: vi.fn(),
}));
vi.mock('./azureSubscription', () => ({
    resolveAzureSubscription: vi.fn(),
}));
vi.mock('./azureResource', () => ({
    readAzureResource: vi.fn(),
}));
vi.mock('./azureVisibility', () => ({
    computeVisibilityChanges: vi.fn(),
    hasVisibilityChanges: vi.fn(),
    applyVisibilityChanges: vi.fn(),
}));
vi.mock('../tree/discovery-view/discoveryViewHelpers', () => ({
    revealInDiscoveryView: vi.fn(),
}));

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
const progress = { report: vi.fn() };
const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
const getSetting = vi.fn().mockReturnValue(true);
let context: IActionContext;

beforeEach((): void => {
    vi.resetAllMocks();
    token.isCancellationRequested = false;
    vi.mocked(vscode.window.withProgress).mockImplementation(
        async <T>(
            _options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<T>,
        ): Promise<T> => task(progress, token),
    );
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
    it.each([undefined, 'shell', 'dashboard'] as const)(
        'suppresses the automatic dashboard only for open=%s when requested',
        async (open): Promise<void> => {
            await handleAzureResourceLinkRequest(context, { ...request, collection: undefined, open });

            expect(revealInDiscoveryView).toHaveBeenCalledExactlyOnceWith(
                context,
                expect.objectContaining({ suppressAutoOpenDashboard: open === 'dashboard' }),
                expect.any(Function),
            );
        },
    );

    it('masks the subscription name before reading the Azure resource', async (): Promise<void> => {
        vi.mocked(readAzureResource).mockImplementation(async (readContext): Promise<{ name: string }> => {
            expect(readContext.valuesToMask).toContain(subscription.name);
            return { name: 'My-Resource' };
        });

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);
    });

    it('starts one cancellable notification only after the first confirmation is accepted', async (): Promise<void> => {
        (vscode.window.showInformationMessage as Mock)
            .mockReset()
            .mockResolvedValue('Change filters and open')
            .mockImplementationOnce(async (): Promise<string> => {
                expect(vscode.window.withProgress).not.toHaveBeenCalled();
                return 'Open';
            });

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);

        expect(vi.mocked(vscode.window.withProgress).mock.calls[0][0].title).toBe('Opening Azure resource');
        expect(vscode.window.withProgress).toHaveBeenCalledExactlyOnceWith(
            { location: vscode.ProgressLocation.Notification, title: 'Opening Azure resource', cancellable: true },
            expect.any(Function),
        );
    });

    it('forwards progress reporting to subscription resolution and reveal and reports before reads and filter updates', async (): Promise<void> => {
        vi.mocked(resolveAzureSubscription).mockImplementation(
            async (_context, _request, report): Promise<AzureSubscription> => {
                report?.('Checking Azure sign-in…');
                return subscription;
            },
        );
        vi.mocked(readAzureResource).mockImplementation(async (): Promise<{ name: string }> => {
            expect(progress.report).toHaveBeenLastCalledWith({ message: 'Reading the resource from Azure…' });
            return { name: 'My-Resource' };
        });
        vi.mocked(applyVisibilityChanges).mockImplementation(async (): Promise<void> => {
            expect(progress.report).toHaveBeenLastCalledWith({ message: 'Updating filters…' });
        });
        vi.mocked(revealInDiscoveryView).mockImplementation(
            async (_context, _request, report): Promise<DiscoveryRevealResult> => {
                report?.('Finding the cluster in the Discovery view…');
                return revealResult;
            },
        );

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);

        expect(vi.mocked(resolveAzureSubscription).mock.calls[0][2]).toBe(
            vi.mocked(revealInDiscoveryView).mock.calls[0][2],
        );
        expect(progress.report.mock.calls).toEqual([
            [{ message: 'Checking Azure sign-in…' }],
            [{ message: 'Reading the resource from Azure…' }],
            [{ message: 'Updating filters…' }],
            [{ message: 'Finding the cluster in the Discovery view…' }],
        ]);
    });

    it.each(['resolve', 'read', 'compute', 'filter confirmation', 'apply'])(
        'stops between steps when the progress notification is cancelled during %s',
        async (step): Promise<void> => {
            if (step === 'resolve') {
                vi.mocked(resolveAzureSubscription).mockImplementation(async (): Promise<AzureSubscription> => {
                    token.isCancellationRequested = true;
                    return subscription;
                });
            } else if (step === 'read') {
                vi.mocked(readAzureResource).mockImplementation(async (): Promise<{ name: string }> => {
                    token.isCancellationRequested = true;
                    return { name: 'My-Resource' };
                });
            } else if (step === 'compute') {
                vi.mocked(computeVisibilityChanges).mockImplementation(async (): Promise<VisibilityChanges> => {
                    token.isCancellationRequested = true;
                    return changes;
                });
            } else if (step === 'filter confirmation') {
                (vscode.window.showInformationMessage as Mock).mockImplementation(async (): Promise<string> => {
                    token.isCancellationRequested = true;
                    return 'Change filters and open';
                });
            } else {
                vi.mocked(applyVisibilityChanges).mockImplementation(async (): Promise<void> => {
                    token.isCancellationRequested = true;
                });
            }

            await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

            expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureProgress');
            expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cancelled from the progress notification');
            expect(revealInDiscoveryView).not.toHaveBeenCalled();
            if (step !== 'apply') {
                expect(applyVisibilityChanges).not.toHaveBeenCalled();
            } else {
                expect(applyVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription, changes);
            }
            if (step === 'resolve') {
                expect(readAzureResource).not.toHaveBeenCalled();
            }
            if (step === 'resolve' || step === 'read') {
                expect(computeVisibilityChanges).not.toHaveBeenCalled();
            }
        },
    );

    it('returns the reveal result when progress is not cancelled', async (): Promise<void> => {
        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBe(revealResult);

        expect(context.telemetry.properties.userCancelledAtStep).toBeUndefined();
    });

    it('stops when progress is cancelled during reveal', async (): Promise<void> => {
        vi.mocked(revealInDiscoveryView).mockImplementation(async (): Promise<DiscoveryRevealResult> => {
            token.isCancellationRequested = true;
            return revealResult;
        });

        await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

        expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureProgress');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cancelled from the progress notification');
    });

    it('logs the parsed link and confirmation without Azure identifiers', async (): Promise<void> => {
        await handleAzureResourceLinkRequest(context, request);

        expect(ext.outputChannel.trace).toHaveBeenNthCalledWith(
            1,
            '[DeepLink] Azure link parsed: kind=vcore resource=my-resource',
        );
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
        expect(resolveAzureSubscription).toHaveBeenCalledExactlyOnceWith(
            context,
            {
                providerId: link.providerId,
                subscriptionId: link.subscriptionId,
                tenantId: link.tenantId,
                resourceName: link.name,
            },
            expect.any(Function),
        );
        expect(readAzureResource).toHaveBeenCalledExactlyOnceWith(context, subscription, {
            kind: link.kind,
            resourceGroup: link.resourceGroup,
            name: link.name,
        });
        expect(computeVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription);
        expect(hasVisibilityChanges).toHaveBeenCalledWith(changes);
        expect(applyVisibilityChanges).toHaveBeenCalledExactlyOnceWith(link.providerId, subscription, changes);
        expect(revealInDiscoveryView).toHaveBeenCalledExactlyOnceWith(
            context,
            {
                providerId: link.providerId,
                subscriptionId: link.subscriptionId,
                azureResourceId: link.resourceId,
                displayName: 'My-Resource',
                database: 'sales',
                collection: 'orders',
                suppressAutoOpenDashboard: false,
            },
            expect.any(Function),
        );
        const callOrder = [
            vi.mocked(parseAzureResourceLink).mock.invocationCallOrder[0],
            vi.mocked(vscode.window.showInformationMessage).mock.invocationCallOrder[0],
            vi.mocked(vscode.window.withProgress).mock.invocationCallOrder[0],
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
            'Open Azure resource?',
            {
                modal: true,
                detail: [
                    'A link wants to open this Azure resource in VS Code.',
                    '',
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
            'Change filters?',
            {
                modal: true,
                detail: [
                    'To show My-Resource, the extension needs to change your filters:',
                    '• The Azure DocumentDB discovery provider will be shown in the Discovery view.',
                    '• Tenant tenant-id will no longer be hidden by your tenant filter.',
                    '• Subscription "My subscription" will be added to your Azure subscription filter. This also shows it in the Azure Resources view.',
                    '',
                    'These changes stay after the link opens. To undo them, use Filter Entries… or Hide Provider on the provider in the Discovery view.',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Change filters and open',
        );
        expect(vscode.window.showInformationMessage).toHaveBeenNthCalledWith(
            2,
            'Change filters?',
            expect.objectContaining({
                detail: expect.stringContaining(
                    'These changes stay after the link opens. To undo them, use Filter Entries… or Hide Provider on the provider in the Discovery view.',
                ),
            }),
            'Change filters and open',
        );
    });

    it('shows only the first confirmation and skips applying visibility when there are no changes', async (): Promise<void> => {
        vi.mocked(computeVisibilityChanges).mockResolvedValue(noChanges);

        await expect(handleAzureResourceLinkRequest(context, { resourceId: link.resourceId })).resolves.toBe(
            revealResult,
        );

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            expect.any(String),
            {
                modal: true,
                detail: [
                    'A link wants to open this Azure resource in VS Code.',
                    '',
                    'Resource: my-resource (Azure DocumentDB)',
                    'Resource group: my-group',
                    'Subscription ID: subscription-id',
                    'Opens: Discovery view',
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
        expect(progress.report).not.toHaveBeenCalledWith({ message: 'Updating filters…' });
        expect(revealInDiscoveryView).toHaveBeenCalledWith(
            context,
            expect.objectContaining({ database: undefined, collection: undefined }),
            expect.any(Function),
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
        [{ open: 'shell' }, 'Opens: Interactive Shell'],
        [{}, 'Opens: Discovery view'],
        [{ database: 'sales' }, 'Opens: Discovery view'],
    ] satisfies [Partial<AzureResourceLinkRequest>, string | undefined][])(
        'describes the surface for %j',
        async (target, opensLine): Promise<void> => {
            await handleAzureResourceLinkRequest(context, { resourceId: link.resourceId, ...target });

            const options = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][1];
            const surfaceLines = options.detail?.split('\n').filter((line): boolean => line.startsWith('Opens:'));
            expect(surfaceLines).toEqual(opensLine === undefined ? [] : [opensLine]);
        },
    );

    it('shows Discovery view as the destination for a bare Azure link when confirmations are on', async (): Promise<void> => {
        getSetting.mockReturnValue(true);

        await handleAzureResourceLinkRequest(context, { resourceId: link.resourceId });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Open Azure resource?',
            expect.objectContaining({ detail: expect.stringContaining('Opens: Discovery view') }),
            'Open',
        );
    });

    it.each([undefined, 'Not Open'])(
        'stops before subscription resolution when the first confirmation returns %s',
        async (choice): Promise<void> => {
            (vscode.window.showInformationMessage as Mock).mockReset().mockResolvedValue(choice);

            await expect(handleAzureResourceLinkRequest(context, request)).resolves.toBeUndefined();

            expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Azure confirmation: dismissed');
            expect(context.telemetry.properties.userCancelledAtStep).toBe('AzureConfirmation');
            expect(vscode.window.withProgress).not.toHaveBeenCalled();
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
        expect(ext.outputChannel.trace).toHaveBeenCalledWith(
            '[DeepLink] Azure confirmation skipped (confirmations disabled)',
        );
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
