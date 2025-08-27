/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import { extensions } from 'vscode';

/**
 * This file contains the activation conditions for the DocumentDB extension.
 * The logic has been defined in the following ticket:
 * https://github.com/microsoft/vscode-documentdb/issues/30
 *
 * The goal is to ensure that parts of the extension are activated in sync with partner extensions.
 */

const AZURE_DATABASES_WORKSPACE_HANDOVER_VERSION = '10.25.3'; // This is the version that stops supporting documentdb workspaces
const AZURE_DATABASES_VCORE_HANDOVER_VERSION = '11.0.0'; // This is the version that stops supporting vCore Azure Resources
const AZURE_DATABASES_RU_HANDOVER_VERSION = '10.26.0'; // This is the version that stops supporting RU Azure Resources

let cachedAzureDatabasesVersion: semver.SemVer | null | undefined = undefined;

/**
 * Retrieves and caches the version of the Azure Databases (CosmosDB) extension.
 * This is used to determine feature activation based on the partner extension's version.
 * Returns a semver.SemVer object if the extension is installed and the version is valid,
 * otherwise returns null.
 */
function getAzureDatabasesVersion(): semver.SemVer | null {
    if (cachedAzureDatabasesVersion !== undefined) {
        return cachedAzureDatabasesVersion;
    }

    try {
        const vsCodeCosmosDB = extensions.getExtension('ms-azuretools.vscode-cosmosdb');
        if (!vsCodeCosmosDB) {
            cachedAzureDatabasesVersion = null;
            return cachedAzureDatabasesVersion;
        }
        const version = (vsCodeCosmosDB.packageJSON as { version: string }).version;
        cachedAzureDatabasesVersion = semver.parse(version, true); // Validate the version string
    } catch {
        cachedAzureDatabasesVersion = null;
    }
    return cachedAzureDatabasesVersion;
}

/**
 * Determines if workspace support should be enabled in the DocumentDB extension.
 * This is based on the version of the Azure Databases extension.
 * Returns true if the partner extension's version is greater than or equal to the handover version.
 */
export function enableWorkspaceSupport(): boolean {
    const azureDatabasesVersion = getAzureDatabasesVersion();
    if (!azureDatabasesVersion) {
        return false;
    }
    return semver.gte(azureDatabasesVersion, AZURE_DATABASES_WORKSPACE_HANDOVER_VERSION);
}

/**
 * Determines if MongoDB vCore support should be enabled in the DocumentDB extension.
 * This is based on the version of the Azure Databases extension.
 * Returns true if the partner extension's version is greater than or equal to the handover version.
 */
export function enableMongoVCoreSupport(): boolean {
    const azureDatabasesVersion = getAzureDatabasesVersion();
    if (!azureDatabasesVersion) {
        return true;
    }
    return semver.gte(azureDatabasesVersion, AZURE_DATABASES_VCORE_HANDOVER_VERSION);
}

/**
 * Determines if MongoDB RU support should be enabled in the DocumentDB extension.
 * This is based on the version of the Azure Databases extension.
 * Returns true if the partner extension's version is greater than or equal to the handover version.
 */
export function enableMongoRUSupport(): boolean {
    const azureDatabasesVersion = getAzureDatabasesVersion();
    if (!azureDatabasesVersion) {
        return true;
    }
    return semver.gte(azureDatabasesVersion, AZURE_DATABASES_RU_HANDOVER_VERSION);
}
