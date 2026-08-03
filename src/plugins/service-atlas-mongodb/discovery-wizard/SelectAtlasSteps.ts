/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AtlasApiClient } from '../api/AtlasApiClient';
import { configureAtlasCredentials } from '../credentialsManagement/configureAtlasCredentials';
import { snapshotHasFailures, type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { type AtlasCluster, type AtlasClusterState, type AtlasProject } from '../models/AtlasProjectModel';

interface AtlasProjectQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'project' | 'noProjects' | 'separator';
    readonly project?: AtlasProject;
    /** The healthy credential that owns this project in the merged snapshot. */
    readonly credentialId?: string;
}

interface AtlasClusterQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'cluster' | 'unavailableCluster' | 'noClusters' | 'separator';
    readonly cluster?: AtlasCluster;
}

/**
 * Builds the shared "manage credentials" row. It doubles as the recovery affordance: when the
 * snapshot carries failures, the same row explains that some credentials need attention, so a
 * partial failure never dead-ends the wizard.
 */
function createManageCredentialsItem(hasFailures: boolean): {
    label: string;
    detail: string;
    iconPath: vscode.ThemeIcon;
    alwaysShow: true;
} {
    return {
        label: hasFailures
            ? vscode.l10n.t('Click here to revisit credentials')
            : vscode.l10n.t('Manage MongoDB Atlas Credentials…'),
        detail: hasFailures
            ? vscode.l10n.t('Some credentials need attention, so parts of your fleet may be missing from this list.')
            : vscode.l10n.t('Add or update credentials to see more projects and clusters.'),
        iconPath: new vscode.ThemeIcon(hasFailures ? 'warning' : 'key'),
        alwaysShow: true,
    };
}

/**
 * Runs the credential-management flow from inside the wizard.
 *
 * Returns `true` only when credential storage actually changed. Cancelling must never be
 * reported as "credential management completed".
 */
async function manageCredentialsFromWizard(
    context: NewConnectionWizardContext,
    discoveryService: AtlasDiscoveryService,
): Promise<boolean> {
    context.telemetry.properties.credentialConfigActivated = 'true';
    context.telemetry.properties.initiatedFrom = 'newConnectionWizard';

    const changed = await configureAtlasCredentials(context, discoveryService);
    context.telemetry.properties.credentialsChanged = changed ? 'true' : 'false';
    return changed;
}

/**
 * Wizard step that prompts the user to select an Atlas project.
 *
 * Consumes the same merged snapshot as the tree, so a project visible through two credentials
 * appears once and carries the healthy credential that owns it.
 */
export class SelectAtlasProjectStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    constructor(private readonly discoveryService: AtlasDiscoveryService) {
        super();
    }

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const selected = await context.ui.showQuickPick<AtlasProjectQuickPickItem>(this.getProjectItems(), {
            placeHolder: vscode.l10n.t('Select an Atlas project'),
            loadingPlaceHolder: vscode.l10n.t('Loading Atlas projects…'),
            suppressPersistence: true,
            matchOnDescription: true,
        });

        if (selected.itemType === 'manageCredentials') {
            const changed = await manageCredentialsFromWizard(context, this.discoveryService);
            if (!changed) {
                throw new UserCancelledError();
            }

            await vscode.window.showInformationMessage(
                vscode.l10n.t('Credential management completed'),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'Please retry discovery to refresh the available MongoDB Atlas projects and clusters.',
                    ),
                },
                vscode.l10n.t('OK'),
            );
            throw new UserCancelledError(vscode.l10n.t('Credential management completed'));
        }

        if (selected.itemType === 'noProjects') {
            await vscode.window.showInformationMessage(
                vscode.l10n.t('No projects available'),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'No MongoDB Atlas projects are currently visible to your stored credentials. Manage credentials to add or update a credential.',
                    ),
                },
                vscode.l10n.t('OK'),
            );

            throw new UserCancelledError(vscode.l10n.t('No Atlas projects available'));
        }

        if (!selected.project || !selected.credentialId) {
            throw new UserCancelledError(vscode.l10n.t('No Atlas project selected'));
        }

        context.properties['atlas.selectedProject'] = selected.project;
        context.properties['atlas.selectedProjectCredentialId'] = selected.credentialId;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.properties['atlas.selectedProject'];
    }

    private async getProjectItems(): Promise<AtlasProjectQuickPickItem[]> {
        const snapshot = await this.discoveryService.listAll();
        const orgNames = new Map(
            snapshot.organizations.map((entry) => [entry.organization.id, entry.organization.name]),
        );

        const manageItem: AtlasProjectQuickPickItem = {
            itemType: 'manageCredentials',
            ...createManageCredentialsItem(snapshotHasFailures(snapshot)),
        };

        const projectItems: AtlasProjectQuickPickItem[] = snapshot.projects.map((entry) => {
            const orgName = orgNames.get(entry.project.orgId);
            return {
                itemType: 'project',
                label: entry.project.name,
                description: orgName ?? '',
                detail: vscode.l10n.t('{0} clusters', String(entry.project.clusterCount)),
                project: entry.project,
                credentialId: entry.ownerCredentialId,
            };
        });

        if (projectItems.length === 0) {
            projectItems.push({
                itemType: 'noProjects',
                label: vscode.l10n.t('No projects available for these credentials'),
                detail: vscode.l10n.t('Manage credentials to add or update a credential.'),
                iconPath: new vscode.ThemeIcon('info'),
                alwaysShow: true,
            });
        }

        return [
            manageItem,
            { label: '', kind: vscode.QuickPickItemKind.Separator, itemType: 'separator' },
            ...projectItems,
        ];
    }
}

