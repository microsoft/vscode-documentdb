/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a query playground connection bound to a specific document.
 * Each playground document has its own connection to a cluster/database.
 */
export interface PlaygroundConnection {
    /** Stable cluster ID for ClustersClient/CredentialCache lookups. */
    readonly clusterId: string;
    /** Human-readable cluster name for display in CodeLens/StatusBar. */
    readonly clusterDisplayName: string;
    /** Target database name for query execution. */
    readonly databaseName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * Used by cross-feature navigation to open the correct branch data provider.
     * @see Views enum
     */
    readonly viewId?: string;
}

/**
 * Result of executing query playground code via the `@mongosh` eval pipeline.
 */
export interface ExecutionResult {
    /** The mongosh result type string (e.g. 'Cursor', 'Document', 'string'). */
    readonly type: string | null;
    /** The printable result value — already iterated for cursors. */
    readonly printable: unknown;
    /** Execution duration in milliseconds. */
    readonly durationMs: number;
    /** Whether the cursor has more documents beyond the returned batch (Cursor results only). */
    readonly cursorHasMore?: boolean;
    /** Source namespace from the `@mongosh` ShellResult, if available. */
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}
