/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

/**
 * Execute step for MongoDB Atlas discovery wizard
 * Minimal implementation for now - demonstrates the pattern
 */
export class AtlasExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(_context: NewConnectionWizardContext): Promise<void> {
        // For minimal implementation, just show a message
        // In a full implementation, this would:
        // 1. Collect Atlas credentials
        // 2. Use AtlasApiClient to discover projects/clusters
        // 3. Present selection UI
        // 4. Set context.connectionString

        const message = l10n.t(
            'MongoDB Atlas discovery is not yet fully implemented. This demonstrates the programmatic API client structure.',
        );

        void vscode.window.showInformationMessage(message);

        // Throw error to prevent wizard completion since this is just a demo
        throw new Error(l10n.t('Atlas discovery wizard not yet implemented'));
    }

    public shouldExecute(): boolean {
        return true;
    }
}