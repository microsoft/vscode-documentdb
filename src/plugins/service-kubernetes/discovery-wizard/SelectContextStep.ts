/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { type KubeconfigSourceRecord } from '../config';
import { getContexts, loadConfiguredKubeConfig, type KubeContextInfo } from '../kubernetesClient';
import { aliasMapForSource } from '../sources/aliasStore';
import { readSources } from '../sources/sourceStore';

export enum KubernetesWizardProperties {
    SelectedSourceId = 'k8sSelectedSourceId',
    SelectedSourceLabel = 'k8sSelectedSourceLabel',
    SelectedContext = 'k8sSelectedContext',
    SelectedService = 'k8sSelectedService',
}

interface ContextPickData {
    readonly source: KubeconfigSourceRecord;
    readonly contextInfo: KubeContextInfo;
}

/**
 * Wizard step for selecting a Kubernetes context in the new-connection flow.
 *
 * Lists every context from every configured kubeconfig source, identifying the
 * source via the description column so that colliding context names can be
 * disambiguated.
 */
export class SelectContextStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const sources = await readSources();
        const picks: IAzureQuickPickItem<ContextPickData>[] = [];

        for (const source of sources) {
            try {
                const kubeConfig = await loadConfiguredKubeConfig(source.id);
                const contexts = getContexts(kubeConfig);
                contexts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                const aliases = await aliasMapForSource(source.id);
                for (const ctx of contexts) {
                    const alias = aliases.get(ctx.name);
                    const label = alias ?? ctx.name;
                    const aliasHint = alias ? `[${ctx.name}] ` : '';
                    picks.push({
                        label,
                        description: `${aliasHint}(${source.label})${ctx.server ? ` ${ctx.server}` : ''}`,
                        data: { source, contextInfo: ctx },
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(
                    `[KubernetesDiscovery] Skipping source "${source.label}" while building context picker: ${message}`,
                );
            }
        }

        if (picks.length === 0) {
            void vscode.window.showWarningMessage(
                vscode.l10n.t(
                    'No Kubernetes contexts are available across the configured kubeconfig sources. Add a kubeconfig source from the Discovery view and try again.',
                ),
            );
            throw new UserCancelledError();
        }

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a Kubernetes context'),
            suppressPersistence: true,
        });

        context.properties[KubernetesWizardProperties.SelectedSourceId] = selected.data.source.id;
        context.properties[KubernetesWizardProperties.SelectedSourceLabel] = selected.data.source.label;
        context.properties[KubernetesWizardProperties.SelectedContext] = selected.data.contextInfo;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
