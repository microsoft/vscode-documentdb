/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { CONTEXT_ALIASES_KEY, CUSTOM_KUBECONFIG_PATH_KEY, ENABLED_CONTEXTS_KEY } from '../config';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';

/**
 * Execute step that persists the selected Kubernetes contexts to globalState.
 */
export class ExecuteStep extends AzureWizardExecuteStep<KubernetesCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: KubernetesCredentialsWizardContext): Promise<void> {
        // Persist selected context names
        await ext.context.globalState.update(ENABLED_CONTEXTS_KEY, context.selectedContextNames);

        // Persist custom kubeconfig path (or clear it if empty)
        await ext.context.globalState.update(CUSTOM_KUBECONFIG_PATH_KEY, context.customKubeconfigPath || undefined);

        // Persist aliases (merge with existing, remove aliases for deselected contexts)
        const existingAliases = ext.context.globalState.get<Record<string, string>>(CONTEXT_ALIASES_KEY, {});
        const mergedAliases: Record<string, string> = {};
        for (const name of context.selectedContextNames) {
            if (context.contextAliases[name]) {
                mergedAliases[name] = context.contextAliases[name];
            } else if (existingAliases[name]) {
                mergedAliases[name] = existingAliases[name];
            }
        }
        await ext.context.globalState.update(CONTEXT_ALIASES_KEY, mergedAliases);

        ext.outputChannel.appendLine(
            vscode.l10n.t(
                'Kubernetes discovery configured with {0} context(s).',
                String(context.selectedContextNames.length),
            ),
        );

        context.telemetry.properties.credentialsManagementResult = 'Succeeded';
    }

    public shouldExecute(context: KubernetesCredentialsWizardContext): boolean {
        return context.selectedContextNames.length > 0;
    }
}
