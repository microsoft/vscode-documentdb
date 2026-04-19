/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { ENABLED_CONTEXTS_KEY } from '../config';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';

/**
 * Wizard step for selecting which kubeconfig contexts to enable for discovery.
 */
export class SelectContextsStep extends AzureWizardPromptStep<KubernetesCredentialsWizardContext> {
    public async prompt(context: KubernetesCredentialsWizardContext): Promise<void> {
        if (context.availableContexts.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('No Kubernetes contexts found in the selected kubeconfig file.'),
            );
            context.selectedContextNames = [];
            return;
        }

        // Get currently enabled contexts to pre-select them
        const currentlyEnabled = ext.context.globalState.get<string[]>(ENABLED_CONTEXTS_KEY, []);

        const picks: IAzureQuickPickItem<string>[] = context.availableContexts.map((ctx) => ({
            label: ctx.name,
            description: ctx.server ? `(${ctx.server})` : undefined,
            detail: vscode.l10n.t('Cluster: {0}', ctx.cluster),
            data: ctx.name,
            picked: currentlyEnabled.includes(ctx.name),
        }));

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select contexts to enable for Kubernetes discovery'),
            canPickMany: true,
            suppressPersistence: true,
        });

        context.selectedContextNames = selected.map((item) => item.data);
        context.telemetry.properties.selectedContextsCount = String(context.selectedContextNames.length);
    }

    public shouldPrompt(context: KubernetesCredentialsWizardContext): boolean {
        return context.availableContexts.length > 0;
    }
}
