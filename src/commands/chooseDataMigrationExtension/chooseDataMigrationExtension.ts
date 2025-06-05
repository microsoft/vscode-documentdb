/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { commands, QuickPickItemKind, ThemeIcon, type QuickPickItem } from 'vscode';
import { MigrationService } from '../../services/migrationServices';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { openUrl } from '../../utils/openUrl';

export async function chooseDataMigrationExtension(context: IActionContext, node: ClusterItemBase) {
    const migrationProviders: (QuickPickItem & { id: string })[] = MigrationService.listProviders()
        // Map to QuickPickItem format
        .map((provider) => ({
            id: provider.id,
            label: provider.label,
            detail: provider.description,
            iconPath: provider.iconPath,

            group: 'Migration Providers',
            alwaysShow: true,
        }))
        // Sort alphabetically
        .sort((a, b) => a.label.localeCompare(b.label));

    const commonItems = [
        {
            id: 'addMigrationProvider',
            label: l10n.t('Add New Migration Provider…'),
            detail: l10n.t('Explore more data migration providers.'),
            iconPath: new ThemeIcon('plus'),

            group: 'Migration Providers',
            alwaysShow: true,
        },
        { label: '', kind: QuickPickItemKind.Separator },
        {
            id: 'learnMore',
            label: l10n.t('Learn more…'),
            detail: l10n.t('Learn more about DocumentDB and MongoDB migrations.'),

            learnMoreUrl: 'https://aka.ms/vscode-documentdb-migration-support',
            alwaysShow: true,
            group: 'Learn More',
        },
    ];

    const selectedItem = await context.ui.showQuickPick([...migrationProviders, ...commonItems], {
        enableGrouping: true,
        placeHolder: l10n.t('Choose the data migration provider…'),
        stepName: 'selectMigrationProvider',
        suppressPersistence: true,
    });

    context.telemetry.properties.connectionMode = selectedItem.id;

    if (selectedItem.id === 'learnMore') {
        context.telemetry.properties.migrationLearnMore = 'true';
        if ('learnMoreUrl' in selectedItem && selectedItem.learnMoreUrl) {
            await openUrl(selectedItem.learnMoreUrl);
        }
    }

    if (selectedItem.id === 'addMigrationProvider') {
        context.telemetry.properties.addMigrationProvider = 'true';
        commands.executeCommand('workbench.extensions.search', '"DocumentDB Migration Plugin"');
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (migrationProviders.some((provider) => provider.id === selectedItem.id)) {
        const selectedProvider = MigrationService.getProvider(nonNullValue(selectedItem.id, 'selectedItem.id'));

        if (selectedProvider) {
            context.telemetry.properties.migrationProvider = selectedProvider.id;

            try {
                // Construct the options object with available context
                const options = {
                    connectionString: 'connectionString',
                    extendedProperties: {
                        clusterId: node.cluster.id,
                    },
                };

                // Get available actions from the provider
                const availableActions = await selectedProvider.getAvailableActions(options);

                if (availableActions.length === 0) {
                    // Check if provider requires authentication for default action
                    if (selectedProvider.requiresAuthentication) {
                        const authenticated = await ensureAuthentication(context, node);
                        if (!authenticated) {
                            void context.ui.showWarningMessage(
                                l10n.t('Authentication is required to use this migration provider.'),
                            );
                            return;
                        }
                    }

                    // No actions available, execute default action
                    await selectedProvider.executeAction();
                } else {
                    // Extend actions with Learn More option if provider has a learn more URL
                    const extendedActions: (QuickPickItem & {
                        id: string;
                        learnMoreUrl?: string;
                        requiresAuthentication?: boolean;
                    })[] = [...availableActions];

                    const learnMoreUrl = selectedProvider.getLearnMoreUrl?.();

                    if (learnMoreUrl) {
                        extendedActions.push(
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
                    const selectedAction = await context.ui.showQuickPick(extendedActions, {
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
                            void context.ui.showWarningMessage(l10n.t('Authentication is required for this action.'));
                            return;
                        }
                    }

                    context.telemetry.properties.migrationAction = selectedAction.id;

                    // Execute the selected action
                    await selectedProvider.executeAction(selectedAction.id);
                }
            } catch (error) {
                // Log the error and re-throw to be handled by the caller
                console.error('Error during migration provider execution:', error);
                throw error;
            }
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
    // TODO: Implement authentication logic
    // This could include:
    // - Checking if user is already signed in
    // - Prompting for sign-in if needed
    // - Handling authentication flow
    // - Setting telemetry properties for auth events

    return Promise.resolve(false); // Return false until implementation is complete
}
