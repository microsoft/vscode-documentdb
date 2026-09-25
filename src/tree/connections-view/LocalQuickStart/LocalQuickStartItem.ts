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
import { ext } from '../../../extensionVariables';
import { StorageZone } from '../../../services/connectionStorageService';
import {
    QuickStartService,
    type QuickStartConnectionPreflightResult,
} from '../../../services/localQuickStart/QuickStartService';
import {
    InstanceState,
    type DockerReadiness,
    type QuickStartStatus,
} from '../../../services/localQuickStart/quickStartTypes';
import { getResourcesPath } from '../../../utils/icons';
import { createGenericElementWithContext } from '../../api/createGenericElementWithContext';
import { containsRetryNode } from '../../api/retryNode';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../documentdb/ClusterItemBase';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../TreeElementWithRetryChildren';
import { buildClusterTreeItem } from '../clusterItemPresentation';
import { type ConnectionClusterModel } from '../models/ConnectionClusterModel';
import { buildQuickStartInstanceTreeId, buildQuickStartTreeId } from './quickStartTreeIdentity';

/** Base context token for the managed-instance row; menus gate on this + a state token. */
const INSTANCE_CONTEXT = 'treeItem_quickStartInstance';

function createQuickStartAction(
    parentId: string,
    idSuffix: string,
    label: string,
    iconId: string,
    commandId: string,
): TreeElement {
    return createGenericElementWithContext({
        id: `${parentId}/${idSuffix}`,
        contextValue: 'treeItem_quickStartAction',
        label,
        iconPath: new vscode.ThemeIcon(iconId),
        commandId,
    });
}

function createQuickStartRetryAction(parentId: string, retryTarget: unknown): TreeElement {
    return createGenericElementWithContext({
        id: `${parentId}/retry`,
        contextValue: 'error',
        label: l10n.t('Retry setup'),
        iconPath: new vscode.ThemeIcon('refresh'),
        commandId: 'vscode-documentdb.command.localQuickStart.open',
        commandArgs: [retryTarget],
    });
}

/**
 * What the tree shows instead of databases when the container preflight says the instance cannot be
 * opened. Rendered as rows rather than a dialog: expanding a node is a browse gesture, and a modal
 * would block the expansion until it is answered and then leave the node empty anyway.
 */
function buildPreflightChildren(parentId: string, verdict: QuickStartConnectionPreflightResult): TreeElement[] {
    const open = 'vscode-documentdb.command.localQuickStart.open';
    const viewLogs = 'vscode-documentdb.command.localQuickStart.viewLogs';

    switch (verdict) {
        case 'stopped':
            return [
                createQuickStartAction(
                    parentId,
                    'preflight/start',
                    l10n.t('Start container'),
                    'play',
                    'vscode-documentdb.command.localQuickStart.start',
                ),
            ];
        case 'missing':
            return [
                createQuickStartAction(parentId, 'preflight/recreate', l10n.t('Recreate container'), 'refresh', open),
            ];
        case 'dockerUnreachable':
            return [
                createQuickStartAction(
                    parentId,
                    'preflight/reviewDocker',
                    l10n.t('Review Docker setup'),
                    'tools',
                    open,
                ),
                createQuickStartAction(parentId, 'preflight/viewLogs', l10n.t('View setup log'), 'output', viewLogs),
            ];
        case 'busy':
            // Progress belongs on the node itself (see quickStartProgressBridge), not on a child row.
            return [];
        default:
            return [
                createQuickStartAction(parentId, 'preflight/reviewSetup', l10n.t('Review setup'), 'tools', open),
                createQuickStartAction(parentId, 'preflight/viewLogs', l10n.t('View setup log'), 'output', viewLogs),
            ];
    }
}

