/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import {
    createCoreApi,
    listDocumentDBServices,
    listNamespaces,
    loadConfiguredKubeConfig,
    type KubeContextInfo,
    type KubeServiceInfo,
} from '../kubernetesClient';
import { KubernetesWizardProperties } from './SelectContextStep';

/**
 * Wizard step for selecting a discovered DocumentDB target in the selected context.
 */
export class SelectServiceStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const selectedContext = context.properties[KubernetesWizardProperties.SelectedContext] as
            | KubeContextInfo
            | undefined;
        const sourceId = context.properties[KubernetesWizardProperties.SelectedSourceId] as string | undefined;

        if (!selectedContext || !sourceId) {
            throw new Error('Kubernetes context not selected.');
        }

        const kubeConfig = await loadConfiguredKubeConfig(sourceId);
        const coreApi = await createCoreApi(kubeConfig, selectedContext.name);
        const namespaceNames = await listNamespaces(coreApi);

        if (namespaceNames.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t('No namespaces found in context "{0}".', selectedContext.name),
            );
            throw new UserCancelledError();
        }

        const servicesByNamespace = await Promise.all(
            namespaceNames.map(async (namespace): Promise<KubeServiceInfo[]> => {
                try {
                    return await listDocumentDBServices(coreApi, namespace, kubeConfig);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    ext.outputChannel.warn(
                        `[KubernetesDiscovery] Could not list DocumentDB targets in "${selectedContext.name}/${namespace}": ${errorMessage}`,
                    );
                    return [];
                }
            }),
        );
        const services = servicesByNamespace.flat();

        if (services.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'No DocumentDB targets were found in context "{0}". DKO resources are preferred, and generic fallback currently looks for DocumentDB gateway services.',
                    selectedContext.name,
                ),
            );
            throw new UserCancelledError();
        }

        const picks: IAzureQuickPickItem<KubeServiceInfo>[] = services.map((svc) => {
            const portDisplay =
                svc.type === 'NodePort' && svc.nodePort ? `:${String(svc.nodePort)}` : `:${String(svc.port)}`;

            return {
                label: svc.displayName,
                description: `[${svc.namespace}] [${svc.sourceKind === 'dko' ? 'DKO' : 'Generic'}] [${svc.type} ${portDisplay}]`,
                detail:
                    svc.sourceKind === 'dko' && svc.status
                        ? vscode.l10n.t('Status: {0}', svc.status)
                        : svc.sourceKind === 'generic'
                          ? vscode.l10n.t('Service-based fallback target')
                          : undefined,
                data: svc,
            };
        });

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a DocumentDB target to connect to'),
            suppressPersistence: true,
        });

        context.properties[KubernetesWizardProperties.SelectedService] = selected.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
