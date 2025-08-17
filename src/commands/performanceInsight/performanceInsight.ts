/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { ensureLlmConfigured } from '../../utils/llmHelpers';
import { withProgress } from '../../utils/withProgress';

export async function performanceInsight(context: IActionContext, databaseItem: DatabaseItem): Promise<void> {
    // Check if LLM is configured and prompt user if not
    const isLlmConfigured = await ensureLlmConfigured(context, 'performanceInsight');
    if (!isLlmConfigured) {
        return; // User declined to configure LLM or configuration failed
    }

    const performanceOperation = async (): Promise<void> => {
        const client: ClustersClient = await ClustersClient.getClient(databaseItem.cluster.id);
        const result = await client.runProfileCommand(databaseItem.databaseInfo.name);

        const label = `Performance-Insight-${databaseItem.databaseInfo.name}`;
        const fullId = `${databaseItem.cluster.name}/${label}`;

        await openReadOnlyContent({ label, fullId }, JSON.stringify(result, null, 2), '.json', {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false,
        });
    };

    await withProgress(
        performanceOperation(),
        l10n.t('Getting performance insights for database "{0}"…', databaseItem.databaseInfo.name),
    );
}
