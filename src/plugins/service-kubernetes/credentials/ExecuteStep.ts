/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import {
    CUSTOM_KUBECONFIG_PATH_KEY,
    ENABLED_CONTEXTS_KEY,
    FILTERED_NAMESPACES_KEY,
    HIDDEN_CONTEXTS_KEY,
    INLINE_KUBECONFIG_SECRET_KEY,
    KUBECONFIG_SOURCE_KEY,
    type KubeconfigSource,
} from '../config';
import { getContexts, loadKubeConfig, type KubeContextInfo } from '../kubernetesClient';
import { type KubernetesCredentialsWizardContext } from './KubernetesCredentialsWizardContext';

/**
 * Execute step that persists Kubernetes discovery source settings.
 *
 * Kubernetes setup is source-only. Contexts default to all contexts in the selected
 * kubeconfig, and the separate Filter action controls temporary visibility.
 */
export class ExecuteStep extends AzureWizardExecuteStep<KubernetesCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: KubernetesCredentialsWizardContext): Promise<void> {
        const availableContexts = await this.validateSelectedKubeconfig(context);
        context.availableContexts = availableContexts;
        context.telemetry.measurements.kubeconfigContextsCount = availableContexts.length;

        // undefined = never configured (default all-enabled)
        // []        = explicitly zero (all disabled)
        // string[]  = explicit selection
        const enabledContextNames = context.selectedContextNames;

        await ext.context.globalState.update(ENABLED_CONTEXTS_KEY, enabledContextNames);

        // Reset filters on first activation and when the selected kubeconfig changes.
        // Kubeconfig changes can invalidate context names, making existing filter entries meaningless.
        const previousSource = ext.context.globalState.get<KubeconfigSource>(KUBECONFIG_SOURCE_KEY, 'default');
        const previousCustomKubeconfigPath = ext.context.globalState.get<string>(CUSTOM_KUBECONFIG_PATH_KEY, '');
        const currentCustomKubeconfigPath =
            context.kubeconfigSource === 'customFile' ? context.customKubeconfigPath || '' : '';
        let kubeconfigChanged = previousSource !== context.kubeconfigSource;

        if (!kubeconfigChanged && context.kubeconfigSource === 'customFile') {
            kubeconfigChanged = previousCustomKubeconfigPath !== currentCustomKubeconfigPath;
        }

        if (!kubeconfigChanged && context.kubeconfigSource === 'inline') {
            const previousInlineKubeconfigYaml = (await ext.secretStorage.get(INLINE_KUBECONFIG_SECRET_KEY)) ?? '';
            kubeconfigChanged = previousInlineKubeconfigYaml !== context.inlineKubeconfigYaml;
        }

        context.kubeconfigChanged = kubeconfigChanged;

        if (context.resetFilters || kubeconfigChanged) {
            await ext.context.globalState.update(HIDDEN_CONTEXTS_KEY, []);
            await ext.context.globalState.update(FILTERED_NAMESPACES_KEY, {});
        }

        await ext.context.globalState.update(KUBECONFIG_SOURCE_KEY, context.kubeconfigSource);
        await ext.context.globalState.update(
            CUSTOM_KUBECONFIG_PATH_KEY,
            context.kubeconfigSource === 'customFile' ? context.customKubeconfigPath || undefined : undefined,
        );

        if (context.kubeconfigSource === 'inline') {
            if (context.inlineKubeconfigYaml.trim().length === 0) {
                throw new Error(vscode.l10n.t('No kubeconfig YAML was provided.'));
            }

            await ext.secretStorage.store(INLINE_KUBECONFIG_SECRET_KEY, context.inlineKubeconfigYaml);
        } else {
            await ext.secretStorage.delete(INLINE_KUBECONFIG_SECRET_KEY);
        }

        if (enabledContextNames === undefined) {
            ext.outputChannel.appendLine(
                vscode.l10n.t(
                    'Kubernetes discovery configured. All contexts from the selected kubeconfig are enabled by default.',
                ),
            );
        } else if (enabledContextNames.length === 0) {
            ext.outputChannel.appendLine(
                vscode.l10n.t(
                    'Kubernetes discovery configured with no contexts enabled. Discovery is effectively disabled.',
                ),
            );
        } else {
            ext.outputChannel.appendLine(
                vscode.l10n.t(
                    'Kubernetes discovery configured with {0} context(s).',
                    String(enabledContextNames.length),
                ),
            );
        }

        context.telemetry.properties.credentialsManagementResult = 'Succeeded';
        void vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Kubernetes discovery configured. Found {0} context(s) in the selected kubeconfig.',
                String(availableContexts.length),
            ),
        );
    }

    public shouldExecute(_context: KubernetesCredentialsWizardContext): boolean {
        return true;
    }

    private async validateSelectedKubeconfig(context: KubernetesCredentialsWizardContext): Promise<KubeContextInfo[]> {
        let kubeConfig: Awaited<ReturnType<typeof loadKubeConfig>>;
        try {
            kubeConfig = await this.loadSelectedKubeconfig(context);
        } catch (error) {
            context.telemetry.properties.credentialsManagementResult = 'FailedValidation';
            throw error;
        }

        const contexts = getContexts(kubeConfig);
        if (contexts.length === 0) {
            context.telemetry.properties.credentialsManagementResult = 'FailedValidation';
            throw new Error(
                vscode.l10n.t(
                    'No Kubernetes contexts were found in the selected kubeconfig. Choose a different kubeconfig source or update the file and try again.',
                ),
            );
        }

        return contexts;
    }

    private async loadSelectedKubeconfig(
        context: KubernetesCredentialsWizardContext,
    ): Promise<Awaited<ReturnType<typeof loadKubeConfig>>> {
        switch (context.kubeconfigSource) {
            case 'customFile':
                if (!context.customKubeconfigPath) {
                    context.telemetry.properties.credentialsManagementResult = 'FailedValidation';
                    throw new Error(vscode.l10n.t('No custom kubeconfig file was selected.'));
                }
                return await loadKubeConfig(context.customKubeconfigPath);
            case 'inline':
                if (context.inlineKubeconfigYaml.trim().length === 0) {
                    context.telemetry.properties.credentialsManagementResult = 'FailedValidation';
                    throw new Error(vscode.l10n.t('No kubeconfig YAML was provided.'));
                }
                return await loadKubeConfig(undefined, context.inlineKubeconfigYaml);
            case 'default':
            default:
                return await loadKubeConfig();
        }
    }
}
