/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY, KUBECONFIG_SOURCE_KEY, type KubeconfigSource } from '../config';
import { ExecuteStep } from './ExecuteStep';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';
import { SelectKubeconfigSourceStep } from './SelectKubeconfigSourceStep';

export interface KubernetesCredentialsConfigurationResult {
    readonly kubeconfigChanged: boolean;
}

/**
 * Configures Kubernetes discovery by selecting the kubeconfig source.
 */
export async function configureKubernetesCredentials(
    context: IActionContext,
    options: { resetFilters?: boolean } = {},
): Promise<KubernetesCredentialsConfigurationResult> {
    context.telemetry.properties.credentialsManagementAction = 'configure';
    const kubeconfigSource = ext.context.globalState.get<KubeconfigSource>(KUBECONFIG_SOURCE_KEY, 'default');
    const customKubeconfigPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY, '');

    const wizardContext: KubernetesCredentialsWizardContext = {
        ...context,
        availableContexts: [],
        // undefined = default all contexts from the selected kubeconfig.
        selectedContextNames: undefined,
        customKubeconfigPath,
        kubeconfigSource,
        inlineKubeconfigYaml: '',
        resetFilters: options.resetFilters ?? false,
        kubeconfigChanged: false,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Configure Kubernetes Discovery'),
        promptSteps: [new SelectKubeconfigSourceStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    ext.outputChannel.appendLine(vscode.l10n.t('Kubernetes credentials configuration completed.'));
    return { kubeconfigChanged: wizardContext.kubeconfigChanged };
}
