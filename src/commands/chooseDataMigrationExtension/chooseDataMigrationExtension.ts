/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { QuickPickItemKind, type QuickPickItem } from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { MigrationService } from '../../services/migrationServices';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { nonNullValue } from '../../utils/nonNull';
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
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

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

    // if (selectedItem.id === 'addMigrationProvider') {
    //     context.telemetry.properties.addMigrationProvider = 'true';
    //     commands.executeCommand('workbench.extensions.search', '"DocumentDB Migration Plugin"');
    //     return;
    // }

    if (migrationProviders.some((provider) => provider.id === selectedItem.id)) {
        const selectedProvider = MigrationService.getProvider(
            nonNullValue(selectedItem.id, 'selectedItem.id', 'chooseDataMigrationExtension.ts'),
        );

        if (selectedProvider) {
            context.telemetry.properties.migrationProvider = selectedProvider.id;

            // Check if the selected provider requires authentication for the default action
            if (selectedProvider.requiresAuthentication) {
                const authenticated = await ensureAuthentication(context, node);
                if (!authenticated) {
                    void context.ui.showWarningMessage(
                        l10n.t('Authentication is required to use this migration provider.'),
                        {
                            modal: true,
                            detail: l10n.t(
                                'Please authenticate first by expanding the tree item of the selected cluster.',
                            ),
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

                // TODO: Include a dialog box for users to approve sharing credentials with a 3rd-party extension
                // This should be done when the provider is used, each time the action states it "requiredAuthentication".
                // We should allow whitelisting extensions trusted by the user to avoid repeated prompts.
                // This could be done on our own but available for the user to edit in settings.
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
                            void context.ui.showWarningMessage(
                                l10n.t('Authentication is required to run this action.'),
                                {
                                    modal: true,
                                    detail: l10n.t(
                                        'Please authenticate first by expanding the tree item of the selected cluster.',
                                    ),
                                },
                            );
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
    if (CredentialCache.hasCredentials(_node.cluster.clusterId)) {
        return Promise.resolve(true); // Credentials already exist, no need to authenticate again
    }

    return Promise.resolve(false); // Return false until implementation is complete
}
