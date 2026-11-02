/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { AWS_ADD_CREDENTIAL_COMMAND, AWS_DISCOVERY_PROVIDER_ID, AWS_VIEW_MODE_KEY } from '../config';
import { type AwsDiscoveryService } from '../discovery/AwsDiscoveryService';
import { createAwsClusterModel } from '../models/AwsClusterModel';
import { type AwsCluster } from '../types';
import { AwsClusterItem } from './AwsClusterItem';

export function awsListMode(): boolean {
    return ext.context.globalState.get<string>(AWS_VIEW_MODE_KEY, 'tree') === 'list';
}

class AwsResourceGroupItem implements TreeElement, TreeElementWithContextValue {
    public contextValue = 'awsResourceGroup';
    constructor(
        public readonly id: string,
        private readonly label: string,
        private readonly resources: AwsCluster[],
        private readonly journeyId: string,
        private readonly level: 'account' | 'region',
    ) {}

    public getTreeItem(): vscode.TreeItem {
        return { id: this.id, label: this.label, contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon(this.level === 'account' ? 'organization' : 'globe'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed };
    }

    public getChildren(): TreeElement[] {
        if (this.level === 'region') {
            return this.resources.map((resource) => new AwsClusterItem(createAwsClusterModel(resource, this.id), this.journeyId));
        }
        return [...new Set(this.resources.map((resource) => resource.region))].sort().map((region) =>
            new AwsResourceGroupItem(`${this.id}/${region}`, region,
                this.resources.filter((resource) => resource.region === region), this.journeyId, 'region'));
    }
}

export class AwsServiceRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue = 'enableRefreshCommand;enableManageCredentialsCommand;enableLearnMoreCommand;discoveryAwsServiceRootItem';
    private readonly journeyId = randomUUID();

    constructor(private readonly service: Pick<AwsDiscoveryService, 'listCredentials' | 'listAll' | 'invalidate'>, parentId: string) {
        this.id = `${parentId}/${AWS_DISCOVERY_PROVIDER_ID}`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id, label: vscode.l10n.t('AWS DocumentDB'),
            contextValue: createContextValue([this.contextValue, awsListMode() ? 'discoveryAwsViewModeList' : 'discoveryAwsViewModeTree']),
            iconPath: new vscode.ThemeIcon('cloud'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public async getChildren(): Promise<TreeElement[]> {
        const credentials = await this.service.listCredentials();
        if (!credentials.length) {
            return [createGenericElementWithContext({
                id: `${this.id}/sign-in`, contextValue: 'error',
                label: vscode.l10n.t('Sign in to view AWS DocumentDB clusters'),
                iconPath: new vscode.ThemeIcon('sign-in'),
                commandId: AWS_ADD_CREDENTIAL_COMMAND, commandArgs: [this],
            })];
        }
        const snapshot = await this.service.listAll();
        const children: TreeElement[] = [];
        if (snapshot.errors.length) {
            const needsCredentials = snapshot.errors.some((error) => error.kind === 'auth' || error.kind === 'permission');
            children.push(createGenericElementWithContext({
                id: `${this.id}/recovery`, contextValue: 'error',
                label: needsCredentials ? vscode.l10n.t('Click here to revisit credentials') : vscode.l10n.t('Click here to retry'),
                description: vscode.l10n.t('{0} discovery failures', snapshot.errors.length),
                tooltip: snapshot.errors.map((error) =>
                    `${credentials.find((entry) => entry.id === error.credentialId)?.label ?? error.credentialId} ${error.region ?? ''}: ${error.message}`).join('\n'),
                iconPath: new vscode.ThemeIcon('warning'),
                commandId: needsCredentials
                    ? 'vscode-documentdb.command.discoveryView.manageCredentials'
                    : 'vscode-documentdb.command.refresh',
                commandArgs: [this],
            }));
        }
        if (awsListMode()) {
            children.push(...snapshot.clusters.map((resource) =>
                new AwsClusterItem(createAwsClusterModel(resource, this.id), this.journeyId, true)));
        } else {
            const accounts = [...new Set(snapshot.clusters.map((resource) => resource.accountId))].sort();
            children.push(...accounts.map((account) => new AwsResourceGroupItem(
                `${this.id}/${account}`, account,
                snapshot.clusters.filter((resource) => resource.accountId === account), this.journeyId, 'account')));
        }
        if (!children.length) {
            children.push(createGenericElementWithContext({
                id: `${this.id}/empty`, contextValue: 'empty',
                label: vscode.l10n.t('empty'),
                tooltip: vscode.l10n.t('No clusters found in the selected regions'),
                iconPath: new vscode.ThemeIcon('indent'),
            }));
        }
        return children;
    }

    public async refresh(_context: IActionContext): Promise<void> {
        this.service.invalidate();
        ext.discoveryBranchDataProvider.resetNodeErrorState(this.id);
        ext.discoveryBranchDataProvider.refresh(this);
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return children?.some((child) => child.id === `${this.id}/recovery`) ?? false;
    }
}
