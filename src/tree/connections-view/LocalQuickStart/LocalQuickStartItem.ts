/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import path from 'path';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { StorageZone } from '../../../services/connectionStorageService';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    InstanceState,
    QUICK_START_PORT,
    type QuickStartStatus,
} from '../../../services/localQuickStart/quickStartTypes';
import { getResourcesPath } from '../../../utils/icons';
import { createGenericElementWithContext } from '../../api/createGenericElementWithContext';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { DocumentDBClusterItem } from '../DocumentDBClusterItem';
import { type ConnectionClusterModel } from '../models/ConnectionClusterModel';

/** Base context token for the managed-instance row; menus gate on this + a state token. */
const INSTANCE_CONTEXT = 'treeItem_quickStartInstance';

/**
 * Inline managed-instance cluster item (shown only when Running). Extends the
 * regular cluster item to (a) stamp a state-aware description and (b) carry a
 * Quick-Start-specific context value so the instance shows Quick Start lifecycle
 * actions instead of the generic cluster menus. Browsing reuses the base
 * `DocumentDBClusterItem` (connects via the pre-populated `CredentialCache`).
 */
class QuickStartClusterItem extends DocumentDBClusterItem {
    constructor(model: TreeCluster<ConnectionClusterModel>, description: string, stateToken: string) {
        super(model);
        this.descriptionOverride = description;
        this.contextValue = createContextValue([INSTANCE_CONTEXT, stateToken]);
    }

    /**
     * The base {@link DocumentDBClusterItem.getTreeItem} derives the row description
     * from the TLS/SSL state and ignores `descriptionOverride` — which would replace
     * the managed-instance state label (e.g. "Running · localhost:10260") with a
     * "⚠ TLS/SSL Disabled" badge. Keep the base tree item (icon, security tooltip,
     * context value) but force the state-aware description.
     */
    public override getTreeItem(): vscode.TreeItem {
        return { ...super.getTreeItem(), description: this.descriptionOverride };
    }
}

/**
 * Root node "DocumentDB Local - Quick Start" (WI-6). Renders unconditionally
 * (even with zero saved connections — handled in ConnectionsBranchDataProvider).
 *
 * - No managed instance → a rocket empty-state row that opens the Quick Start
 *   webview.
 * - A managed instance → the inline cluster (Running, expand to browse) or a
 *   state row (Stopped/Starting/Stopping/Missing/Error) carrying lifecycle menus.
 */
