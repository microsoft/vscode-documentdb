/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the active scratchpad connection.
 * All scratchpad files share a single global connection (Decision D1: Option B).
 */
export interface ScratchpadConnection {
    /** Stable cluster ID for ClustersClient/CredentialCache lookups. */
    readonly clusterId: string;
    /** Human-readable cluster name for display in CodeLens/StatusBar. */
    readonly clusterDisplayName: string;
    /** Target database name for query execution. */
    readonly databaseName: string;
}
