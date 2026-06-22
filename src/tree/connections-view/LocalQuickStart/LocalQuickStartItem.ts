/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

/**
 * Inline managed-instance cluster item. Extends the regular cluster item only to
 * stamp a state-aware description (`Running · localhost:<port>`); browsing reuses
 * the base `DocumentDBClusterItem` (which connects via the pre-populated
 * `CredentialCache`, so no re-prompt).
 */
class QuickStartClusterItem extends DocumentDBClusterItem {
    constructor(model: TreeCluster<ConnectionClusterModel>, description: string) {
        super(model);
        this.descriptionOverride = description;
    }
}

/**
 * Root node "DocumentDB Local - Quick Start" (WI-6). Renders unconditionally
 * (even with zero saved connections — handled in ConnectionsBranchDataProvider).
 *
 * - No managed instance → a rocket empty-state row that opens the Quick Start
 *   webview, plus a "Learn more…" link.
 * - A managed instance → the inline cluster (expand to browse, WI-5).
 */
export class LocalQuickStartItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem_localQuickStart';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localQuickStart`;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async getChildren(): Promise<TreeElement[]> {
        const status: QuickStartStatus = QuickStartService.getStatus();

        if (status.metadata && (status.state === InstanceState.Running || status.state === InstanceState.Stopped)) {
            const metadata = status.metadata;
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

            const description =
                status.state === InstanceState.Running
                    ? l10n.t('Running · localhost:{0}', metadata.boundPort)
                    : l10n.t('Stopped · localhost:{0}', metadata.boundPort);

            return [new QuickStartClusterItem(model, description)];
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

        // NotInstalled / Error → empty-state rocket + learn more.
        const children: TreeElement[] = [
            createGenericElementWithContext({
                id: `${this.id}/start`,
                contextValue: 'treeItem_quickStartAction',
                label: l10n.t('Quick Start — Install & try DocumentDB locally'),
                iconPath: new vscode.ThemeIcon('rocket'),
                commandId: 'vscode-documentdb.command.localQuickStart.open',
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
