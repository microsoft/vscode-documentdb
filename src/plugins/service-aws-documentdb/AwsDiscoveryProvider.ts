/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AWS_DISCOVERY_PROVIDER_ID, AWS_VIEW_MODE_KEY } from './config';
import { addAwsCredential, configureAwsCredentials } from './credentialsManagement/configureAwsCredentials';
import { AwsServiceRootItem } from './discovery-tree/AwsServiceRootItem';
import {
    PrepareAwsConnectionStep,
    SelectAwsClusterStep,
    SelectAwsRegionStep,
} from './discovery-wizard/SelectAwsClusterSteps';
import { awsDiscoveryService } from './discovery/AwsDiscoveryService';

export class AwsDiscoveryProvider implements DiscoveryProvider, vscode.Disposable {
    public readonly id = AWS_DISCOVERY_PROVIDER_ID;
    public readonly label = vscode.l10n.t('AWS DocumentDB');
    public readonly description = vscode.l10n.t(
        'Discover Amazon DocumentDB clusters in your AWS accounts and regions.',
    );
    public readonly iconPath = new vscode.ThemeIcon('cloud');

    public getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AwsServiceRootItem(awsDiscoveryService, parentId);
    }

    public async getDiscoveryWizard(
        context: NewConnectionWizardContext,
    ): Promise<IWizardOptions<NewConnectionWizardContext>> {
        if (!(await awsDiscoveryService.listCredentials()).length && !(await addAwsCredential(context))) {
            throw new UserCancelledError();
        }
        return {
            title: vscode.l10n.t('AWS DocumentDB Discovery'),
            promptSteps: [new SelectAwsRegionStep(), new SelectAwsClusterStep(), new PrepareAwsConnectionStep()],
            showLoadingPrompt: true,
        };
    }

    public async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        if (await configureAwsCredentials(context, node)) {
            await this.revealRoot();
        }
    }

    public async addCredential(context: IActionContext, node?: TreeElement): Promise<void> {
        if (await addAwsCredential(context, node)) {
            await this.revealRoot();
        }
    }

    public async switchViewMode(mode: 'tree' | 'list', node: TreeElement): Promise<void> {
        await ext.context.globalState.update(AWS_VIEW_MODE_KEY, mode);
        ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
        ext.discoveryBranchDataProvider.refresh(node);
    }

    public getLearnMoreUrl(): string {
        return 'https://docs.aws.amazon.com/documentdb/latest/developerguide/what-is.html';
    }

    public dispose(): void {
        awsDiscoveryService.dispose();
    }

    private async revealRoot(): Promise<void> {
        try {
            const rootId = `${Views.DiscoveryView}/${this.id}`;
            const roots = await ext.discoveryBranchDataProvider.getChildren(undefined as never);
            const root = roots?.find((item) => item.id === rootId);
            if (!root) {
                ext.outputChannel.warn('[AwsDiscovery] Discovery root could not be found after sign-in.');
                return;
            }
            await ext.discoveryTreeView.reveal(root, { select: false, focus: false, expand: true });
        } catch (error) {
            ext.outputChannel.warn(
                `[AwsDiscovery] Could not reveal discovery root: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}
