/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AtlasApiClient } from '../api/AtlasApiClient';
import { promptAtlasAuthMethod } from '../auth/AtlasAuthQuickPick';
import { type AtlasSession } from '../auth/AtlasSession';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { executeAtlasAuthFlow } from '../auth/executeAtlasAuthFlow';
import { type AtlasCluster, type AtlasClusterState, type AtlasProject } from '../models/AtlasProjectModel';

interface AtlasProjectQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'project' | 'noProjects';
    readonly project?: AtlasProject;
}

interface AtlasClusterQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'cluster' | 'unavailableCluster' | 'noClusters';
    readonly cluster?: AtlasCluster;
}

/**
 * Wizard step that prompts the user to select an Atlas project.
 */
export class SelectAtlasProjectStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    constructor(private readonly sessionManager?: AtlasSessionManager) {
        super();
    }

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const session = context.properties['atlas.session'] as AtlasSession | undefined;
        const items = await this.getProjectItems(session);

        const selected = await context.ui.showQuickPick<AtlasProjectQuickPickItem>(items, {
            placeHolder: vscode.l10n.t('Select an Atlas project'),
            loadingPlaceHolder: vscode.l10n.t('Loading Atlas projects...'),
            suppressPersistence: true,
            matchOnDescription: true,
        });

        if (selected.itemType === 'manageCredentials') {
            await this.manageCredentialsFromWizard(context);
            throw new UserCancelledError(vscode.l10n.t('Credential management completed'));
        }

        if (selected.itemType === 'noProjects') {
            await vscode.window.showInformationMessage(
                vscode.l10n.t('No projects available'),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'No MongoDB Atlas projects are currently available for this session. Manage credentials to try a different API key or Service Account.',
                    ),
                },
                vscode.l10n.t('OK'),
            );

            throw new UserCancelledError(vscode.l10n.t('No Atlas projects available'));
        }

        if (!selected.project) {
            throw new UserCancelledError(vscode.l10n.t('No Atlas project selected'));
        }

        context.properties['atlas.selectedProject'] = selected.project;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.properties['atlas.selectedProject'];
    }

    private async getProjectItems(session: AtlasSession | undefined): Promise<AtlasProjectQuickPickItem[]> {
        const manageItem: AtlasProjectQuickPickItem = {
            itemType: 'manageCredentials',
            label: vscode.l10n.t('Manage MongoDB Atlas Credentials...'),
            detail: vscode.l10n.t(
                'Sign in with a different API key or Service Account to see more projects and clusters.',
            ),
            iconPath: new vscode.ThemeIcon('key'),
            alwaysShow: true,
        };

        if (!session) {
            return [manageItem];
        }

        const client = new AtlasApiClient(session, this.sessionManager);
        const projects = await client.listProjects();

        const projectItems: AtlasProjectQuickPickItem[] = projects.map((p) => ({
            itemType: 'project',
            label: p.name,
            description: vscode.l10n.t('{0} clusters', String(p.clusterCount)),
            project: p,
        }));

        if (projectItems.length === 0) {
            projectItems.push({
                itemType: 'noProjects',
                label: vscode.l10n.t('No projects available for these credentials'),
                detail: vscode.l10n.t('Select Manage MongoDB Atlas Credentials... to try different credentials.'),
                iconPath: new vscode.ThemeIcon('info'),
                alwaysShow: true,
            });
        }

        return [
            manageItem,
            { label: '', kind: vscode.QuickPickItemKind.Separator, itemType: 'noProjects' },
            ...projectItems,
        ];
    }

    private async manageCredentialsFromWizard(context: NewConnectionWizardContext): Promise<void> {
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.nodeProvided = 'false';
        context.telemetry.properties.initiatedFrom = 'newConnectionWizard';

        if (!this.sessionManager) {
            throw new UserCancelledError(vscode.l10n.t('Credential management is not available'));
        }

        const authMethod = await promptAtlasAuthMethod();
        if (!authMethod) {
            throw new UserCancelledError();
        }

        const success = await executeAtlasAuthFlow(authMethod, this.sessionManager);
        context.telemetry.properties.authMethod = authMethod;
        context.telemetry.properties.authSuccess = success ? 'true' : 'false';

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
    }
}

/**
 * Wizard step that prompts the user to select an Atlas cluster within the selected project.
 */
export class SelectAtlasClusterStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    constructor(private readonly sessionManager?: AtlasSessionManager) {
        super();
    }

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const session = context.properties['atlas.session'] as AtlasSession | undefined;
        const project = context.properties['atlas.selectedProject'] as AtlasProject | undefined;
        if (!project) {
            throw new UserCancelledError(vscode.l10n.t('Atlas project not selected'));
        }

        const items = await this.getClusterItems(session, project);

        while (true) {
            const selected = await context.ui.showQuickPick<AtlasClusterQuickPickItem>(items, {
                placeHolder: vscode.l10n.t('Select a cluster'),
                loadingPlaceHolder: vscode.l10n.t('Loading Atlas clusters...'),
                suppressPersistence: true,
                matchOnDescription: true,
            });

            if (selected.itemType === 'manageCredentials') {
                await this.manageCredentialsFromWizard(context);
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
                selected.cluster.connectionStrings.standardSrv ?? selected.cluster.connectionStrings.standard;
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

    private async getClusterItems(
        session: AtlasSession | undefined,
        project: AtlasProject,
    ): Promise<AtlasClusterQuickPickItem[]> {
        const manageItem: AtlasClusterQuickPickItem = {
            itemType: 'manageCredentials',
            label: vscode.l10n.t('Manage MongoDB Atlas Credentials...'),
            detail: vscode.l10n.t(
                'Sign in with a different API key or Service Account to see more projects and clusters.',
            ),
            iconPath: new vscode.ThemeIcon('key'),
            alwaysShow: true,
        };

        if (!session) {
            return [manageItem];
        }

        const client = new AtlasApiClient(session, this.sessionManager);
        const clusters = await client.listClusters(project.id);

        const clusterItems: AtlasClusterQuickPickItem[] = clusters
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
                const stateLabel = getClusterStateLabel(c.stateName);
                return {
                    itemType: c.stateName === 'IDLE' ? ('cluster' as const) : ('unavailableCluster' as const),
                    label: c.name,
                    description: stateLabel ? `${providerDescription} · ${stateLabel}` : providerDescription,
                    detail:
                        c.stateName === 'IDLE'
                            ? (c.connectionStrings.standardSrv ?? c.connectionStrings.standard)
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
            { label: '', kind: vscode.QuickPickItemKind.Separator, itemType: 'noClusters' },
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
                detail: getClusterStateExplanation(cluster.stateName),
            },
            vscode.l10n.t('OK'),
        );
    }

    private async manageCredentialsFromWizard(context: NewConnectionWizardContext): Promise<void> {
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.nodeProvided = 'false';
        context.telemetry.properties.initiatedFrom = 'newConnectionWizard';

        if (!this.sessionManager) {
            throw new UserCancelledError(vscode.l10n.t('Credential management is not available'));
        }

        const authMethod = await promptAtlasAuthMethod();
        if (!authMethod) {
            throw new UserCancelledError();
        }

        const success = await executeAtlasAuthFlow(authMethod, this.sessionManager);
        context.telemetry.properties.authMethod = authMethod;
        context.telemetry.properties.authSuccess = success ? 'true' : 'false';

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
