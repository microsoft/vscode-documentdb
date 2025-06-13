/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conflict resolution strategies for copy-paste operations
 */
export enum ConflictResolutionStrategy {
    Abort = 'abort',
    // Future options: Overwrite = 'overwrite', Skip = 'skip'
}

/**
 * Configuration for copy-paste operations
 */
export interface CopyPasteConfig {
    /** Source collection information */
    source: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };
    /** Target collection information */
    target: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };
    /** Conflict resolution strategy */
    onConflict: ConflictResolutionStrategy;
    /**
     * Optional reference to a connection manager or client object.
     * For now, this is typed as `any` to allow flexibility.
     * Specific task implementations (e.g., for MongoDB) will cast this to their
     * required client/connection type. A more generic interface or base class
     * for connection management might be introduced later.
     * This allows the task to potentially reuse existing connections or manage
     * them more effectively if needed, beyond just using connectionId.
     */
    connectionManager?: unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}