/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { randomUtils } from './randomUtils';

/**
 * Generates a unique storage ID for a MongoDB connection based on its connection string.
 *
 * The ID format is `storageId-<joined_hosts>-<hashed_connection_string_substring>`.
 *
 * @param connectionString The raw MongoDB connection string.
 * @returns The generated storage ID.
 * @throws Error if the connection string is invalid or has no hosts.
 */
export function generateDocumentDBStorageId(connectionString: string): string {
    if (!connectionString) {
        throw new Error('Connection string cannot be empty');
    }

    let parsedCS: DocumentDBConnectionString;
    try {
        parsedCS = new DocumentDBConnectionString(connectionString);
    } catch (error) {
        throw new Error(`Failed to parse connection string: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!parsedCS.hosts || parsedCS.hosts.length === 0) {
        throw new Error('Invalid connection string: No hosts specified.');
    }

    const randomString = randomUtils.getRandomUUID();
    const storageId = `storageId-${parsedCS.hosts.join('_')}-${randomString}`;

    return storageId;
}
