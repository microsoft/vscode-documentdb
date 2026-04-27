/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type KubernetesFilterWizardContext } from './KubernetesFilterWizardContext';

/**
 * Wizard step for filtering which Kubernetes contexts are visible in the discovery tree.
 */
export class FilterContextsStep extends AzureWizardPromptStep<KubernetesFilterWizardContext> {
    public async prompt(context: KubernetesFilterWizardContext): Promise<void> {
        if (context.enabledContextNames.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('No Kubernetes contexts are enabled. Configure credentials first.'),
            );
            context.visibleContextNames = [];
            return;
        }

        const picks: IAzureQuickPickItem<string>[] = context.enabledContextNames.map((name) => ({
            label: name,
            data: name,
        }));

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select contexts to show in the discovery tree'),
            canPickMany: true,
            suppressPersistence: true,
            isPickSelected: (pick) => context.visibleContextNames.includes((pick as IAzureQuickPickItem<string>).data),
        });

        context.visibleContextNames = selected.map((item) => item.data);
        context.telemetry.properties.visibleContextsCount = String(context.visibleContextNames.length);
    }

    public shouldPrompt(context: KubernetesFilterWizardContext): boolean {
        return context.enabledContextNames.length > 0;
    }
}
