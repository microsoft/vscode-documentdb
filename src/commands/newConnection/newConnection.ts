/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionModeStep } from './PromptConnectionModeStep';

export async function newConnection(context: IActionContext): Promise<void> {
    const parentId: string = '';

    const wizardContext: NewConnectionWizardContext = {
        ...context,
        parentId,
        properties: {},
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('New Connection'),
        // TODO: a plug here to esure merge-compatibility with the old code, simplify once the sync-merge procedure is done
        promptSteps: [new PromptConnectionModeStep()],
        executeSteps: [],
        showLoadingPrompt: true,
        hideStepCount: true, // it's incorrect as we have optional steps and subwizards: better hide the count
    });

    await wizard.prompt();
    await wizard.execute();
}
