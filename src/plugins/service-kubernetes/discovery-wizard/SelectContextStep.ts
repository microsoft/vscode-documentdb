/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { QuickPickItemKind, ThemeIcon } from 'vscode';
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

type SelectContextPickData = ContextPickData | 'addSource';

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
        const picks: IAzureQuickPickItem<SelectContextPickData>[] = [
            {
                label: vscode.l10n.t('Add Kubeconfig…'),
                detail: vscode.l10n.t('Add or manage sources to see more contexts.'),
                iconPath: new ThemeIcon('plug'),
                alwaysShow: true,
                data: 'addSource',
            },
            {
                label: '',
                kind: QuickPickItemKind.Separator,
                data: 'addSource',
            },
        ];

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

        const selected = await context.ui.showQuickPick(picks, {
            placeHolder: vscode.l10n.t('Select a Kubernetes context'),
            suppressPersistence: true,
        });

        if (selected.data === 'addSource') {
            const { addKubeconfigSource } = await import('../commands/addKubeconfigSource');
            // If the user cancels the inner picker, UserCancelledError propagates
            // naturally and the retry modal below is never reached.
            await addKubeconfigSource(context);
            await this.showRetryInstructions();
            throw new UserCancelledError('Kubeconfig source management completed');
        }

        context.properties[KubernetesWizardProperties.SelectedSourceId] = selected.data.source.id;
        context.properties[KubernetesWizardProperties.SelectedSourceLabel] = selected.data.source.label;
        context.properties[KubernetesWizardProperties.SelectedContext] = selected.data.contextInfo;
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async showRetryInstructions(): Promise<void> {
        await vscode.window.showInformationMessage(
            vscode.l10n.t('Kubeconfig Source Added'),
            {
                modal: true,
                detail: vscode.l10n.t(
                    'The kubeconfig source management flow has completed.\n\nPlease try Service Discovery again to see your available contexts.',
                ),
            },
            vscode.l10n.t('OK'),
        );
    }
}
