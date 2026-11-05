/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { nonNullValue } from '../../../utils/nonNull';
import { errorName } from '../auth/errors';
import { prepareAwsConnection } from '../connect/awsConnection';
import { configureAwsCredentials } from '../credentialsManagement/configureAwsCredentials';
import { awsDiscoveryService } from '../discovery/AwsDiscoveryService';
import { isAwsClusterConnectable } from '../models/AwsClusterModel';
import { type AwsCluster } from '../types';

interface AwsWizardContext extends NewConnectionWizardContext {
    awsLocation?: { accountId: string; region: string };
    awsCluster?: AwsCluster;
}

export class SelectAwsRegionStep extends AzureWizardPromptStep<AwsWizardContext> {
    public async prompt(context: AwsWizardContext): Promise<void> {
        while (true) {
            const snapshot = await awsDiscoveryService.listAll().catch((error: unknown) => {
                if (errorName(error) === 'AbortError') {
                    throw new UserCancelledError();
                }
                throw error;
            });
            const locations = new Map<string, { accountId: string; region: string }>();
            for (const resource of snapshot.clusters) {
                locations.set(`${resource.accountId}:${resource.region}`, resource);
            }
            const items: IAzureQuickPickItem<{ accountId: string; region: string } | 'manage' | 'refresh'>[] = [
                ...[...locations.values()].map((location) => ({
                    label: location.region,
                    description: location.accountId,
                    data: location,
                })),
                {
                    label: snapshot.errors.length
                        ? vscode.l10n.t('Click here to revisit credentials')
                        : vscode.l10n.t('Manage AWS Credentials...'),
                    detail: snapshot.errors.length
                        ? snapshot.errors.map((error) => `${error.region ?? ''}: ${error.message}`).join('; ')
                        : vscode.l10n.t('Add or update credentials and selected regions.'),
                    data: 'manage',
                },
                { label: vscode.l10n.t('Refresh'), data: 'refresh' },
            ];
            const choice = await context.ui.showQuickPick(items, {
                placeHolder: locations.size
                    ? vscode.l10n.t('Select an AWS account and region')
                    : vscode.l10n.t('No clusters found. Manage credentials or refresh.'),
                suppressPersistence: true,
                matchOnDescription: true,
            });
            if (choice.data === 'manage') {
                await configureAwsCredentials(context);
            } else if (choice.data === 'refresh') {
                awsDiscoveryService.refreshDiscovery();
            } else {
                context.awsLocation = choice.data;
                return;
            }
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}

export class SelectAwsClusterStep extends AzureWizardPromptStep<AwsWizardContext> {
    public async prompt(context: AwsWizardContext): Promise<void> {
        const location = nonNullValue(context.awsLocation, 'awsLocation', 'SelectAwsClusterStep');
        const snapshot = await awsDiscoveryService.listAll().catch((error: unknown) => {
            if (errorName(error) === 'AbortError') {
                throw new UserCancelledError();
            }
            throw error;
        });
        const resources = snapshot.clusters.filter(
            (resource) => resource.accountId === location.accountId && resource.region === location.region,
        );
        while (true) {
            const selected = await context.ui.showQuickPick(
                resources.map((resource) => ({
                    label: resource.name,
                    description: resource.status,
                    detail: isAwsClusterConnectable(resource)
                        ? resource.endpoint
                        : vscode.l10n.t('This cluster is not available or has no endpoint yet.'),
                    data: resource,
                })),
                { placeHolder: vscode.l10n.t('Select an AWS DocumentDB cluster'), suppressPersistence: true },
            );
            if (isAwsClusterConnectable(selected.data)) {
                context.awsCluster = selected.data;
                return;
            }
            await vscode.window.showWarningMessage(vscode.l10n.t('Select an available cluster with an endpoint.'));
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}

export class PrepareAwsConnectionStep extends AzureWizardPromptStep<AwsWizardContext> {
    public async prompt(context: AwsWizardContext): Promise<void> {
        const resource = nonNullValue(context.awsCluster, 'awsCluster', 'PrepareAwsConnectionStep');
        context.connectionString = await prepareAwsConnection(resource);
        context.experience = DocumentDBExperience;
        context.availableAuthenticationMethods = [AuthMethodId.NativeAuth];
        context.connectionProperties = { awsDocumentDBArn: resource.arn };
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
