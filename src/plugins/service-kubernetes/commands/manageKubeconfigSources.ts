/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DEFAULT_SOURCE_ID, DISCOVERY_PROVIDER_ID, type KubeconfigSourceRecord } from '../config';
import { PortForwardTunnelManager } from '../portForwardTunnel';
import { clearAliasesForSource } from '../sources/aliasStore';
import { readHiddenSourceIds, readSources, removeSource, setHiddenSourceIds } from '../sources/sourceStore';

interface SourceQuickPickItem extends vscode.QuickPickItem {
    readonly source: KubeconfigSourceRecord;
}

const removeButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
};

/**
 * Opens a manage UI for existing kubeconfig sources.
 *
 * The user can:
 *  - Toggle visibility by checking / unchecking entries (persists hidden ids).
 *  - Remove a source via an inline trash button on the entry.
 *
 * The Default source is always shown, always pre-selected, and never removable.
 */
export async function manageKubeconfigSources(context: IActionContext): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'manage';

    const sources = await readSources();
    const hidden = new Set(await readHiddenSourceIds());

    const items = sources.map((source) => buildItem(source));
    items.forEach((it) => {
        // The Default source must remain available — users can hide it from the
        // tree by deselecting it, but they cannot remove the record itself
        // through this picker. The per-source right-click menu still allows
        // explicit removal for advanced users.
        if (it.source.id === DEFAULT_SOURCE_ID) {
            return;
        }
        it.buttons = [{ ...removeButton, tooltip: vscode.l10n.t('Remove "{0}"', it.source.label) }];
    });

    const initialSelection = items.filter((it) => !hidden.has(it.source.id));

    return await new Promise<void>((resolve, reject) => {
        const picker = vscode.window.createQuickPick<SourceQuickPickItem>();
        picker.title = vscode.l10n.t('Manage Kubernetes Kubeconfig Sources');
        picker.placeholder = vscode.l10n.t('Check sources to keep visible. Use the trash icon to remove a source.');
        picker.canSelectMany = true;
        picker.ignoreFocusOut = true;
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;
        picker.items = items;
        picker.selectedItems = initialSelection;

        let resolved = false;
        const finish = (action: () => void) => {
            if (resolved) {
                return;
            }
            resolved = true;
            picker.dispose();
            action();
        };

        // Default source can be deselected (hidden) but not removed.
        // No selection-change handler is needed; both default and custom
        // sources follow the same checkbox semantics.

        picker.onDidTriggerItemButton(async (event) => {
            const target = event.item.source;

            const removeAction = vscode.l10n.t('Remove');
            const choice = await vscode.window.showWarningMessage(
                vscode.l10n.t('Remove kubeconfig source "{0}"?', target.label),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'Saved connections that depend on this source will need to be reconfigured. Active port-forward tunnels for this source will be stopped.',
                    ),
                },
                removeAction,
            );
            if (choice !== removeAction) {
                return;
            }

            try {
                PortForwardTunnelManager.getInstance().stopTunnelsForSource(target.id);
            } catch {
                // Best-effort.
            }
            await removeSource(target.id);
            try {
                await clearAliasesForSource(target.id);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(
                    `[KubernetesDiscovery] Failed to clear aliases for removed source "${target.label}": ${message}`,
                );
            }
            ext.outputChannel.appendLine(vscode.l10n.t('Removed kubeconfig source "{0}".', target.label));
            const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
            refreshKubernetesRoot();

            // Refresh the picker contents.
            const refreshedSources = await readSources();
            const refreshedHidden = new Set(await readHiddenSourceIds());
            const refreshedItems = refreshedSources.map((source) => buildItem(source));
            refreshedItems.forEach((it) => {
                if (it.source.id === DEFAULT_SOURCE_ID) {
                    return;
                }
                it.buttons = [{ ...removeButton, tooltip: vscode.l10n.t('Remove "{0}"', it.source.label) }];
            });
            picker.items = refreshedItems;
            picker.selectedItems = refreshedItems.filter((it) => !refreshedHidden.has(it.source.id));
        });

        picker.onDidAccept(async () => {
            const selectedIds = new Set(picker.selectedItems.map((s) => s.source.id));
            const idsToHide = picker.items.filter((it) => !selectedIds.has(it.source.id)).map((it) => it.source.id);

            await setHiddenSourceIds(idsToHide);
            const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
            refreshKubernetesRoot();
            context.telemetry.properties.kubeconfigSourceResult = 'managed';
            finish(resolve);
        });

        picker.onDidHide(() => {
            finish(() => reject(new UserCancelledError()));
        });

        picker.show();
    });
}

function buildItem(source: KubeconfigSourceRecord): SourceQuickPickItem {
    const description = source.kind === 'file' ? '(file)' : source.kind === 'inline' ? '(pasted YAML)' : '(default)';
    const detail =
        source.kind === 'file'
            ? source.path
            : source.kind === 'inline'
              ? vscode.l10n.t('Stored in VS Code Secret Storage')
              : vscode.l10n.t('Uses KUBECONFIG env var or ~/.kube/config');

    return {
        label: source.label,
        description,
        detail,
        source,
    };
}
