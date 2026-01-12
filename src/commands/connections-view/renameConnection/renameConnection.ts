/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n as vscodel10n } from 'vscode';
import { DocumentDBClusterItem } from '../../../tree/connections-view/DocumentDBClusterItem';
import { ExecuteStep } from './ExecuteStep';
import { PromptNewConnectionNameStep } from './PromptNewConnectionNameStep';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

/**
 * Rename a connection
 */
export async function renameConnection(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(vscodel10n.t('No node selected.'));
    }

    const wizardContext: RenameConnectionWizardContext = {
        ...context,
        originalConnectionName: node.cluster.name,
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
        treeItemPath: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscodel10n.t('Rename Connection'),
        promptSteps: [new PromptNewConnectionNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
