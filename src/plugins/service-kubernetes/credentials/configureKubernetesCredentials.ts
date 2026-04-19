/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ExecuteStep } from './ExecuteStep';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';
import { SelectContextsStep } from './SelectContextsStep';
import { SelectKubeconfigSourceStep } from './SelectKubeconfigSourceStep';

/**
 * Configures Kubernetes credentials by letting the user select kubeconfig contexts
 * to enable for service discovery.
 */
export async function configureKubernetesCredentials(context: IActionContext): Promise<void> {
    context.telemetry.properties.credentialsManagementAction = 'configure';

    const wizardContext: KubernetesCredentialsWizardContext = {
        ...context,
        availableContexts: [],
        selectedContextNames: [],
        customKubeconfigPath: '',
        contextAliases: {},
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscode.l10n.t('Configure Kubernetes Discovery'),
        promptSteps: [new SelectKubeconfigSourceStep(), new SelectContextsStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    ext.outputChannel.appendLine(vscode.l10n.t('Kubernetes credentials configuration completed.'));
}
