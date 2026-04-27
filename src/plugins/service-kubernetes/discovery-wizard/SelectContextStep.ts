/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { ENABLED_CONTEXTS_KEY, HIDDEN_CONTEXTS_KEY, resolveEnabledContextNames } from '../config';
import { getContexts, loadConfiguredKubeConfig, type KubeContextInfo } from '../kubernetesClient';

export enum KubernetesWizardProperties {
    AvailableContexts = 'k8sAvailableContexts',
    SelectedContext = 'k8sSelectedContext',
    SelectedService = 'k8sSelectedService',
}

/**
 * Wizard step for selecting a Kubernetes context in the new-connection flow.
 */
export class SelectContextStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const configuredEnabledContextNames = ext.context.globalState.get<string[] | undefined>(ENABLED_CONTEXTS_KEY);
        const hiddenContextNames = ext.context.globalState.get<string[]>(HIDDEN_CONTEXTS_KEY, []);

        const kubeConfig = await loadConfiguredKubeConfig();
        const allContexts = getContexts(kubeConfig);
        const enabledContextNames = new Set(
            resolveEnabledContextNames(
                allContexts.map((ctx) => ctx.name),
                configuredEnabledContextNames,
            ),
        );

        const contexts = allContexts.filter(
            (ctx) => enabledContextNames.has(ctx.name) && !hiddenContextNames.includes(ctx.name),
        );

        if (contexts.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'No visible Kubernetes contexts remain. Use Filter to show hidden contexts or Manage Credentials to enable contexts.',
                ),
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
