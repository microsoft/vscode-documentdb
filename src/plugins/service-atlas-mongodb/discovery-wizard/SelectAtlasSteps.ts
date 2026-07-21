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
import { type AtlasCluster, type AtlasProject } from '../models/AtlasProjectModel';

interface AtlasProjectQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'project' | 'noProjects';
    readonly project?: AtlasProject;
}

interface AtlasClusterQuickPickItem extends vscode.QuickPickItem {
    readonly itemType: 'manageCredentials' | 'cluster' | 'noConnectableClusters';
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

        if (selected.itemType === 'noConnectableClusters') {
            await vscode.window.showInformationMessage(
                vscode.l10n.t('No connectable clusters available'),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'Only IDLE clusters are currently connectable in this flow. Choose a different project or retry after cluster provisioning completes.',
                    ),
                },
                vscode.l10n.t('OK'),
            );

            throw new UserCancelledError(vscode.l10n.t('No connectable Atlas clusters available'));
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
            .filter((c) => c.stateName === 'IDLE') // Only show active clusters
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
                const desc = provider ? `${provider.instanceSizeName}, ${provider.providerName}` : c.clusterType;
                return {
                    itemType: 'cluster' as const,
                    label: c.name,
                    description: desc,
                    detail: c.connectionStrings.standardSrv ?? c.connectionStrings.standard,
                    cluster: c,
                };
            });

        if (clusterItems.length === 0) {
            clusterItems.push({
                itemType: 'noConnectableClusters',
                label: vscode.l10n.t('No connectable clusters found in project "{0}"', project.name),
                detail: vscode.l10n.t(
                    'Select Manage MongoDB Atlas Credentials... or retry after cluster provisioning completes.',
                ),
                iconPath: new vscode.ThemeIcon('info'),
                alwaysShow: true,
            });
        }

        return [
            manageItem,
            { label: '', kind: vscode.QuickPickItemKind.Separator, itemType: 'noConnectableClusters' },
            ...clusterItems,
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
