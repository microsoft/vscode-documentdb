/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { DISCOVERY_PROVIDER_ID, ICON_PATH, getDescription, getLabel, getWizardTitle } from './config';
import { KubernetesRootItem } from './discovery-tree/KubernetesRootItem';
import { KubernetesExecuteStep } from './discovery-wizard/KubernetesExecuteStep';
import { SelectContextStep } from './discovery-wizard/SelectContextStep';
import { SelectServiceStep } from './discovery-wizard/SelectServiceStep';

export class KubernetesDiscoveryProvider implements DiscoveryProvider {
    id = DISCOVERY_PROVIDER_ID;
    iconPath = ICON_PATH;
    configureCredentialsOnActivation = true;

    get label(): string {
        return getLabel();
    }

    get description(): string {
        return getDescription();
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new KubernetesRootItem(parentId);
    }

    getDiscoveryWizard(_context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        return {
            title: getWizardTitle(),
            promptSteps: [new SelectContextStep(), new SelectServiceStep()],
            executeSteps: [new KubernetesExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://documentdb.io/documentdb-kubernetes-operator/latest/preview/';
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (node instanceof KubernetesRootItem) {
            const { configureKubernetesFilter } = await import('./filtering/configureKubernetesFilter');
            await configureKubernetesFilter(context);
            ext.discoveryBranchDataProvider.refresh(node);
        }
    }

    async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
        context.telemetry.properties.nodeProvided = node ? 'true' : 'false';

        const { configureKubernetesCredentials } = await import('./credentials/configureKubernetesCredentials');
        const result = await configureKubernetesCredentials(context, { resetFilters: node === undefined });

        if (result.kubeconfigChanged) {
            const { PortForwardTunnelManager } = await import('./portForwardTunnel');
            PortForwardTunnelManager.getInstance().stopAll();
        }

        if (node) {
            ext.discoveryBranchDataProvider.refresh(node);
        } else {
            ext.discoveryBranchDataProvider.refresh();
        }
    }

    async deactivate(_context: IActionContext): Promise<void> {
        const { PortForwardTunnelManager } = await import('./portForwardTunnel');
        PortForwardTunnelManager.getInstance().stopAll();
    }
}
