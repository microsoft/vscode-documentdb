/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../../extensionVariables';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CredentialsManagementWizardContext> {
    public priority: number = 100;

    // eslint-disable-next-line @typescript-eslint/require-await
    public async execute(context: CredentialsManagementWizardContext): Promise<void> {
        const executeStartTime = Date.now();
        const selectedAccount = nonNullValue(context.selectedAccount, 'context.selectedAccount', 'ExecuteStep.ts');

        ext.outputChannel.appendLine(l10n.t('Viewing Azure account information for: {0}', selectedAccount.label));

        // Add telemetry for execution
        context.telemetry.properties.filteringActionType = 'accountManagement';

        ext.outputChannel.appendLine(l10n.t('Azure account management wizard completed.'));

        // Add completion telemetry
        context.telemetry.measurements.executionTimeMs = Date.now() - executeStartTime;
    }

    public shouldExecute(context: CredentialsManagementWizardContext): boolean {
        return !!context.selectedAccount && !context.shouldRestartWizard;
    }
}