function escapeMarkdown(value: string): string {
    // Only the characters that would actually change how the tooltip renders; the tooltip is not
    // trusted, so HTML is inert.
    return value.replace(/[\\`*_~[\]<>]/g, '\\$&');
}

function instanceStateLabel(state: InstanceState): string {
    switch (state) {
        case InstanceState.NotInstalled:
            return l10n.t('Not set up');
        case InstanceState.Provisioning:
            return l10n.t('Provisioning');
        case InstanceState.Starting:
            return l10n.t('Starting');
        case InstanceState.Running:
            return l10n.t('Running');
        case InstanceState.Stopping:
            return l10n.t('Stopping');
        case InstanceState.Stopped:
            return l10n.t('Stopped');
        case InstanceState.CredentialsMissing:
            return l10n.t('Credentials missing');
        default:
            return l10n.t('Error');
    }
}

function dockerEndpointLabel(readiness: DockerReadiness): string {
    switch (readiness.endpointKind) {
        case 'unixSocket':
            return l10n.t('Unix socket');
        case 'namedPipe':
            return l10n.t('Named pipe');
        case 'tcp':
            return 'TCP';
        case 'ssh':
            return 'SSH';
        default:
            return l10n.t('Unknown');
    }
}

function containerOsLabel(osType: 'linux' | 'windows'): string {
    return osType === 'windows' ? l10n.t('Windows') : l10n.t('Linux');
}

function shortenContainerId(containerId: string): string {
    return /^[0-9a-f]{12,64}$/i.test(containerId) ? containerId.slice(0, 12) : containerId;
}

function dockerProviderLabel(readiness: DockerReadiness): string {
    switch (readiness.provider) {
        case 'dockerDesktop':
            return l10n.t('Docker Desktop');
        case 'dockerEngine':
            return l10n.t('Docker Engine');
        default:
            return l10n.t('Unknown');
    }
}

// Strings shared with the Quick Start webview are spelled identically on purpose, so each reaches
// translators once. Bare acronyms (WSL, SSH, TCP) are left alone — there is nothing to translate.
function executionTargetLabel(readiness: DockerReadiness): string {
    switch (readiness.executionTarget) {
        case 'wsl':
            return 'WSL';
        case 'ssh':
            return 'SSH';
        case 'devContainer':
            return l10n.t('Dev container');
        case 'codespaces':
            return l10n.t('GitHub Codespaces');
        case 'otherRemote':
            return l10n.t('Remote');
        default:
            return l10n.t('Local');
    }
}

/** Hover copy for the not-set-up root: the value proposition plus the one prerequisite. */
function buildEmptyStateTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(`### ${l10n.t('Your own DocumentDB')}\n\n`);
    tooltip.isTrusted = false;
    tooltip.appendMarkdown(`${l10n.t('A local DocumentDB instance, set up for you. No configuration required.')}\n\n`);
    tooltip.appendMarkdown(`- ${l10n.t('Ready in a couple of clicks')}\n`);
    tooltip.appendMarkdown(`- ${l10n.t('Runs in Docker')}\n`);
    tooltip.appendMarkdown(`- ${l10n.t('Safe to reset or delete at any time')}\n`);
    return tooltip;
}

function buildInstanceTooltip(status: QuickStartStatus, baseTooltip?: vscode.MarkdownString): vscode.MarkdownString {
    const metadata = status.metadata;
    const readiness = QuickStartService.getDockerReadinessSnapshot();
    const tooltip = new vscode.MarkdownString(baseTooltip?.value ?? `### ${l10n.t('DocumentDB Local')}\n\n`);
    tooltip.isTrusted = false;

    if (!baseTooltip) {
        tooltip.appendMarkdown(`**${l10n.t('State')}:** ${instanceStateLabel(status.state)}\n\n`);
        if (metadata) {
            tooltip.appendMarkdown(`**${l10n.t('Host')}:** localhost:${String(metadata.boundPort)}\n\n`);
        }
    }

    if (metadata) {
        tooltip.appendMarkdown('---\n\n');
        tooltip.appendMarkdown(
            `**${l10n.t('Container image')}:** ${escapeMarkdown(metadata.imageRef ?? l10n.t('Unknown'))}\n\n`,
        );
        tooltip.appendMarkdown(
            `**${l10n.t('Container ID')}:** ${escapeMarkdown(shortenContainerId(metadata.containerId))}\n\n`,
        );
    }

    if (readiness) {
        tooltip.appendMarkdown('---\n\n');
        tooltip.appendMarkdown(`**${l10n.t('Docker provider')}:** ${dockerProviderLabel(readiness)}\n\n`);
        if (readiness.cliVersion) {
            tooltip.appendMarkdown(`**${l10n.t('Docker version')}:** ${escapeMarkdown(readiness.cliVersion)}\n\n`);
        }
        if (readiness.daemonArchitecture) {
            tooltip.appendMarkdown(
                `**${l10n.t('Daemon architecture')}:** ${escapeMarkdown(readiness.daemonArchitecture)}\n\n`,
            );
        }
        if (readiness.osType) {
            tooltip.appendMarkdown(`**${l10n.t('Container OS')}:** ${containerOsLabel(readiness.osType)}\n\n`);
        }
        tooltip.appendMarkdown(`**${l10n.t('Execution target')}:** ${executionTargetLabel(readiness)}\n\n`);
        tooltip.appendMarkdown(`**${l10n.t('Docker endpoint')}:** ${dockerEndpointLabel(readiness)}\n\n`);
    }

    return tooltip;
}

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
     * state label (e.g. "Running").
     */
    public override getTreeItem(): vscode.TreeItem {
        const treeItem = buildClusterTreeItem({ id: this.id, contextValue: this.contextValue, cluster: this.cluster });
        return {
            ...treeItem,
            description: this.descriptionOverride,
            tooltip: buildInstanceTooltip(
                QuickStartService.getStatus(this.alias),
                treeItem.tooltip instanceof vscode.MarkdownString ? treeItem.tooltip : undefined,
            ),
        };
    }

    public override async getChildren(): Promise<TreeElement[]> {
        const preflight: QuickStartConnectionPreflightResult = await QuickStartService.prepareForConnection(this.alias);
        if (preflight !== 'ready') {
            return buildPreflightChildren(this.id, preflight);
        }
        return super.getChildren();
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
 * Root node "Your own DocumentDB" (WI-6). Renders unconditionally
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
        this.id = buildQuickStartTreeId(parentId);
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
            createQuickStartRetryAction(this.id, this),
            createQuickStartAction(
                this.id,
                'viewLogs',
                l10n.t('View setup log'),
                'output',
                'vscode-documentdb.command.localQuickStart.viewLogs',
            ),
        ];

        if (includeDelete) {
            children.push(
                createGenericElementWithContext({
                    id: `${this.id}/delete`,
                    contextValue: 'error',
                    label: l10n.t('Delete container'),
                    iconPath: new vscode.ThemeIcon('trash'),
                    commandId: 'vscode-documentdb.command.localQuickStart.delete',
                }),
            );
        }

        return children;
    }

    async getChildren(): Promise<TreeElement[]> {
        const wasHydrated = QuickStartService.isHydrated;
        try {
            await QuickStartService.ensureHydrated();
        } catch {
            // Docker may not be installed or running yet, which is precisely the case Quick Start
            // exists to fix. Render the durable-state row anyway; the service stays un-hydrated, so
            // the next expansion retries.
        }

        // Never block the row on Docker (review M6): the Connections view re-runs getChildren() on
        // many unrelated events, so the freshness probe is kicked off in the background (rate-limited
        // and de-duplicated by the service) and the row is redrawn by onDidChangeStatus when it lands.
        if (wasHydrated) {
            QuickStartService.refreshLiveStateInBackground();
        }

        const status: QuickStartStatus = QuickStartService.getStatus();
        const metadata = status.metadata;

        // Missing badge (design §6.1): metadata exists but Docker has no container.
        if (metadata && status.missing) {
            return [
                createQuickStartAction(
                    this.id,
                    'recreate',
                    l10n.t('Recreate container'),
                    'refresh',
                    'vscode-documentdb.command.localQuickStart.open',
                ),
                createQuickStartAction(
                    this.id,
                    'delete',
                    l10n.t('Delete container'),
                    'trash',
                    'vscode-documentdb.command.localQuickStart.delete',
                ),
            ];
        }

        if (metadata && status.state === InstanceState.Running) {
            // M7: the tree model's connection string is display-only (hosts, TLS badge). Credentials are
            // resolved from QuickStartService at connect time, so the generated userinfo is stripped here.
            const displayConnectionString = new DocumentDBConnectionString(metadata.connectionString);
            displayConnectionString.username = '';
            displayConnectionString.password = '';

            const model: TreeCluster<ConnectionClusterModel> = {
                treeId: buildQuickStartInstanceTreeId(this.parentId),
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
                new QuickStartClusterItem(model, instanceStateLabel(status.state), 'state_running', metadata.alias),
            ];
        }

        // Non-running managed states render as a non-browsable row carrying the
        // lifecycle menus (a stopped container can't be connected to / browsed).
        if (metadata) {
            const row = (stateToken: string, description: string, icon: vscode.ThemeIcon): TreeElement => {
                const id = `${this.id}/instance`;
                const contextValue = createContextValue([INSTANCE_CONTEXT, stateToken]);
                return {
                    id,
                    getTreeItem: (): vscode.TreeItem => ({
                        id,
                        contextValue,
                        label: l10n.t('DocumentDB Local'),
                        description,
                        tooltip: buildInstanceTooltip(status),
                        iconPath: icon,
                    }),
                };
            };

            // Transitional states keep their own contextValue (menus gate on it), but neither the
            // spinner nor the text: quickStartProgressBridge overlays both. The wording is kept
            // identical to the overlay so a registration change can't surface a different string.
            const idle = new vscode.ThemeIcon('circle-outline');
            switch (status.state) {
                case InstanceState.Starting:
                    return [row('state_starting', l10n.t('Starting…'), idle)];
                case InstanceState.Stopping:
                    return [row('state_stopping', l10n.t('Stopping…'), idle)];
                case InstanceState.Stopped:
                    return [row('state_stopped', instanceStateLabel(status.state), idle)];
                case InstanceState.Error:
                    return this.createErrorRecoveryChildren(true);
                default:
                    break;
            }
        }

        // Credential-unavailable: keep the tree calm and route the user to Quick Start, where the
        // situation and destructive recovery are explained in context. Deletion is deliberately not
        // exposed from this row; the Configure step owns that decision.
        if (status.state === InstanceState.CredentialsMissing) {
            return [
                createQuickStartAction(
                    this.id,
                    'reviewSetup',
                    l10n.t('Review setup'),
                    'tools',
                    'vscode-documentdb.command.localQuickStart.open',
                ),
            ];
        }

        if (status.state === InstanceState.Provisioning) {
            // The one row that still owns its spinner: there is no instance row to attach node
            // progress to yet, and this mirrors what `ext.state.showCreatingChild` renders.
            return [
                createGenericElementWithContext({
                    id: `${this.id}/provisioning`,
                    contextValue: 'treeItem_quickStartProvisioning',
                    label: l10n.t('Provisioning…'),
                    iconPath: new vscode.ThemeIcon('loading~spin'),
                }),
            ];
        }

        // A wizard failure that never got as far as creating anything (no metadata) is still
        // reported as recovery actions. There is no container yet, so Delete is not offered.
        if (status.state === InstanceState.Error) {
            return this.createErrorRecoveryChildren(false);
        }

        // NotInstalled (no metadata) → empty-state row that opens the Quick Start wizard.
        return [
            createQuickStartAction(
                this.id,
                'start',
                l10n.t('Set up DocumentDB Local'),
                'rocket',
                'vscode-documentdb.command.localQuickStart.open',
            ),
        ];
    }

    /** Explicit node refresh performs a full durable-store and Docker reconciliation. */
    public async refresh(_context: IActionContext): Promise<void> {
        // Reconciliation shells out to Docker, so the node carries the wait.
        await ext.state.runWithTemporaryDescription(this.id, l10n.t('Refreshing…'), () =>
            QuickStartService.refreshHydratedState(),
        );
        ext.connectionsBranchDataProvider.refresh(this);
    }

    private iconPath: IconPath = {
        light: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-light-themes.svg')),
        dark: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-dark-themes.svg')),
    };

    public getTreeItem(): vscode.TreeItem {
        // Synchronous in-memory read; onDidChangeStatus refreshes the view, so this re-renders on change.
        const status = QuickStartService.getStatus();
        // The pitch is only true until there is something to browse, so it retires with the empty state.
        // Before hydration nothing is known yet, so the persisted hint stands in and keeps the copy from
        // appearing for users who already have an instance, only to vanish on first expansion.
        const isEmptyState = QuickStartService.isHydrated
            ? !status.metadata && status.state === InstanceState.NotInstalled
            : !QuickStartService.isLikelyInstalled;

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Your own DocumentDB'),
            description: isEmptyState ? l10n.t('zero-config local instance') : undefined,
            tooltip: isEmptyState ? buildEmptyStateTooltip() : undefined,
            iconPath: this.iconPath,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