/**
 * Wizard step that prompts the user to select an Atlas cluster within the selected project.
 */
export class SelectAtlasClusterStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    constructor(private readonly discoveryService: AtlasDiscoveryService) {
        super();
    }

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const project = context.properties['atlas.selectedProject'] as AtlasProject | undefined;
        const credentialId = context.properties['atlas.selectedProjectCredentialId'] as string | undefined;
        if (!project || !credentialId) {
            throw new UserCancelledError(vscode.l10n.t('Atlas project not selected'));
        }

        const items = await this.getClusterItems(project, credentialId);

        while (true) {
            const selected = await context.ui.showQuickPick<AtlasClusterQuickPickItem>(items, {
                placeHolder: vscode.l10n.t('Select a cluster'),
                loadingPlaceHolder: vscode.l10n.t('Loading Atlas clusters…'),
                suppressPersistence: true,
                matchOnDescription: true,
            });

            if (selected.itemType === 'manageCredentials') {
                const changed = await manageCredentialsFromWizard(context, this.discoveryService);
                if (!changed) {
                    throw new UserCancelledError();
                }
                throw new UserCancelledError(vscode.l10n.t('Credential management completed'));
            }

            if (selected.itemType === 'noClusters') {
                await vscode.window.showInformationMessage(
                    vscode.l10n.t('No clusters available'),
                    {
                        modal: true,
                        detail: vscode.l10n.t(
                            'This MongoDB Atlas project does not currently contain any clusters to connect to.',
                        ),
                    },
                    vscode.l10n.t('OK'),
                );

                throw new UserCancelledError(vscode.l10n.t('No Atlas clusters available'));
            }

            if (selected.itemType === 'unavailableCluster') {
                await this.showClusterUnavailableMessage(selected.cluster);
                continue;
            }

            if (!selected.cluster) {
                throw new UserCancelledError(vscode.l10n.t('No Atlas cluster selected'));
            }

            const connectionString =
                selected.cluster.connectionStrings?.standardSrv ?? selected.cluster.connectionStrings?.standard;
            if (!connectionString) {
                throw new UserCancelledError(vscode.l10n.t('No Atlas cluster connection string available.'));
            }

            context.properties['atlas.selectedClusterConnectionString'] = connectionString;
            return;
        }
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.properties['atlas.selectedClusterConnectionString'];
    }

    private async getClusterItems(project: AtlasProject, credentialId: string): Promise<AtlasClusterQuickPickItem[]> {
        const registry = this.discoveryService.sessionRegistry;
        // A transient token failure now throws rather than resolving `undefined`; either way the
        // wizard's fallback is the same neutral "manage credentials" affordance, so treat any
        // failure as "no usable session" here instead of surfacing it inside the QuickPick.
        const session = await registry.getSession(credentialId).catch(() => undefined);

        const manageItem: AtlasClusterQuickPickItem = {
            itemType: 'manageCredentials',
            ...createManageCredentialsItem(session === undefined),
        };

        if (!session) {
            return [manageItem];
        }

        const client = new AtlasApiClient(session, registry.refresherFor(credentialId));
        // Deduplicate by cluster name: the same cluster can be reachable through more than one
        // credential, and Atlas cluster names are unique within a project.
        const byName = new Map<string, AtlasCluster>();
        for (const cluster of await client.listClusters(project.id)) {
            if (!byName.has(cluster.name)) {
                byName.set(cluster.name, cluster);
            }
        }

        const clusterItems: AtlasClusterQuickPickItem[] = [...byName.values()]
            .map((c) => {
                const provider =
                    c.providerSettings ??
                    (() => {
                        const rc = c.replicationSpecs?.[0]?.regionConfigs?.[0];
                        return rc
                            ? {
                                  instanceSizeName: rc.electableSpecs?.instanceSize ?? '',
                                  providerName: rc.providerName ?? '',
                              }
                            : undefined;
                    })();
                const providerDescription = provider
                    ? `${provider.instanceSizeName}, ${provider.providerName}`
                    : c.clusterType;
                const paused = c.paused === true;
                const isConnectable = !paused && c.stateName === 'IDLE';
                const stateLabel = paused ? vscode.l10n.t('Paused') : getClusterStateLabel(c.stateName);
                return {
                    itemType: isConnectable ? ('cluster' as const) : ('unavailableCluster' as const),
                    label: c.name,
                    description: stateLabel ? `${providerDescription} · ${stateLabel}` : providerDescription,
                    detail: isConnectable
                        ? (c.connectionStrings?.standardSrv ?? c.connectionStrings?.standard)
                        : paused
                          ? vscode.l10n.t('Resume this cluster in MongoDB Atlas before connecting.')
                          : vscode.l10n.t(
                                'Visible in the tree, but not connectable until the cluster returns to IDLE.',
                            ),
                    cluster: c,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

        if (clusterItems.length === 0) {
            clusterItems.push({
                itemType: 'noClusters',
                label: vscode.l10n.t('No clusters found in project "{0}"', project.name),
                detail: vscode.l10n.t('This project does not currently contain any MongoDB Atlas clusters.'),
                iconPath: new vscode.ThemeIcon('info'),
                alwaysShow: true,
            });
        }

        return [
            manageItem,
            { label: '', kind: vscode.QuickPickItemKind.Separator, itemType: 'separator' },
            ...clusterItems,
        ];
    }

    private async showClusterUnavailableMessage(cluster: AtlasCluster | undefined): Promise<void> {
        if (!cluster) {
            throw new UserCancelledError(vscode.l10n.t('No Atlas cluster selected'));
        }

        await vscode.window.showInformationMessage(
            vscode.l10n.t('Cluster not connectable yet'),
            {
                modal: true,
                detail:
                    cluster.paused === true
                        ? vscode.l10n.t('This cluster is paused. Resume it in MongoDB Atlas before connecting.')
                        : getClusterStateExplanation(cluster.stateName),
            },
            vscode.l10n.t('OK'),
        );
    }
}

function getClusterStateLabel(state: AtlasClusterState): string | undefined {
    const labels: Record<AtlasClusterState, string | undefined> = {
        IDLE: undefined,
        CREATING: vscode.l10n.t('Creating…'),
        UPDATING: vscode.l10n.t('Updating…'),
        REPAIRING: vscode.l10n.t('Repairing…'),
        DELETING: vscode.l10n.t('Deleting…'),
        UNKNOWN: vscode.l10n.t('Unknown state'),
    };

    return labels[state];
}

function getClusterStateExplanation(state: AtlasClusterState): string {
    switch (state) {
        case 'CREATING':
            return vscode.l10n.t(
                'This cluster is being created. It will be connectable from the wizard once creation is complete and the cluster returns to IDLE.',
            );
        case 'UPDATING':
            return vscode.l10n.t(
                'This cluster is being updated. It is visible here to match the discovery tree, but it is not connectable until the update completes and the cluster returns to IDLE.',
            );
        case 'REPAIRING':
            return vscode.l10n.t(
                'This cluster is being repaired. It is visible here to match the discovery tree, but it is not connectable until repair completes and the cluster returns to IDLE.',
            );
        case 'DELETING':
            return vscode.l10n.t('This cluster is being deleted and cannot be connected to from the wizard.');
        case 'UNKNOWN':
            return vscode.l10n.t(
                'This cluster is in an unknown state. Try refreshing to update its status before connecting from the wizard.',
            );
        case 'IDLE':
        default:
            return vscode.l10n.t('This cluster is not connectable from the wizard right now.');
    }
}
