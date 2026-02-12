/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { refreshView } from '../refreshView/refreshView';
import { type ReconnectContext } from './PromptReconnectStep';

export interface ReconnectExecuteContext extends ReconnectContext {
    clusterId: string;
    /** Tree-view node ID, needed to reset the error state when reconnecting. */
    nodeId?: string;
}

/**
 * Invalidates cached client/credentials and refreshes the Connections view.
 *
 * Always runs after credentials are saved so the tree picks up the new values.
 * When the user chose to reconnect from an error node, the error state is
 * cleared first, allowing the refresh to trigger a fresh connection attempt.
 */
export class ReconnectStep<T extends ReconnectExecuteContext> extends AzureWizardExecuteStep<T> {
    public priority: number = 200;

    public async execute(context: T): Promise<void> {
        await ClustersClient.deleteClient(context.clusterId);
        CredentialCache.deleteCredentials(context.clusterId);

        if (context.reconnectAfterError && context.nodeId) {
            ext.connectionsBranchDataProvider.resetNodeErrorState(context.nodeId);
            context.telemetry.properties.reconnected = 'true';
        }

        await refreshView(context, Views.ConnectionsView);
    }

    public shouldExecute(): boolean {
        return true;
    }
}
