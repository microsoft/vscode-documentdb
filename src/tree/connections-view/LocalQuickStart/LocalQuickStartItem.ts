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
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../../services/localQuickStart/quickStartTypes';
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
}

/**
 * Root node "DocumentDB Local - Quick Start" (WI-6). Renders unconditionally
 * (even with zero saved connections — handled in ConnectionsBranchDataProvider).
 *
 * - No managed instance → a rocket empty-state row that opens the Quick Start
 *   webview, plus a "Learn more…" link.
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

        if (status.state === InstanceState.Provisioning) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/provisioning`,
                    contextValue: 'treeItem_quickStartProvisioning',
                    label: l10n.t('Provisioning… · localhost:10260'),
                    iconPath: new vscode.ThemeIcon('loading~spin'),
                }),
            ];
        }

        // NotInstalled (no metadata) → empty-state rocket + learn more.
        const children: TreeElement[] = [
            createGenericElementWithContext({
                id: `${this.id}/start`,
                contextValue: 'treeItem_quickStartAction',
                label: l10n.t('Quick Start — Install & try DocumentDB locally'),
                iconPath: new vscode.ThemeIcon('rocket'),
                commandId: 'vscode-documentdb.command.localQuickStart.open',
            }),
            createGenericElementWithContext({
                id: `${this.id}/learnMore`,
                contextValue: 'treeItem_quickStartLearnMore',
                label: l10n.t('Learn more…'),
                iconPath: new vscode.ThemeIcon('link-external'),
                commandId: 'vscode.open',
                commandArgs: [vscode.Uri.parse('https://github.com/microsoft/documentdb')],
            }),
        ];

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
