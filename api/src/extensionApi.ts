/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MigrationApi } from './migration/migrationApi';
import { type TestingApi } from './testing/testingApi';

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

    /**
     * Testing-related APIs (only available in test mode)
     */
    readonly testing?: TestingApi;
}
