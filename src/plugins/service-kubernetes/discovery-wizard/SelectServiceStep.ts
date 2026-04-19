/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY } from '../config';
import {
    createCoreApi,
    listDocumentDBServices,
    loadKubeConfig,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KubernetesWizardProperties } from './SelectContextStep';

/**
 * Wizard step for selecting a DocumentDB-compatible service within a namespace.
 */
export class SelectServiceStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const selectedContext = context.properties[KubernetesWizardProperties.SelectedContext] as
            | KubeContextInfo
            | undefined;
        const selectedNamespace = context.properties[KubernetesWizardProperties.SelectedNamespace] as
            | string
            | undefined;

        if (!selectedContext || !selectedNamespace) {
            throw new Error('Kubernetes context or namespace not selected.');
        }

        const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
        const kubeConfig = await loadKubeConfig(customPath);
        const coreApi = await createCoreApi(kubeConfig, selectedContext.name);
        const services = await listDocumentDBServices(coreApi, selectedNamespace);

        if (services.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'No DocumentDB-compatible services found in namespace "{0}". Services must expose port 27017, 27018, or 27019.',
                    selectedNamespace,
                ),
            );
            throw new UserCancelledError();
        }

        const picks: IAzureQuickPickItem<KubeServiceInfo>[] = services.map((svc) => {
            const portDisplay =
                svc.type === 'NodePort' && svc.nodePort ? `:${String(svc.nodePort)}` : `:${String(svc.port)}`;

            return {
                label: svc.name,
                description: `[${svc.type} ${portDisplay}]`,
                data: svc,
            };
        });

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a service to connect to'),
            suppressPersistence: true,
        });

        context.properties[KubernetesWizardProperties.SelectedService] = selected.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
