/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { commands, l10n, window } from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';

export async function manageCredentials(context: IActionContext, node: TreeElement): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }
    /**
     * We can extract the provider id from the node instead of hardcoding it
     * by accessing the node.id and looking from the start for the id in the following format
     *
     * node.id = '${Views.DiscoveryView}/<providerId>/potential/elements/thisNodesId'
     *
     * first, we'll verify that the id is in the format expected, if not, we'll return with an error
     */

    const idSections = node.id.split('/');
    const isValidFormat =
        idSections.length >= 2 && idSections[0] === String(Views.DiscoveryView) && idSections[1].length > 0;

    if (!isValidFormat) {
        context.telemetry.properties.result = 'Failed';
        context.telemetry.properties.errorReason = 'invalidNodeIdFormat';
        ext.outputChannel.error('Internal error: Node id is not in the expected format.');
        return;
    }

    const providerId = idSections[1];
    context.telemetry.properties.discoveryProviderId = providerId;
    const provider = DiscoveryService.getProvider(providerId);

    if (!provider?.configureCredentials) {
        context.telemetry.properties.result = 'Failed';
        context.telemetry.properties.errorReason = 'noConfigureCredentialsFunction';
        ext.outputChannel.error(`No management function provided by the provider with the id "${providerId}".`);
        return;
    }

    try {
        // Call the filter function provided by the provider
        await provider.configureCredentials(context, node as TreeElement);

        // Refresh the discovery branch data provider to show the updated list
        ext.discoveryBranchDataProvider.refresh(node as TreeElement);

        context.telemetry.properties.result = 'Succeeded';

        // Only show notification if credentials were actually managed successfully (user didn't cancel)
        // TODO: this is not the best way to do this, but this feature has to ship. Refactor to expose results as a result object
        if (context.telemetry.properties.credentialsManagementResult === 'Succeeded') {
            // Show informational message about potential entry filtering conflicts
            // This is only shown when credentials are managed from explicit commands, not from wizards,
            // because that's where users interact with settings explicitly and the message makes sense.
            // Adding it to every call to the management wizard might put too high mental load on the user.
            if (provider?.configureTreeItemFilter) {
                const filterAction = l10n.t('Filter Entries Now');
                const cancelAction = l10n.t('Cancel');
                const selectedAction = await window.showInformationMessage(
                    l10n.t(
                        'Credential update completed. If you don\'t see expected entries, use the optional "Filter Entries…" option to adjust your filters.',
                    ),
                    filterAction,
                    cancelAction,
                );

                if (selectedAction === filterAction) {
                    await commands.executeCommand(
                        'vscode-documentdb.command.discoveryView.filterProviderContent',
                        node,
                    );
                }
                // If selectedAction === cancelAction or undefined (ESC pressed), we do nothing
            } else {
                void window.showInformationMessage(l10n.t('Credential update completed.'));
            }
        }
    } catch (error) {
        context.telemetry.properties.result = 'Failed';
        context.telemetry.properties.errorReason = 'configureCredentialsThrew';
        throw error;
    }
}
