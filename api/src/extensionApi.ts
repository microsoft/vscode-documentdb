/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MigrationApi } from './migration/migrationApi';

/**
 * The main API interface for the DocumentDB extension
 */
export interface DocumentDBExtensionApi {
    /**
     * API version for compatibility checking
     */
    readonly apiVersion: string;

    /**
     * Migration-related APIs
     */
    readonly migration: MigrationApi;
}
