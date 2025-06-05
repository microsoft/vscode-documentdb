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

    /**
     * Indicates whether this action requires authentication in the host extension.
     * When true, the host should ensure the user is authenticated before executing the action.
     */
    requiresAuthentication?: boolean;
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
     * Indicates whether this provider requires authentication for its default operation.
     * This is primarily relevant when no custom actions are provided (getAvailableActions returns empty array),
     * as it ensures authentication is performed before executeAction() is called.
     *
     * For granular control, individual actions can specify their own authentication requirements
     * via the requiresAuthentication property in MigrationProviderPickItem.
     *
     * Both methods can be combined: use this property for the default action and
     * requiresAuthentication on individual actions for specific operations.
     */
    requiresAuthentication?: boolean;

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
     * The `options` parameter provides context for the execution.
     * The `id` parameter identifies the specific action to be executed.
     * If no `id` is provided, the provider may execute a default action or handle the absence gracefully.
     *
     * @param options - Optional parameters providing context for the action execution.
     * @param id - The identifier of the action to execute.
     */
    executeAction(options?: ActionsOptions, id?: string): Promise<void>;
}
