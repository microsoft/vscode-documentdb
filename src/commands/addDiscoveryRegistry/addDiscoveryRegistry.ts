/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type AddRegistryWizardContext } from './AddRegistryWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptRegistryStep } from './PromptRegistryStep';

export async function addDiscoveryRegistry(context: IActionContext): Promise<void> {
    const wizardContext: AddRegistryWizardContext = {
        ...context,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Choose your Service Provider'),
        // TODO: a plug here to esure merge-compatibility with the old code, simplify once the sync-merge procedure is done
        promptSteps: [new PromptRegistryStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
