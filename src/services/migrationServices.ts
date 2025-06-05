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

export interface MigrationProviderPickItem extends vscode.QuickPickItem {
    id: string;
}

/**
 * Represents optional parameters to customize available actions.
 * Includes connection details and additional properties.
 */
export interface ActionsOptions {
    connectionString?: string;
    databaseName?: string;
    collectionName?: string;

    /**
     * A dictionary for extended properties.
     * Future experimental options can be added here without requiring interface changes.
     */
    extendedProperties?: { [key: string]: string | undefined };
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

/**
 * Represents a migration provider that extends basic provider information
 * with methods to obtain wizard actions and tree data providers.
 */
export interface MigrationProvider extends MigrationProviderDescription {
    getLearnMoreUrl?(): string | undefined;

    /**
     * Returns a set of available actions that a user can choose from.
     * Each action represents a specific operation that can be executed.
     * The returned actions are displayed to the user in a selection interface.
     *
     * @param options - Optional parameters to customize the available actions.
     */
    getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]>;

    /**
     * Executes the operation corresponding to the selected action.
     * The `id` parameter identifies the specific action to be executed.
     * If no `id` is provided, the provider may execute a default action or handle the absence gracefully.
     *
     * @param id - The identifier of the action to execute.
     */
    executeAction(id?: string): Promise<void>;
}
