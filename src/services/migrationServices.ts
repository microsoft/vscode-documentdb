/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

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
 * Interface for announced provider configuration.
 * Announced providers are migration tools listed in the extension's package.json
 * that may not yet be installed by the user. They are surfaced in the UI
 * to help users discover available migration tools in the VS Code Marketplace.
 */
export interface AnnouncedMigrationProvider {
    /** The VS Code extension ID of the announced provider (e.g., "ms-azurecosmosdbtools.vscode-mongo-migration") */
    readonly id: string;
    /** Display name shown in the QuickPick */
    readonly name: string;
    /** Short description shown as detail text */
    readonly description: string;
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
    private extensionProviders: Map<string, string> = new Map(); // Maps extension ID to provider ID

    /**
     * Registers a migration provider (API v0.2.0).
     * This method does not track which extension registered the provider.
     * Multiple providers can be registered without restrictions.
     *
     * @param provider The migration provider to register
     */
    public registerProvider(provider: MigrationProvider): void {
        this.migrationProviders.set(provider.id, provider);
        this.updateContext();
    }

    /**
     * Registers a migration provider with extension context validation (API v0.3.0).
     * This method enforces that each extension can only register one migration provider.
     * If an extension attempts to register a second provider, an error will be thrown.
     *
     * @param extensionId The ID of the extension registering the provider
     * @param provider The migration provider to register
     * @throws Error if the extension has already registered a provider
     */
    public registerProviderWithContext(extensionId: string, provider: MigrationProvider): void {
        // Check if this extension already has a provider registered
        const existingProviderId = this.extensionProviders.get(extensionId);
        if (existingProviderId) {
            throw new Error(
                `Extension '${extensionId}' has already registered a migration provider with ID '${existingProviderId}'. ` +
                    `Each extension can only register one migration provider.`,
            );
        }

        // Register the provider
        this.migrationProviders.set(provider.id, provider);
        this.extensionProviders.set(extensionId, provider.id);
        this.updateContext();
    }

    public unregisterProvider(id: string): boolean {
        // Remove from both maps
        const provider = this.migrationProviders.get(id);
        if (provider) {
            // Find and remove the extension mapping
            for (const [extensionId, providerId] of this.extensionProviders.entries()) {
                if (providerId === id) {
                    this.extensionProviders.delete(extensionId);
                    break;
                }
            }
        }

        const result = this.migrationProviders.delete(id);
        this.updateContext();
        return result;
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

    /**
     * Returns a list of announced migration providers from the extension's package.json.
     * These are providers that are advertised but may not yet be installed.
     *
     * The list is read from the `x-announcedMigrationProviders` field in package.json.
     *
     * @param hideInstalled When true (default), filters out providers whose extension
     *   is already registered via the API (tracked by extensionProviders map).
     *   Also handles a legacy workaround for an older migration extension version.
     * @returns Array of announced migration providers
     */
    public listAnnouncedProviders(hideInstalled: boolean = true): AnnouncedMigrationProvider[] {
        const packageJson = ext.context.extension.packageJSON as unknown;
        if (!packageJson || typeof packageJson !== 'object' || !('x-announcedMigrationProviders' in packageJson)) {
            return [];
        }

        const raw = (packageJson as Record<string, unknown>)['x-announcedMigrationProviders'];
        if (!Array.isArray(raw)) {
            return [];
        }

        const announcedProviders = raw.filter((p: unknown): p is AnnouncedMigrationProvider => {
            if (p === null || typeof p !== 'object') {
                return false;
            }
            const c = p as Record<string, unknown>;
            return typeof c.id === 'string' && typeof c.name === 'string' && typeof c.description === 'string';
        });

        if (hideInstalled) {
            // Filter out providers whose extension has already registered via the API.
            // extensionProviders maps extension IDs to their registered provider IDs.
            const filteredList = announcedProviders.filter((provider) => !this.extensionProviders.has(provider.id));

            // Hardcoded workaround for an older version of the migration extension
            // that used a generic provider ID ('one-action-provider') instead of the extension ID.
            // If that old provider is detected, hide the announcement to avoid duplicates.
            const oldMigrationProvider = this.migrationProviders.get('one-action-provider');
            if (oldMigrationProvider?.label === 'Pre-Migration Assessment for Azure Cosmos DB') {
                return filteredList.filter(
                    (provider) => provider.id !== 'ms-azurecosmosdbtools.vscode-mongo-migration',
                );
            }

            return filteredList;
        }

        return announcedProviders;
    }

    /**
     * Updates the VS Code context to reflect the current state of migration providers.
     * Sets 'migrationProvidersAvailable' to true when providers are registered.
     */
    private updateContext(): void {
        const hasProviders = this.migrationProviders.size > 0;
        void vscode.commands.executeCommand('setContext', 'migrationProvidersAvailable', hasProviders);
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
