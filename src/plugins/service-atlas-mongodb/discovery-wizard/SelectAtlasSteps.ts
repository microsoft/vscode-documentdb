/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AtlasApiClient } from '../api/AtlasApiClient';
import { type AtlasSession } from '../auth/AtlasSession';
import { type AtlasCluster, type AtlasProject } from '../models/AtlasProjectModel';

/**
 * Wizard step that prompts the user to select an Atlas project.
 */
export class SelectAtlasProjectStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const session = context.properties['atlas.session'] as AtlasSession | undefined;
        if (!session) {
            throw new Error(vscode.l10n.t('Atlas session not available'));
        }

        const client = new AtlasApiClient(session);
        const projects = await client.listProjects();

        const items: (vscode.QuickPickItem & { project: AtlasProject })[] = projects.map((p) => ({
            label: p.name,
            description: vscode.l10n.t('{0} clusters', String(p.clusterCount)),
            project: p,
        }));

        const selected = await context.ui.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select an Atlas project'),
        });

        context.properties['atlas.selectedProject'] = selected.project;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.properties['atlas.selectedProject'];
    }
}

/**
 * Wizard step that prompts the user to select an Atlas cluster within the selected project.
 */
export class SelectAtlasClusterStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const session = context.properties['atlas.session'] as AtlasSession | undefined;
        if (!session) {
            throw new Error(vscode.l10n.t('Atlas session not available'));
        }

        const project = context.properties['atlas.selectedProject'] as AtlasProject | undefined;
        if (!project) {
            throw new Error(vscode.l10n.t('Atlas project not selected'));
        }

        const client = new AtlasApiClient(session);
        const clusters = await client.listClusters(project.id);

        const items: (vscode.QuickPickItem & { cluster: AtlasCluster })[] = clusters
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
                    label: c.name,
                    description: desc,
                    detail: c.connectionStrings.standardSrv ?? c.connectionStrings.standard,
                    cluster: c,
                };
            });

        if (items.length === 0) {
            throw new Error(vscode.l10n.t('No active clusters found in project "{0}"', project.name));
        }

        const selected = await context.ui.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select a cluster'),
        });

        const connectionString =
            selected.cluster.connectionStrings.standardSrv ?? selected.cluster.connectionStrings.standard;
        if (!connectionString) {
            throw new Error(vscode.l10n.t('No Atlas cluster connection string available.'));
        }

        context.properties['atlas.selectedClusterConnectionString'] = connectionString;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.properties['atlas.selectedClusterConnectionString'];
    }
}
