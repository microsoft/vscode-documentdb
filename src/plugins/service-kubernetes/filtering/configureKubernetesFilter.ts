/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import {
    ENABLED_CONTEXTS_KEY,
    FILTERED_NAMESPACES_KEY,
    HIDDEN_CONTEXTS_KEY,
    resolveEnabledContextNames,
} from '../config';
import { getContexts, loadConfiguredKubeConfig } from '../kubernetesClient';
import { FilterContextsStep } from './FilterContextsStep';
import { type KubernetesFilterWizardContext } from './KubernetesFilterWizardContext';

/**
 * Configures Kubernetes discovery context visibility.
 */
export async function configureKubernetesFilter(context: IActionContext): Promise<void> {
    context.telemetry.properties.filterAction = 'configure';

    const configuredEnabledContextNames = ext.context.globalState.get<string[] | undefined>(ENABLED_CONTEXTS_KEY);
    const existingHiddenContexts = ext.context.globalState.get<string[]>(HIDDEN_CONTEXTS_KEY, []);
    const kubeConfig = await loadConfiguredKubeConfig();
    const enabledContextNames = resolveEnabledContextNames(
        getContexts(kubeConfig).map((ctx) => ctx.name),
        configuredEnabledContextNames,
    );

    const wizardContext: KubernetesFilterWizardContext = {
        ...context,
        enabledContextNames,
        visibleContextNames: enabledContextNames.filter((name) => !existingHiddenContexts.includes(name)),
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Configure Kubernetes Discovery Filters'),
        promptSteps: [new FilterContextsStep()],
    });

    await wizard.prompt();

    // Persist filter selections — save hidden contexts separately, leaving ENABLED_CONTEXTS_KEY untouched
    const hiddenContextNames = wizardContext.enabledContextNames.filter(
        (name) => !wizardContext.visibleContextNames.includes(name),
    );
    await ext.context.globalState.update(HIDDEN_CONTEXTS_KEY, hiddenContextNames);

    // Namespace filtering is no longer prompted anywhere; clear stale filters from earlier builds.
    await ext.context.globalState.update(FILTERED_NAMESPACES_KEY, {});

    ext.outputChannel.appendLine(vscode.l10n.t('Kubernetes discovery filters updated.'));
}
