/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
