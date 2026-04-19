/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ENABLED_CONTEXTS_KEY, FILTERED_NAMESPACES_KEY, HIDDEN_CONTEXTS_KEY } from '../config';
import { FilterContextsStep } from './FilterContextsStep';
import { FilterNamespacesStep } from './FilterNamespacesStep';
import { type KubernetesFilterWizardContext } from './KubernetesFilterWizardContext';

/**
 * Configures Kubernetes discovery filters (contexts and namespaces visibility).
 */
export async function configureKubernetesFilter(context: IActionContext): Promise<void> {
    context.telemetry.properties.filterAction = 'configure';

    const enabledContextNames = ext.context.globalState.get<string[]>(ENABLED_CONTEXTS_KEY, []);
    const existingHiddenNamespaces = ext.context.globalState.get<Record<string, string[]>>(FILTERED_NAMESPACES_KEY, {});
    const existingHiddenContexts = ext.context.globalState.get<string[]>(HIDDEN_CONTEXTS_KEY, []);

    const wizardContext: KubernetesFilterWizardContext = {
        ...context,
        enabledContextNames,
        visibleContextNames: enabledContextNames.filter((name) => !existingHiddenContexts.includes(name)),
        hiddenNamespaces: { ...existingHiddenNamespaces },
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Configure Kubernetes Discovery Filters'),
        promptSteps: [new FilterContextsStep(), new FilterNamespacesStep()],
    });

    await wizard.prompt();

    // Persist filter selections — save hidden contexts separately, leaving ENABLED_CONTEXTS_KEY untouched
    const hiddenContextNames = wizardContext.enabledContextNames.filter(
        (name) => !wizardContext.visibleContextNames.includes(name),
    );
    await ext.context.globalState.update(HIDDEN_CONTEXTS_KEY, hiddenContextNames);

    // Persist namespace filters
    await ext.context.globalState.update(FILTERED_NAMESPACES_KEY, wizardContext.hiddenNamespaces);

    ext.outputChannel.appendLine(vscode.l10n.t('Kubernetes discovery filters updated.'));
}