export class LocalQuickStartItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem_localQuickStart';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localQuickStart`;
    }

    async getChildren(): Promise<TreeElement[]> {
        // Cheap freshness: reconcile against live Docker state (external changes,
        // other windows) and set the Missing badge if the container vanished.
        await QuickStartService.refreshLiveState();

        const status: QuickStartStatus = QuickStartService.getStatus();
        const metadata = status.metadata;

        // Missing badge (design §6.1): metadata exists but Docker has no container.
        if (metadata && status.missing) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/instance`,
                    contextValue: createContextValue([INSTANCE_CONTEXT, 'state_missing']),
                    label: l10n.t('DocumentDB Local'),
                    description: l10n.t('Missing · click to recreate'),
                    tooltip: l10n.t(
                        'The container was removed outside VS Code. Click to recreate it (your data is preserved), or use Delete Container to remove it and its data.',
                    ),
                    iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
                    commandId: 'vscode-documentdb.command.localQuickStart.open',
                }),
            ];
        }

        if (metadata && status.state === InstanceState.Running) {
            const model: TreeCluster<ConnectionClusterModel> = {
                treeId: `${this.id}/instance`,
                viewId: this.parentId,
                clusterId: metadata.clusterId,
                storageId: metadata.clusterId,
                // The Quick Start managed instance is in-memory (CredentialCache-based) and
                // not stored in any zone; set an explicit storageZone so it never relies on
                // the isEmulator→zone fallback. Storage-targeting commands are gated off this
                // node by its contextValue, so this value is defensive only.
                storageZone: StorageZone.Clusters,
                name: l10n.t('DocumentDB Local'),
                dbExperience: DocumentDBExperience,
                connectionString: metadata.connectionString,
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
                selectedAuthMethod: AuthMethodId.NativeAuth,
                connectionUser: metadata.username,
            };
            return [
                new QuickStartClusterItem(
                    model,
                    l10n.t('Running · localhost:{0}', metadata.boundPort),
                    'state_running',
                ),
            ];
        }

        // Non-running managed states render as a non-browsable row carrying the
        // lifecycle menus (a stopped container can't be connected to / browsed).
        if (metadata) {
            const port = metadata.boundPort;
            const row = (stateToken: string, description: string, icon: vscode.ThemeIcon): TreeElement =>
                createGenericElementWithContext({
                    id: `${this.id}/instance`,
                    contextValue: createContextValue([INSTANCE_CONTEXT, stateToken]),
                    label: l10n.t('DocumentDB Local'),
                    description,
                    iconPath: icon,
                });

            const spin = new vscode.ThemeIcon('loading~spin');
            switch (status.state) {
                case InstanceState.Starting:
                    return [row('state_starting', l10n.t('Starting… · localhost:{0}', port), spin)];
                case InstanceState.Stopping:
                    return [row('state_stopping', l10n.t('Stopping… · localhost:{0}', port), spin)];
                case InstanceState.Stopped:
                    return [
                        row(
                            'state_stopped',
                            l10n.t('Stopped · localhost:{0}', port),
                            new vscode.ThemeIcon('circle-outline'),
                        ),
                    ];
                case InstanceState.Error:
                    return [
                        row(
                            'state_error',
                            status.errorMessage ?? l10n.t('Error · click for details'),
                            new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground')),
                        ),
                    ];
                default:
                    break;
            }
        }

        // Credential-unavailable (UX review #1): a labelled container / ready record exists but its
        // saved credentials are gone, so it can't be opened. Render an ACTIONABLE instance row (not a
        // passive rocket + warning dead end) that carries the Delete menu (its when-clause matches
        // treeItem_quickStartInstance + state_credentialsMissing), so the user can remove it and start
        // over. Delete-only (no browse/start): a single click launches Delete, which shows the standard
        // confirmation dialog, so recovery is discoverable without hunting for the context menu.
        if (status.state === InstanceState.CredentialsMissing) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/instance`,
                    contextValue: createContextValue([INSTANCE_CONTEXT, 'state_credentialsMissing']),
                    label: l10n.t('DocumentDB Local'),
                    description: l10n.t('Credentials missing · click to delete and start over'),
                    tooltip: l10n.t(
                        'Saved credentials for this instance are missing, so it cannot be opened. Click to delete it and start fresh (this erases the data).',
                    ),
                    iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground')),
                    // A single click launches Delete (which shows the standard confirmation dialog),
                    // so the recovery is discoverable without hunting for the context menu (GPT-5.6
                    // review). The confirmation still guards against an accidental click.
                    commandId: 'vscode-documentdb.command.localQuickStart.delete',
                }),
            ];
        }

        if (status.state === InstanceState.Provisioning) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/provisioning`,
                    contextValue: 'treeItem_quickStartProvisioning',
                    label: l10n.t('Provisioning… · localhost:{0}', String(status.port ?? QUICK_START_PORT)),
                    iconPath: new vscode.ThemeIcon('loading~spin'),
                }),
            ];
        }

        // NotInstalled (no metadata) → empty-state row that opens the Quick Start wizard.
        const children: TreeElement[] = [
            createGenericElementWithContext({
                id: `${this.id}/start`,
                contextValue: 'treeItem_quickStartAction',
                label: l10n.t('Click here to set up DocumentDB Local'),
                iconPath: new vscode.ThemeIcon('rocket'),
                commandId: 'vscode-documentdb.command.localQuickStart.open',
            }),
        ];

        // FOLLOW-UP: this row reports a wizard failure in the tree, which is surprising when the
        // user never opened the wizard from here. Decide whether it belongs at all.
        if (status.state === InstanceState.Error && status.errorMessage) {
            children.push(
                createGenericElementWithContext({
                    id: `${this.id}/error`,
                    contextValue: 'treeItem_quickStartError',
                    label: status.errorMessage,
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
            );
        }

        return children;
    }

    private iconPath: IconPath = {
        light: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-light-themes.svg')),
        dark: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-dark-themes.svg')),
    };

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('DocumentDB Local - Quick Start'),
            iconPath: this.iconPath,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        };
    }
}
