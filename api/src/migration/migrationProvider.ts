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
 * Represents a migration provider that extends basic provider information
 * with methods to obtain available actions and execute them.
 *
 * The workflow is as follows:
 * 1. Call getAvailableActions() to retrieve a list of actions the user can choose from
 * 2. Present these actions to the user for selection
 * 3. Call executeAction() with the selected action's id to perform the operation
 *
 * If getAvailableActions() returns an empty array, executeAction() will be called
 * immediately with no parameter to execute a default action.
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
     * If an empty array is returned, executeAction() will be called immediately
     * with no parameter to execute a default action.
     *
     * @param options - Optional parameters to customize the available actions.
     * @returns A promise that resolves to an array of available actions.
     */
    getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]>;

    /**
     * Executes the operation corresponding to the selected action.
     * The `options` parameter provides context for the execution.
     * The `id` parameter identifies the specific action to be executed.
     * If no `id` is provided, the provider may execute a default action or handle the absence gracefully.
     * This occurs when getAvailableActions() returns an empty array.
     *
     * @param options - Optional parameters providing context for the action execution.
     * @param id - The identifier of the action to execute. If undefined, a default action should be executed.
     * @returns A promise that resolves when the action execution is complete.
     */
    executeAction(options?: ActionsOptions, id?: string): Promise<void>;
}
