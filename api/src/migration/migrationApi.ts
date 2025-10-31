/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type MigrationProvider } from './migrationProvider';

/**
 * API for migration-related functionality.
 * Currently only supports provider registration.
 */
export interface MigrationApi {
    /**
     * Registers a migration provider.
     * @param provider The migration provider to register
     */
    registerProvider(provider: MigrationProvider): void;
}

/**
 * API for migration-related functionality (v0.3.0).
 * Supports provider registration with extension context.
 */
export interface MigrationApiV030 {
    /**
     * Registers a migration provider with extension context validation.
     * Each extension can only register one provider.
     * @param context The calling extension's context
     * @param provider The migration provider to register
     * @throws Error if the extension already has a provider registered
     */
    registerProvider(context: vscode.ExtensionContext, provider: MigrationProvider): void;
}
