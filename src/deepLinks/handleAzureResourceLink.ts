/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { settingsKeys } from '../settingsKeys';
import { revealInDiscoveryView, type DiscoveryRevealResult } from '../tree/discovery-view/discoveryViewHelpers';
import { readAzureResource } from './azureResource';
import { parseAzureResourceLink } from './azureResourceLink';
import { resolveAzureSubscription } from './azureSubscription';
import { applyVisibilityChanges, computeVisibilityChanges, hasVisibilityChanges } from './azureVisibility';

export interface AzureResourceLinkRequest {
    readonly resourceId: string;
    readonly tenantId?: string;
    readonly database?: string;
    readonly collection?: string;
    readonly open?: 'dashboard' | 'shell';
}

/** Returns the reveal result for the caller to open a surface, or undefined when the flow stopped (cancelled or not connected). */
export async function handleAzureResourceLinkRequest(
    context: IActionContext,
    request: AzureResourceLinkRequest,
): Promise<DiscoveryRevealResult | undefined> {
    context.telemetry.properties.failureStage = 'parseResourceId';
    const link = parseAzureResourceLink(request.resourceId, request.tenantId);
    ext.outputChannel.trace(`[DeepLink] Azure link parsed: kind=${link.kind} resource=${link.name}`);
    context.valuesToMask.push(link.subscriptionId, link.resourceGroup, link.name);
    context.telemetry.properties.azureResourceKind = link.kind;

    context.telemetry.properties.failureStage = 'confirm';
    const showUrlHandlingConfirmations = vscode.workspace
        .getConfiguration()
        .get<boolean>(settingsKeys.showUrlHandlingConfirmations, true);

    const kindLabel =
        link.kind === 'vcore' ? vscode.l10n.t('Azure DocumentDB') : vscode.l10n.t('Azure Cosmos DB for MongoDB (RU)');

    if (showUrlHandlingConfirmations) {
        const detail = [
            vscode.l10n.t('A link wants to open this Azure resource in VS Code.'),
            '',
            vscode.l10n.t('Resource: {0} ({1})', link.name, kindLabel),
            vscode.l10n.t('Resource group: {0}', link.resourceGroup),
            vscode.l10n.t('Subscription ID: {0}', link.subscriptionId),
        ];
        if (request.database) {
            detail.push(vscode.l10n.t('Database: {0}', request.database));
        }
        if (request.collection) {
            detail.push(vscode.l10n.t('Collection: {0}', request.collection));
        }

        let surface: string | undefined;
        if (request.collection) {
            surface = vscode.l10n.t('Collection View');
        } else if (request.open === 'dashboard') {
            surface = vscode.l10n.t('Cluster Dashboard');
        } else if (request.open === 'shell') {
            surface = vscode.l10n.t('Interactive Shell');
        } else {
            surface = vscode.l10n.t('Discovery view');
        }
        if (surface) {
            detail.push(vscode.l10n.t('Opens: {0}', surface));
        }

        detail.push(
            '',
            vscode.l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
        );

        const openButton = vscode.l10n.t('Open');
        ext.outputChannel.trace('[DeepLink] Showing Azure confirmation');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t('Open Azure resource?'),
            { modal: true, detail: detail.join('\n') },
            openButton,
        );
        ext.outputChannel.trace(`[DeepLink] Azure confirmation: ${choice === openButton ? 'accepted' : 'dismissed'}`);
        if (choice !== openButton) {
            context.telemetry.properties.userCancelledAtStep = 'AzureConfirmation';
            return undefined;
        }
    } else {
        ext.outputChannel.trace('[DeepLink] Azure confirmation skipped (confirmations disabled)');
    }

    const displayName = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Opening Azure resource…'),
            cancellable: true,
        },
        async (progress, token): Promise<string | undefined> => {
            const report = (message: string): void => progress.report({ message });
            const subscription = await resolveAzureSubscription(
                context,
                {
                    providerId: link.providerId,
                    subscriptionId: link.subscriptionId,
                    tenantId: link.tenantId,
                    resourceName: link.name,
                },
                report,
            );
            if (token.isCancellationRequested) {
                context.telemetry.properties.userCancelledAtStep = 'AzureProgress';
                ext.outputChannel.trace('[DeepLink] Cancelled from the progress notification');
                return undefined;
            }
            if (!subscription) {
                return undefined;
            }

            context.valuesToMask.push(subscription.name);
            context.telemetry.properties.failureStage = 'readAzureResource';
            report(vscode.l10n.t('Reading the resource from Azure…'));
            const { name: displayName } = await readAzureResource(context, subscription, {
                kind: link.kind,
                resourceGroup: link.resourceGroup,
                name: link.name,
            });
            if (token.isCancellationRequested) {
                context.telemetry.properties.userCancelledAtStep = 'AzureProgress';
                ext.outputChannel.trace('[DeepLink] Cancelled from the progress notification');
                return undefined;
            }

            context.telemetry.properties.failureStage = 'computeVisibility';
            const changes = await computeVisibilityChanges(link.providerId, subscription);
            if (token.isCancellationRequested) {
                context.telemetry.properties.userCancelledAtStep = 'AzureProgress';
                ext.outputChannel.trace('[DeepLink] Cancelled from the progress notification');
                return undefined;
            }
            context.telemetry.properties.visibilityProviderShown = changes.showProvider ? 'true' : 'false';
            context.telemetry.properties.visibilityTenantUnfiltered = changes.unfilterTenant ? 'true' : 'false';
            context.telemetry.properties.visibilitySubscriptionAdded = changes.addSubscription ? 'true' : 'false';
            const visibilityChangesNeeded = hasVisibilityChanges(changes);

            context.telemetry.properties.failureStage = 'confirmFilterChanges';
            if (showUrlHandlingConfirmations && visibilityChangesNeeded) {
                const detail = [vscode.l10n.t('To show {0}, the extension needs to change your filters:', displayName)];
                if (changes.showProvider) {
                    detail.push(
                        vscode.l10n.t('• The {0} discovery provider will be shown in the Discovery view.', kindLabel),
                    );
                }
                if (changes.unfilterTenant) {
                    detail.push(
                        vscode.l10n.t(
                            '• Tenant {0} will no longer be hidden by your tenant filter.',
                            subscription.tenantId,
                        ),
                    );
                }
                if (changes.addSubscription) {
                    detail.push(
                        vscode.l10n.t(
                            '• Subscription "{0}" will be added to your Azure subscription filter. This also shows it in the Azure Resources view.',
                            subscription.name,
                        ),
                    );
                }
                detail.push(
                    '',
                    vscode.l10n.t(
                        'These changes stay after the link opens. To undo them, use Filter Entries… or Hide Provider on the provider in the Discovery view.',
                    ),
                    '',
                    vscode.l10n.t('Note: You can disable these URL handling confirmations in the extension settings.'),
                );

                const changeFiltersButton = vscode.l10n.t('Change filters and open');
                ext.outputChannel.trace('[DeepLink] Showing filter change confirmation');
                const choice = await vscode.window.showInformationMessage(
                    vscode.l10n.t('Change filters?'),
                    { modal: true, detail: detail.join('\n') },
                    changeFiltersButton,
                );
                ext.outputChannel.trace(
                    `[DeepLink] Filter change confirmation: ${choice === changeFiltersButton ? 'accepted' : 'dismissed'}`,
                );
                if (token.isCancellationRequested) {
                    context.telemetry.properties.userCancelledAtStep = 'AzureProgress';
                    ext.outputChannel.trace('[DeepLink] Cancelled from the progress notification');
                    return undefined;
                }
                if (choice !== changeFiltersButton) {
                    context.telemetry.properties.userCancelledAtStep = 'AzureFilterChanges';
                    return undefined;
                }
            }

            context.telemetry.properties.failureStage = 'applyVisibility';
            if (visibilityChangesNeeded) {
                ext.outputChannel.trace('[DeepLink] Applying filter changes');
                report(vscode.l10n.t('Updating filters…'));
                await applyVisibilityChanges(link.providerId, subscription, changes);
            }

            if (token.isCancellationRequested) {
                context.telemetry.properties.userCancelledAtStep = 'AzureProgress';
                ext.outputChannel.trace('[DeepLink] Cancelled from the progress notification');
                return undefined;
            }

            return displayName;
        },
    );
    if (displayName === undefined) {
        return undefined;
    }

    context.telemetry.properties.failureStage = 'revealCluster';
    ext.outputChannel.trace(`[DeepLink] Revealing ${displayName} in the Discovery view`);
    return revealInDiscoveryView(context, {
        providerId: link.providerId,
        subscriptionId: link.subscriptionId,
        azureResourceId: link.resourceId,
        displayName,
        database: request.database,
        collection: request.collection,
        suppressAutoOpenDashboard: request.open === 'dashboard',
    });
}
