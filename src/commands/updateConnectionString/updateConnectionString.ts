/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { maskSensitiveValuesInTelemetry } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { refreshView } from '../refreshView/refreshView';
import { ConnectionStringStep } from './ConnectionStringStep';
import { ExecuteStep } from './ExecuteStep';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export async function updateConnectionString(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    // Extract the connection string but hide the username and password

    // Note to future maintainers: the node.cluster might be out of date
    // as the object is cached in the tree view, and in the 'retry/error' nodes
    // that's why we need to get the fresh one each time.

    const resourceType = node.cluster.emulatorConfiguration?.isEmulator
        ? ConnectionType.Emulators
        : ConnectionType.Clusters;
    const connection = await ConnectionStorageService.get(node.storageId, resourceType);
    const connectionString = connection?.secrets?.connectionString || '';

    context.valuesToMask.push(connectionString);

    const parsedCS = new DocumentDBConnectionString(connectionString);
    maskSensitiveValuesInTelemetry(context, parsedCS);

    parsedCS.username = '';
    parsedCS.password = '';

    const wizardContext: UpdateCSWizardContext = {
        ...context,
        originalCS_NoCredentials: parsedCS.toString(),
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update Connection String'),
        promptSteps: [new ConnectionStringStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    await refreshView(context, Views.ConnectionsView);
}
