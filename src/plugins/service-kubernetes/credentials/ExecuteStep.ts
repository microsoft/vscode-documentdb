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
    }

    public shouldExecute(_context: KubernetesCredentialsWizardContext): boolean {
        return true;
    }
}
