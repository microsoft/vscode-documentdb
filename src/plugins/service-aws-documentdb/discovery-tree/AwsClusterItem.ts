/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    createContextValue,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { Views } from '../../../documentdb/Views';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { ProvidePasswordStep } from '../../../documentdb/wizards/authenticate/ProvidePasswordStep';
import { ProvideUserNameStep } from '../../../documentdb/wizards/authenticate/ProvideUsernameStep';
import { ConnectionDiagnosticsService } from '../../../services/connectionDiagnosticsService';
import { ClusterItemBase, type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { nonNullValue } from '../../../utils/nonNull';
import { AWS_DISCOVERY_PROVIDER_ID } from '../config';
import { buildAwsConnectionString, prepareAwsConnection, selectAwsCertificate } from '../connect/awsConnection';
import { isAwsClusterConnectable, type AwsClusterModel } from '../models/AwsClusterModel';

export class AwsClusterItem extends ClusterItemBase<AwsClusterModel> {
    constructor(
        cluster: TreeCluster<AwsClusterModel>,
        journeyId: string,
        private readonly flat = false,
    ) {
        super(cluster);
        this.journeyCorrelationId = journeyId;
        this.contextValue = createContextValue([
            this.contextValue,
            'awsDocumentDBCluster',
            'enableAddToConnectionsCommand',
        ]);
    }

    public getTreeItem(): vscode.TreeItem {
        const resource = this.cluster.resource;
        const tooltip = new vscode.MarkdownString();
        const vpcInfo = resource.vpcInfo;
        const lines = [
            vscode.l10n.t('Cluster: {0}', resource.name),
            vscode.l10n.t('Account: {0}', resource.accountId),
            vscode.l10n.t('Region: {0}', resource.region),
            vscode.l10n.t('State: {0}', resource.status),
            vscode.l10n.t('Endpoint: {0}', resource.endpoint ?? vscode.l10n.t('Not available')),
            vscode.l10n.t('Server version: {0}', resource.engineVersion ?? vscode.l10n.t('Not available')),
            vscode.l10n.t('VPC: {0}', vpcInfo?.vpcId ?? vscode.l10n.t('Not available')),
            vscode.l10n.t('DB subnet group: {0}', vpcInfo?.subnetGroupName ?? vscode.l10n.t('Not available')),
            vscode.l10n.t(
                'Subnets: {0}',
                vpcInfo?.subnets
                    .map((subnet) =>
                        subnet.availabilityZone ? `${subnet.id} (${subnet.availabilityZone})` : subnet.id,
                    )
                    .join(', ') || vscode.l10n.t('Not available'),
            ),
            vscode.l10n.t(
                'VPC security groups: {0}',
                vpcInfo?.securityGroups
                    .map((group) => (group.status ? `${group.id} (${group.status})` : group.id))
                    .join(', ') || vscode.l10n.t('Not available'),
            ),
            vscode.l10n.t(
                'Availability zones: {0}',
                vpcInfo?.availabilityZones.join(', ') || vscode.l10n.t('Not available'),
            ),
            ...(vpcInfo?.networkType ? [vscode.l10n.t('Network type: {0}', vpcInfo.networkType)] : []),
        ];
        if (resource.vpcInfoError) {
            lines.push(vscode.l10n.t('VPC details could not be loaded: {0}', resource.vpcInfoError));
            lines.push(vscode.l10n.t('Check that this AWS identity can call rds:DescribeDBSubnetGroups.'));
        }
        tooltip.appendText(lines.join('\n'));
        return {
            id: this.id,
            label: this.cluster.name,
            description: this.flat
                ? `${resource.accountId} · ${resource.region} · ${resource.status}`
                : resource.status,
            tooltip,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('server-environment'),
            collapsibleState: isAwsClusterConnectable(resource)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        };
    }

    public async getCredentials(): Promise<EphemeralClusterCredentials> {
        const connectionString = await prepareAwsConnection(this.cluster.resource);
        this.cluster.connectionString = connectionString;
        const cached = CredentialCache.getNativeAuthConfig(this.cluster.clusterId);
        return {
            connectionString,
            availableAuthMethods: [AuthMethodId.NativeAuth],
            selectedAuthMethod: cached ? AuthMethodId.NativeAuth : undefined,
            nativeAuthConfig: cached,
            connectionProperties: { awsDocumentDBArn: this.cluster.resource.arn },
        };
    }

    public async selectCertificate(): Promise<void> {
        const path = await selectAwsCertificate(this.cluster.resource, true);
        const connectionString = buildAwsConnectionString(this.cluster.resource, path);
        await ClustersClient.deleteClient(this.cluster.clusterId);
        const cached = CredentialCache.getNativeAuthConfig(this.cluster.clusterId);
        this.cluster.connectionString = connectionString;
        if (cached) {
            CredentialCache.setAuthCredentials(
                this.cluster.clusterId,
                AuthMethodId.NativeAuth,
                connectionString,
                cached,
            );
        }
    }

    protected async authenticateAndConnect(): Promise<ClustersClient | null> {
        const result = await callWithTelemetryAndErrorHandling(
            'awsDiscovery.connect',
            async (context: IActionContext) => {
                context.telemetry.properties.discoveryProviderId = AWS_DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId ?? '';
                if (this.cluster.resource.endpoint) {
                    context.valuesToMask.push(this.cluster.resource.endpoint);
                }
                const credentials = await this.getCredentials();
                const wizardContext: AuthenticateWizardContext = {
                    ...context,
                    adminUserName: this.cluster.resource.masterUsername,
                    resourceName: this.cluster.name,
                    availableAuthMethods: [AuthMethodId.NativeAuth],
                    selectedAuthMethod: AuthMethodId.NativeAuth,
                };
                const wizard = new AzureWizard(wizardContext, {
                    title: vscode.l10n.t('Authenticate to Connect with Your AWS Cluster'),
                    promptSteps: [new ProvideUserNameStep(), new ProvidePasswordStep()],
                });
                await wizard.prompt();
                CredentialCache.setAuthCredentials(
                    this.cluster.clusterId,
                    AuthMethodId.NativeAuth,
                    credentials.connectionString,
                    {
                        connectionUser: nonNullValue(
                            wizardContext.selectedUserName,
                            'selectedUserName',
                            'AwsClusterItem',
                        ),
                        connectionPassword: nonNullValue(wizardContext.password, 'password', 'AwsClusterItem'),
                    },
                );
                try {
                    return await this.getClientWithProgress(this.cluster.clusterId);
                } catch (error) {
                    if (!(error instanceof UserCancelledError)) {
                        const diagnosis = await ConnectionDiagnosticsService.explain({
                            clusterId: this.cluster.clusterId,
                            error,
                        });
                        void vscode.window.showErrorMessage(
                            diagnosis?.message ?? vscode.l10n.t('Failed to connect to the AWS DocumentDB cluster.'),
                            { modal: true, detail: error instanceof Error ? error.message : String(error) },
                        );
                        context.errorHandling.suppressDisplay = true;
                    }
                    await ClustersClient.deleteClient(this.cluster.clusterId);
                    CredentialCache.deleteCredentials(this.cluster.clusterId);
                    throw error;
                }
            },
        );
        return result ?? null;
    }
}
