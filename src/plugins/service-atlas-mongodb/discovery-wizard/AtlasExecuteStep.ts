/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

/**
 * Execute step for the Atlas discovery wizard.
 * Retrieves the connection string from the selected Atlas cluster and sets it on the context.
 */
export class AtlasExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    // eslint-disable-next-line @typescript-eslint/require-await
    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const connectionString = context.properties['atlas.selectedClusterConnectionString'] as string | undefined;

        if (!connectionString) {
            throw new Error(vscode.l10n.t('No Atlas cluster connection string available.'));
        }

        context.connectionString = connectionString;

        // Clean up wizard properties
        context.properties['atlas.selectedClusterConnectionString'] = undefined;
        context.properties['atlas.selectedProject'] = undefined;
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !context.connectionString;
    }
}
