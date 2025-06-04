/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { commands, QuickPickItemKind, ThemeIcon, type QuickPickItem } from 'vscode';
import { MigrationService } from '../../services/migrationServices';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { openUrl } from '../../utils/openUrl';

export async function chooseDataMigrationExtension(context: IActionContext, _node: CollectionItem) {
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
        commands.executeCommand('workbench.extensions.search', '"Migration Extension for DocumentDB"');
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (migrationProviders.some((provider) => provider.id === selectedItem.id)) {
        const selectedProvider = MigrationService.getProvider(nonNullValue(selectedItem.id, 'selectedItem.id'));

        if (selectedProvider) {
            context.telemetry.properties.migrationProvider = selectedProvider.id;
            await selectedProvider.activate();
        }
    }
}
