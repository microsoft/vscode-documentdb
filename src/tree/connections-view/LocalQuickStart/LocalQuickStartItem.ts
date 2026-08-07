/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import path from 'path';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { type ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../documentdb/Views';
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
import { containsRetryNode, createRetryNode } from '../../api/retryNode';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../documentdb/ClusterItemBase';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../TreeElementWithRetryChildren';
import { buildClusterTreeItem } from '../clusterItemPresentation';
import { type ConnectionClusterModel } from '../models/ConnectionClusterModel';

/** Base context token for the managed-instance row; menus gate on this + a state token. */
const INSTANCE_CONTEXT = 'treeItem_quickStartInstance';

/**
 * Inline managed-instance cluster item (shown only when Running).
 *
 * Extends {@link ClusterItemBase} directly rather than `DocumentDBClusterItem`: the managed
 * instance is not a stored connection, so every credential path in that class
 * (`ConnectionStorageService.get(storageId, zone)`) misses for this node. Resolving credentials
 * through {@link QuickStartService} instead keeps `CredentialCache` a cache rather than the
 * source of truth. Row presentation is shared via `buildClusterTreeItem` so the node still looks
 * like any other local connection.
 */
class QuickStartClusterItem extends ClusterItemBase<ConnectionClusterModel> {
    constructor(
        model: TreeCluster<ConnectionClusterModel>,
        description: string,
        stateToken: string,
        private readonly alias: string,
    ) {
        super(model);
        this.descriptionOverride = description;
        this.contextValue = createContextValue([INSTANCE_CONTEXT, stateToken]);
    }

    /**
     * Keep the shared cluster presentation (icon, security tooltip) but force the state-aware
     * description — the TLS/SSL badge it would otherwise carry replaces the managed-instance
     * state label (e.g. "Running · localhost:10260").
     */
    public override getTreeItem(): vscode.TreeItem {
        return {
            ...buildClusterTreeItem({ id: this.id, contextValue: this.contextValue, cluster: this.cluster }),
            description: this.descriptionOverride,
        };
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        const connectionString = await QuickStartService.readStoredConnectionString(this.alias);
        if (!connectionString) {
            return undefined;
        }

        const parsed = new DocumentDBConnectionString(connectionString);
        return {
            connectionString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: AuthMethodId.NativeAuth,
            nativeAuthConfig: { connectionUser: parsed.username, connectionPassword: parsed.password },
        };
    }

    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling('connect', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.ConnectionsView;
            context.telemetry.properties.connectionInitiatedFrom = Views.ConnectionsView;
            context.telemetry.properties.connectionType = 'localQuickStart';

            const connectionString = await QuickStartService.readStoredConnectionString(this.alias);
            if (!connectionString) {
                return null;
            }

            const parsed = new DocumentDBConnectionString(connectionString);
            if (parsed.password) {
                context.valuesToMask.push(parsed.password);
            }

            CredentialCache.setAuthCredentials(
                this.cluster.clusterId,
                AuthMethodId.NativeAuth,
                connectionString,
                { connectionUser: parsed.username, connectionPassword: parsed.password },
                this.cluster.emulatorConfiguration,
            );

            return this.getClientWithProgress(this.cluster.clusterId);
        });

        return result ?? null;
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
export class LocalQuickStartItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string = 'treeItem_localQuickStart';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localQuickStart`;
    }

    /**
     * Lets `BaseExtendedTreeDataProvider` cache the failed children (review §9.2 Q4 / I2-Q2): a
     * PASSIVE refresh — a parent/whole-view refresh or an `ext.state` transition — then reuses them
     * instead of re-running the failing operation, while clicking the retry node resets the cache
     * (`resetNodeErrorState`) and genuinely retries.
     */
    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return containsRetryNode(children);
    }

    /**
     * Actionable recovery for a GENUINE failure (review §9.2 Q4 / N3). The tree renders recovery
     * ACTIONS, not error text: a retry node that reopens the wizard (the operation that failed —
     * see I2-Q2), the setup log, and — once a container exists — Delete Container.
     *
     * `Missing` and `CredentialsMissing` deliberately do NOT come here: they are service states
     * with their own actionable rows, not fetch failures (I2-Q5).
     */
    private createErrorRecoveryChildren(includeDelete: boolean): TreeElement[] {
        const children: TreeElement[] = [
            createRetryNode(this.id, this, { commandId: 'vscode-documentdb.command.localQuickStart.open' }),
            createGenericElementWithContext({
                id: `${this.id}/viewLogs`,
                contextValue: 'error',
                label: l10n.t('Click here to view the setup log'),
                iconPath: new vscode.ThemeIcon('output'),
                commandId: 'vscode-documentdb.command.localQuickStart.viewLogs',
            }),
        ];

        if (includeDelete) {
            children.push(
                createGenericElementWithContext({
                    id: `${this.id}/delete`,
                    contextValue: 'error',
                    label: l10n.t('Click here to delete the container and start over'),
                    iconPath: new vscode.ThemeIcon('trash'),
                    commandId: 'vscode-documentdb.command.localQuickStart.delete',
                }),
            );
        }

        return children;
    }

    async getChildren(): Promise<TreeElement[]> {
        // Never block the row on Docker (review M6): the Connections view re-runs getChildren() on
        // many unrelated events, so the freshness probe is kicked off in the background (rate-limited
        // and de-duplicated by the service) and the row is redrawn by onDidChangeStatus when it lands.
        QuickStartService.refreshLiveStateInBackground();

        const status: QuickStartStatus = QuickStartService.getStatus();
        const metadata = status.metadata;

        /** Append the in-flight-probe hint so a row rendered from cache says so. */
        const withRefreshHint = (description: string): string =>
            QuickStartService.isRefreshingLiveState ? l10n.t('{0} · Refreshing…', description) : description;

        // Missing badge (design §6.1): metadata exists but Docker has no container.
        if (metadata && status.missing) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/instance`,
                    contextValue: createContextValue([INSTANCE_CONTEXT, 'state_missing']),
                    label: l10n.t('DocumentDB Local'),
                    description: withRefreshHint(l10n.t('Missing · click to recreate')),
                    tooltip: l10n.t(
                        'The container was removed outside VS Code. Click to recreate it (your data is preserved), or use Delete Container to remove it and its data.',
                    ),
                    iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
                    commandId: 'vscode-documentdb.command.localQuickStart.open',
                }),
            ];
        }

        if (metadata && status.state === InstanceState.Running) {
            // M7: the tree model's connection string is display-only (hosts, TLS badge). Credentials are
            // resolved from QuickStartService at connect time, so the generated userinfo is stripped here.
            const displayConnectionString = new DocumentDBConnectionString(metadata.connectionString);
            displayConnectionString.username = '';
            displayConnectionString.password = '';

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
                connectionString: displayConnectionString.toString(),
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
                selectedAuthMethod: AuthMethodId.NativeAuth,
                connectionUser: metadata.username,
            };
            return [
                new QuickStartClusterItem(
                    model,
                    withRefreshHint(l10n.t('Running · localhost:{0}', metadata.boundPort)),
                    'state_running',
                    metadata.alias,
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
                            withRefreshHint(l10n.t('Stopped · localhost:{0}', port)),
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
                        ...this.createErrorRecoveryChildren(true),
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

        // A wizard failure that never got as far as creating anything (no metadata) is still
        // reported here, but as ACTIONABLE recovery nodes rather than the message-only row this
        // used to push (review N3). There is no container yet, so Delete is not offered.
        if (status.state === InstanceState.Error) {
            children.push(...this.createErrorRecoveryChildren(false));
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
