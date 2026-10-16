/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
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
    configureCredentialsOnActivation = false;

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
        return 'https://aka.ms/vscode-documentdb-discovery-providers-kubernetes';
    }

    async deactivate(_context: IActionContext): Promise<void> {
        const { PortForwardTunnelManager } = await import('./portForwardTunnel');
        PortForwardTunnelManager.getInstance().stopAll();
    }
}
