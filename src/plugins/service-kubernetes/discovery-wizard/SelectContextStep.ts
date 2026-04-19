/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY, ENABLED_CONTEXTS_KEY } from '../config';
import { getContexts, loadKubeConfig, type KubeContextInfo } from '../kubernetesClient';

export enum KubernetesWizardProperties {
    AvailableContexts = 'k8sAvailableContexts',
    SelectedContext = 'k8sSelectedContext',
    SelectedNamespace = 'k8sSelectedNamespace',
    SelectedService = 'k8sSelectedService',
}

/**
 * Wizard step for selecting a Kubernetes context in the new-connection flow.
 */
export class SelectContextStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
        const enabledContextNames = ext.context.globalState.get<string[]>(ENABLED_CONTEXTS_KEY, []);

        const kubeConfig = await loadKubeConfig(customPath);
        const allContexts = getContexts(kubeConfig);

        // Filter to enabled contexts
        const contexts = allContexts.filter((ctx) => enabledContextNames.includes(ctx.name));

        if (contexts.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('No Kubernetes contexts are configured. Use "Manage Credentials" to set up contexts.'),
            );
            throw new UserCancelledError();
        }

        context.properties[KubernetesWizardProperties.AvailableContexts] = allContexts;

        const picks: IAzureQuickPickItem<KubeContextInfo>[] = contexts.map((ctx) => ({
            label: ctx.name,
            description: ctx.server ? `(${ctx.server})` : undefined,
            data: ctx,
        }));

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a Kubernetes context'),
            suppressPersistence: true,
        });

        context.properties[KubernetesWizardProperties.SelectedContext] = selected.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
