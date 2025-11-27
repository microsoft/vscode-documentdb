/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureExtensionApi } from '@microsoft/vscode-azext-utils';
import { type MigrationApi, type MigrationApiV030 } from './migration/migrationApi';

/**
 * The main API interface for the DocumentDB extension
 */
export interface DocumentDBExtensionApi extends AzureExtensionApi {
    /**
     * Migration-related APIs
     */
    readonly migration: MigrationApi;
}

/**
 * The main API interface for the DocumentDB extension (v0.3.0)
 */
export interface DocumentDBExtensionApiV030 extends AzureExtensionApi {
    /**
     * Migration-related APIs (v0.3.0)
     */
    readonly migration: MigrationApiV030;
}
