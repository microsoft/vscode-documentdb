/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY } from '../config';
import { createCoreApi, listNamespaces, loadKubeConfig, type KubeContextInfo } from '../kubernetesClient';
import { KubernetesWizardProperties } from './SelectContextStep';

/**
 * Wizard step for selecting a namespace within the chosen Kubernetes context.
 */
export class SelectNamespaceStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const selectedContext = context.properties[KubernetesWizardProperties.SelectedContext] as
            | KubeContextInfo
            | undefined;

        if (!selectedContext) {
            throw new Error('No Kubernetes context selected.');
        }

        const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
        const kubeConfig = await loadKubeConfig(customPath);
        const coreApi = await createCoreApi(kubeConfig, selectedContext.name);
        const namespaceNames = await listNamespaces(coreApi);

        if (namespaceNames.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('No namespaces found in context "{0}".', selectedContext.name),
            );
            throw new UserCancelledError();
        }

        const picks: IAzureQuickPickItem<string>[] = namespaceNames.map((ns) => ({
            label: ns,
            data: ns,
        }));

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a namespace'),
            suppressPersistence: true,
        });

        context.properties[KubernetesWizardProperties.SelectedNamespace] = selected.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
