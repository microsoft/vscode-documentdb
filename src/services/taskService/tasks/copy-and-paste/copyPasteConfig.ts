/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConflictResolutionStrategy } from '../../data-api/types';

// Re-export for backward compatibility
export { ConflictResolutionStrategy } from '../../data-api/types';

/**
 * Configuration for copy-paste operations
 */
export interface CopyPasteConfig {
    /**
     * Source collection information
     */
    source: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Target collection information
     */
    target: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Conflict resolution strategy
     */
    onConflict: ConflictResolutionStrategy;

    /**
     * Optional reference to a connection manager or client object.
     * For now, this is typed as `unknown` to allow flexibility.
     * Specific task implementations (e.g., for DocumentDB) will cast this to their
     * required client/connection type.
     */
    connectionManager?: unknown; // e.g. could be cast to a DocumentDB client instance
}
