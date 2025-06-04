/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Represents basic information about a migration provider.
 */
export interface MigrationProviderDescription {
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
 * Represents a migration provider that extends basic provider information
 * with methods to obtain wizard options and tree data providers.
 */
export interface MigrationProvider extends MigrationProviderDescription {
    getLearnMoreUrl?(): string | undefined;

    activate(): Promise<void>;
}

/**
 * Private implementation of MigrationService that manages migration providers
 * for migration-related functionality.
 *
 * Migration providers are registered with unique IDs and can be retrieved individually
 * or listed as a collection of provider descriptions.
 *
 * This class cannot be instantiated directly - use the exported MigrationService singleton instead.
 */
class MigrationServiceImpl {
    private migrationProviders: Map<string, MigrationProvider> = new Map();

    public registerProvider(provider: MigrationProvider) {
        this.migrationProviders.set(provider.id, provider);
    }

    public getProvider(id: string): MigrationProvider | undefined {
        return this.migrationProviders.get(id);
    }

    public listProviders(): MigrationProviderDescription[] {
        const providers = Array.from(this.migrationProviders.values()).map((provider) => ({
            id: provider.id,
            label: provider.label,
            description: provider.description,
            iconPath: provider.iconPath,
        }));

        return providers;
    }
}

export const MigrationService = new MigrationServiceImpl();
