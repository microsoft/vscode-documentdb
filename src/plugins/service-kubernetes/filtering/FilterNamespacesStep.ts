/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY } from '../config';
import { createCoreApi, listNamespaces, loadKubeConfig } from '../kubernetesClient';
import { type KubernetesFilterWizardContext } from './KubernetesFilterWizardContext';

/**
 * Wizard step for filtering which namespaces are visible per context.
 */
export class FilterNamespacesStep extends AzureWizardPromptStep<KubernetesFilterWizardContext> {
    public async prompt(context: KubernetesFilterWizardContext): Promise<void> {
        // For each visible context, let the user filter namespaces
        for (const contextName of context.visibleContextNames) {
            let namespaceNames: string[];
            try {
                const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
                const kubeConfig = await loadKubeConfig(customPath);
                const coreApi = await createCoreApi(kubeConfig, contextName);
                namespaceNames = await listNamespaces(coreApi);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(
                    `[KubernetesDiscovery] Could not list namespaces for context "${contextName}": ${errorMessage}`,
                );
                continue;
            }

            if (namespaceNames.length === 0) {
                continue;
            }

            const currentlyHidden = context.hiddenNamespaces[contextName] ?? [];

            const picks: IAzureQuickPickItem<string>[] = namespaceNames.map((ns) => ({
                label: ns,
                data: ns,
                picked: !currentlyHidden.includes(ns), // Pre-select visible ones
            }));

            const selected = await context.ui.showQuickPick(picks, {
                placeHolder: vscode.l10n.t('Select namespaces to show for context "{0}"', contextName),
                canPickMany: true,
                suppressPersistence: true,
            });

            const selectedNames = new Set(selected.map((item) => item.data));
            // Hidden = all namespaces NOT in the selected set
            context.hiddenNamespaces[contextName] = namespaceNames.filter((ns) => !selectedNames.has(ns));
        }
    }

    public shouldPrompt(context: KubernetesFilterWizardContext): boolean {
        return context.visibleContextNames.length > 0;
    }
}
