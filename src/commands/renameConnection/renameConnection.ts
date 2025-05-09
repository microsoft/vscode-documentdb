/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../documentdb/Views';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { refreshView } from '../refreshView/refreshView';
import { PromptNewConnectionNameStep } from './PromptNewConnectionNameStep';
import { ExecuteStep } from './ExecuteStep';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

export async function renameConnection(context: IActionContext, node?: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No cluster selected.'));
    }

    const wizardContext: RenameConnectionWizardContext = {
        ...context,
        originalConnectionName: node.cluster.name,
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Rename Connection'),
        promptSteps: [new PromptNewConnectionNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    await refreshView(context, Views.ConnectionsView);
}
