/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { type VmFilteringWizardContext } from './VmFilteringWizardContext';

/**
 * Wizard step for configuring Azure VM tag filtering
 */
export class VmTagFilterStep extends AzureWizardPromptStep<VmFilteringWizardContext> {
    public async prompt(context: VmFilteringWizardContext): Promise<void> {
        const defaultTag = ext.context.globalState.get<string>('azure-vm-discovery.tag', 'DocumentDB');

        const result = await context.ui.showInputBox({
            prompt: l10n.t('Enter the Azure VM tag to filter by'),
            value: defaultTag,
            placeHolder: l10n.t('e.g., DocumentDB, Environment, Project'),
            validateInput: (value: string) => {
                if (!value) {
                    return l10n.t('Tag cannot be empty.');
                }
                if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
                    return l10n.t('Tag can only contain alphanumeric characters, underscores, periods, and hyphens.');
                }
                if (value.length > 256) {
                    return l10n.t('Tag cannot be longer than 256 characters.');
                }
                return undefined;
            },
        });

        if (result !== undefined) {
            // Input box returns undefined if cancelled
            await ext.context.globalState.update('azure-vm-discovery.tag', result);
            context.vmTag = result;
            context.telemetry.properties.tagConfigured = 'true';
            context.telemetry.properties.tagValue = result;
        } else {
            context.telemetry.properties.tagConfigured = 'cancelled';
            // Do not change existing tag if cancelled
        }
    }

    public shouldPrompt(_context: VmFilteringWizardContext): boolean {
        return true; // Always show this step
    }
}
