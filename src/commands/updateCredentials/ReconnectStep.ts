/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { refreshView } from '../refreshView/refreshView';
import { type ReconnectContext } from './PromptReconnectStep';

export interface ReconnectExecuteContext extends ReconnectContext {
    clusterId: string;
}

/**
 * Clears cached client and credentials, then refreshes the Connections view.
 *
 * This step always runs after credentials are saved. Without it the tree view
 * would keep using the old cached connection string and the credential update
 * would appear to have no effect.
 *
 * When the user had an active session **and** opted to reconnect, the refresh
 * also triggers a new connection attempt with the updated credentials.
 */
export class ReconnectStep<T extends ReconnectExecuteContext> extends AzureWizardExecuteStep<T> {
    public priority: number = 200;

    public async execute(context: T): Promise<void> {
        await ClustersClient.deleteClient(context.clusterId);
        CredentialCache.deleteCredentials(context.clusterId);
        await refreshView(context, Views.ConnectionsView);

        if (context.shouldReconnect) {
            context.telemetry.properties.reconnected = 'true';
        }
    }

    public shouldExecute(): boolean {
        return true;
    }
}
