/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { commands, QuickPickItemKind, type QuickPickItem } from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { MigrationService } from '../../services/migrationServices';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { nonNullValue } from '../../utils/nonNull';
import { openUrl } from '../../utils/openUrl';

const ANNOUNCED_PROVIDER_PREFIX = 'announced-provider';

export async function accessDataMigrationServices(context: IActionContext, node: ClusterItemBase): Promise<void> {
    // Section 1: Installed migration providers (registered via the API)
    const installedProviders: (QuickPickItem & { id: string })[] = MigrationService.listProviders()
        .map((provider) => ({
            id: provider.id,
            label: provider.label,
            detail: provider.description,
            iconPath: provider.iconPath,
            group: 'Installed Providers',
            alwaysShow: true,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    // Section 2: Announced providers from the static registry (not yet installed)
    const announcedProviders: (QuickPickItem & { id: string })[] = MigrationService.listAnnouncedProviders(true).map(
        (provider) => ({
            id: `${ANNOUNCED_PROVIDER_PREFIX}-${provider.id}`,
            label: `$(extensions) ${provider.name}`,
            detail: l10n.t('Open the VS Code Marketplace to learn more about "{0}"', provider.name),
            url: provider.url,
            marketplaceId: provider.id,
            group: 'Visit Marketplace',
            alwaysShow: true,
        }),
    );

    // Section 3: Common items (separator + Learn More)
    const commonItems = [
        { label: '', kind: QuickPickItemKind.Separator },
        {
            id: 'learnMore',
            label: l10n.t('Learn more…'),
            detail: l10n.t('Learn more about DocumentDB and MongoDB migrations.'),
            learnMoreUrl: 'https://aka.ms/vscode-documentdb-migration-support',
            group: 'Learn More',
            alwaysShow: true,
        },
    ];

    // Show the unified QuickPick with all sections
    const selectedItem = await context.ui.showQuickPick(
        [...installedProviders, ...announcedProviders, ...commonItems],
        {
            enableGrouping: true,
            placeHolder: l10n.t('Choose the data migration provider…'),
            stepName: 'selectMigrationProvider',
            suppressPersistence: true,
        },
    );

    context.telemetry.properties.connectionMode = selectedItem.id;

    // Handle "Learn More" selection
    if (selectedItem.id === 'learnMore') {
        context.telemetry.properties.migrationLearnMore = 'true';
        if ('learnMoreUrl' in selectedItem && selectedItem.learnMoreUrl) {
            await openUrl(selectedItem.learnMoreUrl);
        }
        return;
    }

    // Handle announced provider selection — open VS Code Marketplace
    if (selectedItem.id?.startsWith(ANNOUNCED_PROVIDER_PREFIX)) {
        context.telemetry.properties.migrationAddProvider = 'true';
        if ('marketplaceId' in selectedItem && selectedItem.marketplaceId) {
            void commands.executeCommand('extension.open', selectedItem.marketplaceId);
        }
        return;
    }

    // Handle installed provider selection
    if (installedProviders.some((provider) => provider.id === selectedItem.id)) {
        const selectedProvider = MigrationService.getProvider(
            nonNullValue(selectedItem.id, 'selectedItem.id', 'accessDataMigrationServices.ts'),
        );

        if (!selectedProvider) {
            return;
        }

        context.telemetry.properties.migrationProvider = selectedProvider.id;

        // Check if the selected provider requires authentication for the default action
        if (selectedProvider.requiresAuthentication) {
            const authenticated = await ensureAuthentication(context, node);
            if (!authenticated) {
                void context.ui.showWarningMessage(
                    l10n.t('Authentication is required to use this migration provider.'),
                    {
                        modal: true,
                        detail: l10n.t('Please authenticate first by expanding the tree item of the selected cluster.'),
                    },
                );
                return;
            }
        }

        try {
            // Construct the options object with available context
            const credentials = await node.getCredentials();
            if (!credentials) {
                throw new Error(l10n.t('No credentials found for the selected cluster.'));
            }

            const parsedCS_WithCredentials = new DocumentDBConnectionString(credentials.connectionString);
            parsedCS_WithCredentials.username = CredentialCache.getConnectionUser(node.cluster.clusterId) ?? '';
            parsedCS_WithCredentials.password = CredentialCache.getConnectionPassword(node.cluster.clusterId) ?? '';

            const options = {
                connectionString: parsedCS_WithCredentials.toString(),
                extendedProperties: {
                    clusterId: node.cluster.clusterId,
                },
            };

            // Get available actions from the provider
            const availableActions: (QuickPickItem & {
                id: string;
                learnMoreUrl?: string;
                requiresAuthentication?: boolean;
            })[] = (await selectedProvider.getAvailableActions(options)).map((action) => ({
                id: action.id,
                label: action.label,
                detail: action.description,
                iconPath: action.iconPath,
                alwaysShow: action.alwaysShow,
                requiresAuthentication: action.requiresAuthentication,
            }));

            if (availableActions.length === 0) {
                // No actions available, execute default action
                await selectedProvider.executeAction(options);
            } else {
                const learnMoreUrl = selectedProvider.getLearnMoreUrl?.();

                if (learnMoreUrl) {
                    availableActions.push(
                        { id: 'separator', label: '', kind: QuickPickItemKind.Separator },
                        {
                            id: 'learnMore',
                            label: l10n.t('Learn more…'),
                            detail: l10n.t('Learn more about {0}.', selectedProvider.label),
                            learnMoreUrl,
                            alwaysShow: true,
                        },
                    );
                }

                // Show action picker to user
                const selectedAction = await context.ui.showQuickPick(availableActions, {
                    placeHolder: l10n.t('Choose the migration action…'),
                    stepName: 'selectMigrationAction',
                    suppressPersistence: true,
                });

                if (selectedAction.id === 'learnMore') {
                    context.telemetry.properties.migrationLearnMore = 'true';
                    if (selectedAction.learnMoreUrl) {
                        await openUrl(selectedAction.learnMoreUrl);
                    }
                    return;
                }

                // Check if selected action requires authentication
                if (selectedAction.requiresAuthentication) {
                    const authenticated = await ensureAuthentication(context, node);
                    if (!authenticated) {
                        void context.ui.showWarningMessage(l10n.t('Authentication is required to run this action.'), {
                            modal: true,
                            detail: l10n.t(
                                'Please authenticate first by expanding the tree item of the selected cluster.',
                            ),
                        });
                        return;
                    }
                }

                context.telemetry.properties.migrationAction = selectedAction.id;

                // Execute the selected action
                await selectedProvider.executeAction(options, selectedAction.id);
            }
        } catch (error) {
            // Log the error and re-throw to be handled by the caller
            console.error('Error during migration provider execution:', error);
            throw error;
        }
    }
}

/**
 * Ensures the user is authenticated for migration operations.
 *
 * @param _context - The action context for UI operations and telemetry
 * @param _node - The cluster tree item node
 * @returns Promise<boolean> - true if credentials exist, false otherwise
 */
async function ensureAuthentication(_context: IActionContext, _node: ClusterItemBase): Promise<boolean> {
    if (CredentialCache.hasCredentials(_node.cluster.clusterId)) {
        return Promise.resolve(true);
    }
    return Promise.resolve(false);
}
