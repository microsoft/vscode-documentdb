/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getContexts, loadKubeConfig } from '../kubernetesClient';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';

/**
 * Wizard step for selecting the kubeconfig source and loading available contexts.
 */
export class SelectKubeconfigSourceStep extends AzureWizardPromptStep<KubernetesCredentialsWizardContext> {
    public async prompt(context: KubernetesCredentialsWizardContext): Promise<void> {
        // Ask user to choose kubeconfig source
        const defaultOption: IAzureQuickPickItem<string | undefined> = {
            label: vscode.l10n.t('Default kubeconfig (~/.kube/config)'),
            description: vscode.l10n.t('Uses KUBECONFIG env var or ~/.kube/config'),
            data: undefined,
        };

        const customOption: IAzureQuickPickItem<string | undefined> = {
            label: vscode.l10n.t('Custom kubeconfig file…'),
            description: vscode.l10n.t('Browse for a kubeconfig file'),
            data: 'custom',
        };

        const selected = await context.ui.showQuickPick([defaultOption, customOption], {
            placeHolder: vscode.l10n.t('Select kubeconfig source'),
            suppressPersistence: true,
        });

        let kubeconfigPath: string | undefined;

        if (selected.data === 'custom') {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: vscode.l10n.t('Select kubeconfig file'),
                filters: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'Kubeconfig files': ['yaml', 'yml', 'conf', 'config', '*'],
                },
            });

            if (!fileUri || fileUri.length === 0) {
                // User cancelled file selection — go back
                context.customKubeconfigPath = '';
                return;
            }

            kubeconfigPath = fileUri[0].fsPath;
        }

        context.customKubeconfigPath = kubeconfigPath ?? '';

        // Load the kubeconfig and extract contexts
        const kubeConfig = await loadKubeConfig(kubeconfigPath);
        const contexts = getContexts(kubeConfig);
        context.availableContexts = contexts;

        context.telemetry.properties.kubeconfigSource = kubeconfigPath ? 'custom' : 'default';
        context.telemetry.properties.availableContextsCount = String(contexts.length);
    }

    public shouldPrompt(_context: KubernetesCredentialsWizardContext): boolean {
        return true;
    }
}
