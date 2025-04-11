/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IWizardOptions } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type NewConnectionWizardContext } from '../commands/newConnection/NewConnectionWizardContext';

/**
 * Describes a service provider with basic information and optional icon.
 */
export interface ProviderDescription {
    readonly id: string;
    readonly label: string;
    readonly description: string;

    readonly iconPath?:
        | vscode.Uri
        | {
              light: vscode.Uri;
              dark: vscode.Uri;
          }
        | vscode.ThemeIcon;
}

export interface ServiceDiscoveryProvider extends ProviderDescription {
    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext>;
}

/**
 * Private implementation of Storage interface that manages items and their
 * associated secrets in VSCode's storage mechanisms.
 *
 * Items are stored in VSCode's globalState, and secrets are stored using SecretStorage.
 * Each item is uniquely identified by its `id` within a given workspace.
 *
 * This class cannot be instantiated directly - use StorageService.get() instead.
 */
class ServiceDiscoveryServiceImpl {
    private serviceProviders: Map<string, ServiceDiscoveryProvider> = new Map();

    public registerProvider(provider: ServiceDiscoveryProvider) {
        this.serviceProviders.set(provider.id, provider);
    }

    public getProvider(id: string): ServiceDiscoveryProvider | undefined {
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

export const ServiceDiscoveryService = new ServiceDiscoveryServiceImpl();
