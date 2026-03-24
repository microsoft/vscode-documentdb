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

/**
 * Result of executing scratchpad code via the `@mongosh` eval pipeline.
 */
export interface ExecutionResult {
    /** The mongosh result type string (e.g. 'Cursor', 'Document', 'string'). */
    readonly type: string | null;
    /** The printable result value — already iterated for cursors. */
    readonly printable: unknown;
    /** Execution duration in milliseconds. */
    readonly durationMs: number;
    /** Source namespace from the `@mongosh` ShellResult, if available. */
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}
