/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { CUSTOM_KUBECONFIG_PATH_KEY } from '../config';
import {
    type KubeContextInfo,
    type KubeServiceInfo,
    createCoreApi,
    loadKubeConfig,
    resolveServiceEndpoint,
} from '../kubernetesClient';
import { KubernetesWizardProperties } from './SelectContextStep';

/**
 * Execute step that resolves the selected service's endpoint and sets
 * the connection string on the wizard context.
 */
export class KubernetesExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const selectedContext = context.properties[KubernetesWizardProperties.SelectedContext] as KubeContextInfo;
        const selectedService = context.properties[KubernetesWizardProperties.SelectedService] as KubeServiceInfo;

        if (!selectedContext || !selectedService) {
            throw new Error('Kubernetes context or service not selected.');
        }

        const customPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY);
        const kubeConfig = await loadKubeConfig(customPath);
        const coreApi = await createCoreApi(kubeConfig, selectedContext.name);
        const endpoint = await resolveServiceEndpoint(selectedService, coreApi);

        if (!endpoint.isReachable || !endpoint.connectionString) {
            const reason =
                endpoint.unreachableReason ?? vscode.l10n.t('Service is not reachable from outside the cluster.');
            void vscode.window.showWarningMessage(reason);
            // Still set a placeholder so the wizard can complete with manual editing
            context.connectionString = `mongodb://${selectedService.name}.${selectedService.namespace}.svc.cluster.local:${String(selectedService.port)}/`;
        } else {
            context.connectionString = endpoint.connectionString;
        }

        context.valuesToMask.push(context.connectionString);

        ext.outputChannel.appendLine(
            vscode.l10n.t('Kubernetes service "{0}" resolved to: {1}', selectedService.name, context.connectionString),
        );

        // Clean up wizard properties
        context.properties[KubernetesWizardProperties.SelectedContext] = undefined;
        context.properties[KubernetesWizardProperties.SelectedNamespace] = undefined;
        context.properties[KubernetesWizardProperties.SelectedService] = undefined;
        context.properties[KubernetesWizardProperties.AvailableContexts] = undefined;
    }

    public shouldExecute(): boolean {
        return true;
    }
}
