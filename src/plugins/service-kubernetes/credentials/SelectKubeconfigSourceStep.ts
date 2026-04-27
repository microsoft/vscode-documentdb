/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { INLINE_KUBECONFIG_SECRET_KEY, KUBECONFIG_SOURCE_KEY, type KubeconfigSource } from '../config';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';

/**
 * Wizard step for selecting the kubeconfig source.
 */
export class SelectKubeconfigSourceStep extends AzureWizardPromptStep<KubernetesCredentialsWizardContext> {
    public async prompt(context: KubernetesCredentialsWizardContext): Promise<void> {
        const currentSource = ext.context.globalState.get<KubeconfigSource>(KUBECONFIG_SOURCE_KEY, 'default');

        // Ask user to choose kubeconfig source
        const defaultOption: IAzureQuickPickItem<KubeconfigSource> = {
            label: vscode.l10n.t('Default kubeconfig (~/.kube/config)'),
            description: vscode.l10n.t('Uses KUBECONFIG env var or ~/.kube/config'),
            data: 'default',
            picked: currentSource === 'default',
        };

        const customOption: IAzureQuickPickItem<KubeconfigSource> = {
            label: vscode.l10n.t('Custom kubeconfig file…'),
            description: vscode.l10n.t('Browse for a kubeconfig file'),
            data: 'customFile',
            picked: currentSource === 'customFile',
        };

        const inlineOption: IAzureQuickPickItem<KubeconfigSource> = {
            label: vscode.l10n.t('Paste kubeconfig YAML from clipboard'),
            description: vscode.l10n.t('Uses the current clipboard text as kubeconfig YAML'),
            data: 'inline',
            picked: currentSource === 'inline',
        };

        const selected = await context.ui.showQuickPick([defaultOption, customOption, inlineOption], {
            placeHolder: vscode.l10n.t('Select kubeconfig source'),
            suppressPersistence: true,
        });

        let kubeconfigPath: string | undefined;
        let kubeconfigYaml = '';

        if (selected.data === 'customFile') {
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
                if (context.customKubeconfigPath) {
                    kubeconfigPath = context.customKubeconfigPath;
                } else {
                    throw new UserCancelledError();
                }
            } else {
                kubeconfigPath = fileUri[0].fsPath;
            }
        } else if (selected.data === 'inline') {
            const clipboardText = (await vscode.env.clipboard.readText()).trim();
            if (clipboardText.length > 0) {
                kubeconfigYaml = clipboardText;
            } else if (currentSource === 'inline') {
                try {
                    kubeconfigYaml = (await ext.secretStorage.get(INLINE_KUBECONFIG_SECRET_KEY)) ?? '';
                } catch {
                    kubeconfigYaml = '';
                }
            }

            if (kubeconfigYaml.length === 0) {
                void vscode.window.showWarningMessage(
                    vscode.l10n.t('Clipboard does not contain kubeconfig YAML. Copy it first and try again.'),
                );
                throw new UserCancelledError();
            }
        }

        context.kubeconfigSource = selected.data;
        context.customKubeconfigPath = kubeconfigPath ?? '';
        context.inlineKubeconfigYaml = kubeconfigYaml;

        context.telemetry.properties.kubeconfigSource = selected.data;
    }

    public shouldPrompt(_context: KubernetesCredentialsWizardContext): boolean {
        return true;
    }
}
