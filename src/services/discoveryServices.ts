/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IWizardOptions } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../commands/newConnection/NewConnectionWizardContext';
import { type BaseServiceBranchDataProvider } from '../tree/discovery-view/BaseServiceBranchDataProvider';
import { type TreeElement } from '../tree/TreeElement';

/**
 * Represents basic information about a service provider.
 */
export interface ProviderDescription {
    /**
     * Unique identifier for the provider.
     * It's internal and not shown to the user.
     */
    readonly id: string;

    readonly label: string;
    readonly description: string;

    /**
     * Optional icon associated with the provider.
     */
    readonly iconPath?:
        | vscode.Uri
        | {
              light: vscode.Uri;
              dark: vscode.Uri;
          }
        | vscode.ThemeIcon;
}

/**
 * Represents a discovery provider that extends basic provider information
 * with methods to obtain wizard options and tree data providers.
 */
export interface DiscoveryProvider extends ProviderDescription {
    /**
     * Retrieves wizard options for discovering new connections.
     *
     * @param context - The wizard context used during the discovery process.
     * @returns Wizard options configured for the discovery process.
     */
    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext>;

    /**
     * Retrieves the tree data provider for displaying discovered resources.
     *
     * @returns A tree data provider instance for the discovery view.
     */
    getDiscoveryTreeDataProvider(): BaseServiceBranchDataProvider<TreeElement>;
}

/**
 * Private implementation of DiscoveryService that manages cloud service providers
 * for discovery functionality.
 *
 * Service providers are registered with unique IDs and can be retrieved individually
 * or listed as a collection of provider descriptions.
 *
 * This class cannot be instantiated directly - use the exported DiscoveryService singleton instead.
 */
class DiscoveryServiceImpl {
    private serviceProviders: Map<string, DiscoveryProvider> = new Map();

    public registerProvider(provider: DiscoveryProvider) {
        this.serviceProviders.set(provider.id, provider);
    }

    public getProvider(id: string): DiscoveryProvider | undefined {
        return this.serviceProviders.get(id);
    }

    public listProviders(): ProviderDescription[] {
        const providers = Array.from(this.serviceProviders.values()).map((provider) => ({
            id: provider.id,
            label: provider.label,
            description: provider.description,
            iconPath: provider.iconPath,
        }));

        return providers;
    }
}

export const DiscoveryService = new DiscoveryServiceImpl();
