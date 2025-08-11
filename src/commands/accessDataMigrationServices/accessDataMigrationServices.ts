/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { commands, QuickPickItemKind, type QuickPickItem } from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { MigrationService } from '../../services/migrationServices';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { openUrl } from '../../utils/openUrl';

const ANNOUNCED_PROVIDER_PREFIX = 'announced-provider';

export async function accessDataMigrationServices(context: IActionContext, node: ClusterItemBase) {
    const installedProviders: (QuickPickItem & { id: string })[] = MigrationService.listProviders()
        // Map to QuickPickItem format
        .map((provider) => ({
            id: provider.id,
            label: provider.label,
            detail: provider.description,
            iconPath: provider.iconPath,

            group: 'Installed Providers',
            alwaysShow: true,
        }))
        // Sort alphabetically
        .sort((a, b) => a.label.localeCompare(b.label));

    const announcedProviders: (QuickPickItem & { id: string })[] = MigrationService.listAnnouncedProviders(true)
        // Map to QuickPickItem format
        .map((provider) => ({
            id: `${ANNOUNCED_PROVIDER_PREFIX}-${provider.id}`, // please note, the prefix is a magic string here, and needed to correctly support vs code marketplace integration
            label: `$(extensions) ${provider.name}`,
            detail: `Open the VS Code Marketplace to learn more about "${provider.name}"`,
            url: provider.url,

            marketplaceId: provider.id,
            group: 'Visit Marketplace',
            alwaysShow: true,
        }))
        // Sort alphabetically
        .sort((a, b) => a.label.localeCompare(b.label));

    const commonItems = [
        // {
        //     id: 'addMigrationProvider',
        //     label: l10n.t('Add New Migration Provider…'),
        //     detail: l10n.t('Explore more data migration providers.'),
        //     iconPath: new ThemeIcon('plus'),

        //     group: 'Migration Providers',
        //     alwaysShow: true,
        // },
        { label: '', kind: QuickPickItemKind.Separator },
        {
            id: 'learnMore',
            label: l10n.t('Learn more…'),
            detail: l10n.t('Learn more about DocumentDB and MongoDB migrations.'),

            url: 'https://aka.ms/vscode-documentdb-migration-support',

            group: 'Learn More',
            alwaysShow: true,
        },
    ];

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

    if (selectedItem.id === 'learnMore') {
        context.telemetry.properties.migrationLearnMore = 'true';
        if ('url' in selectedItem && selectedItem.url) {
            await openUrl(selectedItem.url);
        }
    }

    if (selectedItem.id?.startsWith(ANNOUNCED_PROVIDER_PREFIX)) {
        context.telemetry.properties.migrationAddProvider = 'true';
        if ('marketplaceId' in selectedItem && selectedItem.marketplaceId) {
            commands.executeCommand('extension.open', selectedItem.marketplaceId);
        }
    }

    // if (selectedItem.id === 'addMigrationProvider') {
    //     context.telemetry.properties.addMigrationProvider = 'true';
    //     commands.executeCommand('workbench.extensions.search', '"DocumentDB Migration Plugin"');
    //     return;
    // }

    if (installedProviders.some((provider) => provider.id === selectedItem.id)) {
        const selectedProvider = MigrationService.getProvider(nonNullValue(selectedItem.id, 'selectedItem.id'));

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
            const options = {
                connectionString: await node.getConnectionString(),
                extendedProperties: {
                    clusterId: node.cluster.id,
                },
            };

            // Get available actions from the provider
            const availableActions = await selectedProvider.getAvailableActions(options);

            if (availableActions.length === 0) {
                // No actions available, execute default action
                return selectedProvider.executeAction(options);
            }

            // Extend actions with Learn More option if provider has a learn more URL
            const extendedActions: (QuickPickItem & {
                id: string;
                url?: string;
                requiresAuthentication?: boolean;
            })[] = [...availableActions];

            const url = selectedProvider.getLearnMoreUrl?.();

            if (url) {
                extendedActions.push(
                    { id: 'separator', label: '', kind: QuickPickItemKind.Separator },
                    {
                        id: 'learnMore',
                        label: l10n.t('Learn more…'),
                        detail: l10n.t('Learn more about {0}.', selectedProvider.label),
                        url,
                        alwaysShow: true,
                    },
                );
            }

            // Show action picker to user
            const selectedAction = await context.ui.showQuickPick(extendedActions, {
                placeHolder: l10n.t('Choose the migration action…'),
                stepName: 'selectMigrationAction',
                suppressPersistence: true,
            });

            if (selectedAction.id === 'learnMore') {
                context.telemetry.properties.migrationLearnMore = 'true';
                if (selectedAction.url) {
                    await openUrl(selectedAction.url);
                }
                return;
            }

            // Check if selected action requires authentication
            if (selectedAction.requiresAuthentication) {
                const authenticated = await ensureAuthentication(context, node);
                if (!authenticated) {
                    void context.ui.showWarningMessage(l10n.t('Authentication is required to run this action.'), {
                        modal: true,
                        detail: l10n.t('Please authenticate first by expanding the tree item of the selected cluster.'),
                    });
                    return;
                }
            }

            context.telemetry.properties.migrationAction = selectedAction.id;

            // Execute the selected action
            await selectedProvider.executeAction(options, selectedAction.id);
        } catch (error) {
            // Log the error and re-throw to be handled by the caller
            console.error('Error during migration provider execution:', error);
            throw error;
        }
    }
}

/**
 * Ensures the user is authenticated for migration operations.
 * This function should be implemented to handle the specific authentication flow
 * required by the host extension.
 *
 * @param context - The action context for UI operations and telemetry
 * @returns Promise<boolean> - true if authentication succeeded, false otherwise
 */
async function ensureAuthentication(_context: IActionContext, _node: ClusterItemBase): Promise<boolean> {
    if (CredentialCache.hasCredentials(_node.cluster.id)) {
        return Promise.resolve(true); // Credentials already exist, no need to authenticate again
    }

    return Promise.resolve(false); // Return false until implementation is complete
}
