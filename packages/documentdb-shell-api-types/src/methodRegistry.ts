/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shell API method registry — maps every method in the DocumentDB shell API
 * `.d.ts` to its underlying server command(s).
 *
 * This registry serves two purposes:
 *   1. Verification: the `verify` script checks that every server command
 *      listed here is still marked as supported in the official Azure
 *      DocumentDB compatibility documentation.
 *   2. Reference: documents the relationship between client-side shell
 *      methods and the server commands they invoke.
 *
 * Methods are organized by target object (database, collection, cursor, global).
 * Shell-only methods (no server command) are flagged with `shellOnly: true`.
 */

import { type ShellMethodEntry } from './types';

// ---------------------------------------------------------------------------
// Database methods (db.*)
// ---------------------------------------------------------------------------

const databaseMethods: readonly ShellMethodEntry[] = [
    { name: 'getCollection', target: 'database', serverCommands: [], shellOnly: true, description: 'Returns a collection object by name (client-side only)' },
    { name: 'getCollectionNames', target: 'database', serverCommands: ['listCollections'], shellOnly: false, description: 'Lists collection names in the current database' },
    { name: 'getCollectionInfos', target: 'database', serverCommands: ['listCollections'], shellOnly: false, description: 'Returns metadata for collections' },
    { name: 'createCollection', target: 'database', serverCommands: ['create'], shellOnly: false, description: 'Creates a new collection' },
    { name: 'dropDatabase', target: 'database', serverCommands: ['dropDatabase'], shellOnly: false, description: 'Drops the current database' },
    { name: 'runCommand', target: 'database', serverCommands: [], shellOnly: true, description: 'Executes an arbitrary database command (pass-through)' },
    { name: 'adminCommand', target: 'database', serverCommands: [], shellOnly: true, description: 'Executes a command against the admin database (pass-through)' },
    { name: 'aggregate', target: 'database', serverCommands: ['aggregate'], shellOnly: false, description: 'Runs a database-level aggregation pipeline' },
    { name: 'getSiblingDB', target: 'database', serverCommands: [], shellOnly: true, description: 'Switches database context (client-side only)' },
    { name: 'getName', target: 'database', serverCommands: [], shellOnly: true, description: 'Returns the current database name (client-side only)' },
    { name: 'stats', target: 'database', serverCommands: ['dbStats'], shellOnly: false, description: 'Returns storage statistics for the database' },
    { name: 'version', target: 'database', serverCommands: ['buildInfo'], shellOnly: false, description: 'Returns the server version string' },
    { name: 'createView', target: 'database', serverCommands: ['create'], shellOnly: false, description: 'Creates a read-only view backed by an aggregation pipeline' },
    { name: 'listCommands', target: 'database', serverCommands: ['listCommands'], shellOnly: false, description: 'Lists available database commands' },
];

// ---------------------------------------------------------------------------
// Collection methods (db.<collection>.*)
// ---------------------------------------------------------------------------

const collectionMethods: readonly ShellMethodEntry[] = [
    { name: 'find', target: 'collection', serverCommands: ['find'], shellOnly: false, description: 'Queries documents matching a filter' },
    { name: 'findOne', target: 'collection', serverCommands: ['find'], shellOnly: false, description: 'Returns a single document matching the filter' },
    { name: 'insertOne', target: 'collection', serverCommands: ['insert'], shellOnly: false, description: 'Inserts a single document' },
    { name: 'insertMany', target: 'collection', serverCommands: ['insert'], shellOnly: false, description: 'Inserts multiple documents' },
    { name: 'updateOne', target: 'collection', serverCommands: ['update'], shellOnly: false, description: 'Updates a single document' },
    { name: 'updateMany', target: 'collection', serverCommands: ['update'], shellOnly: false, description: 'Updates multiple documents' },
    { name: 'deleteOne', target: 'collection', serverCommands: ['delete'], shellOnly: false, description: 'Deletes a single document' },
    { name: 'deleteMany', target: 'collection', serverCommands: ['delete'], shellOnly: false, description: 'Deletes multiple documents' },
    { name: 'aggregate', target: 'collection', serverCommands: ['aggregate'], shellOnly: false, description: 'Runs an aggregation pipeline' },
    { name: 'countDocuments', target: 'collection', serverCommands: ['aggregate'], shellOnly: false, description: 'Counts documents matching a filter (uses aggregate)' },
    { name: 'estimatedDocumentCount', target: 'collection', serverCommands: ['count'], shellOnly: false, description: 'Returns an estimated document count' },
    { name: 'distinct', target: 'collection', serverCommands: ['distinct'], shellOnly: false, description: 'Returns distinct values for a field' },
    { name: 'createIndex', target: 'collection', serverCommands: ['createIndexes'], shellOnly: false, description: 'Creates an index on the collection' },
    { name: 'getIndexes', target: 'collection', serverCommands: ['listIndexes'], shellOnly: false, description: 'Lists indexes on the collection' },
    { name: 'dropIndex', target: 'collection', serverCommands: ['dropIndexes'], shellOnly: false, description: 'Drops an index from the collection' },
    { name: 'drop', target: 'collection', serverCommands: ['drop'], shellOnly: false, description: 'Drops the collection' },
    { name: 'bulkWrite', target: 'collection', serverCommands: ['insert', 'update', 'delete'], shellOnly: false, description: 'Executes multiple write operations in bulk' },
    { name: 'replaceOne', target: 'collection', serverCommands: ['update'], shellOnly: false, description: 'Replaces a single document' },
    { name: 'findOneAndUpdate', target: 'collection', serverCommands: ['findAndModify'], shellOnly: false, description: 'Finds and updates a document atomically' },
    { name: 'findOneAndDelete', target: 'collection', serverCommands: ['findAndModify'], shellOnly: false, description: 'Finds and deletes a document atomically' },
    { name: 'findOneAndReplace', target: 'collection', serverCommands: ['findAndModify'], shellOnly: false, description: 'Finds and replaces a document atomically' },
    { name: 'explain', target: 'collection', serverCommands: ['explain'], shellOnly: false, description: 'Returns the query execution plan' },
    { name: 'renameCollection', target: 'collection', serverCommands: ['renameCollection'], shellOnly: false, description: 'Renames the collection' },
    { name: 'stats', target: 'collection', serverCommands: ['collStats'], shellOnly: false, description: 'Returns storage statistics for the collection' },
    { name: 'isCapped', target: 'collection', serverCommands: ['collStats'], shellOnly: false, description: 'Checks if the collection is capped' },
];

// ---------------------------------------------------------------------------
// Find cursor methods (db.<collection>.find().*)
// ---------------------------------------------------------------------------

const findCursorMethods: readonly ShellMethodEntry[] = [
    { name: 'limit', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Limits the number of results' },
    { name: 'skip', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Skips a number of results' },
    { name: 'sort', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sorts the results' },
    { name: 'toArray', target: 'findCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Returns all results as an array' },
    { name: 'forEach', target: 'findCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Iterates over results with a callback' },
    { name: 'map', target: 'findCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Transforms each result with a callback' },
    { name: 'count', target: 'findCursor', serverCommands: ['count'], shellOnly: false, description: 'Returns the count of matching documents' },
    { name: 'explain', target: 'findCursor', serverCommands: ['explain'], shellOnly: false, description: 'Returns the query execution plan' },
    { name: 'hasNext', target: 'findCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Checks if there are more results' },
    { name: 'next', target: 'findCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Returns the next result' },
    { name: 'batchSize', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sets the batch size for cursor iteration' },
    { name: 'close', target: 'findCursor', serverCommands: ['killCursors'], shellOnly: false, description: 'Closes the cursor and releases server resources' },
    { name: 'collation', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sets the collation for string comparison' },
    { name: 'hint', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Forces the query to use a specific index' },
    { name: 'comment', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Attaches a comment for query profiling' },
    { name: 'maxTimeMS', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sets the maximum execution time' },
    { name: 'readConcern', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sets the read concern level' },
    { name: 'readPref', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Sets the read preference' },
    { name: 'returnKey', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Returns only the index keys' },
    { name: 'showRecordId', target: 'findCursor', serverCommands: ['find'], shellOnly: false, description: 'Includes the storage engine record ID' },
];

// ---------------------------------------------------------------------------
// Aggregation cursor methods (db.<collection>.aggregate().*)
// ---------------------------------------------------------------------------

const aggregationCursorMethods: readonly ShellMethodEntry[] = [
    { name: 'toArray', target: 'aggregationCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Returns all results as an array' },
    { name: 'forEach', target: 'aggregationCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Iterates over results with a callback' },
    { name: 'hasNext', target: 'aggregationCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Checks if there are more results' },
    { name: 'next', target: 'aggregationCursor', serverCommands: ['getMore'], shellOnly: false, description: 'Returns the next result' },
    { name: 'batchSize', target: 'aggregationCursor', serverCommands: ['aggregate'], shellOnly: false, description: 'Sets the batch size' },
    { name: 'close', target: 'aggregationCursor', serverCommands: ['killCursors'], shellOnly: false, description: 'Closes the cursor' },
    { name: 'explain', target: 'aggregationCursor', serverCommands: ['explain'], shellOnly: false, description: 'Returns the execution plan' },
    { name: 'maxTimeMS', target: 'aggregationCursor', serverCommands: ['aggregate'], shellOnly: false, description: 'Sets the maximum execution time' },
];

// ---------------------------------------------------------------------------
// Global functions (top-level shell commands)
// ---------------------------------------------------------------------------

const globalMethods: readonly ShellMethodEntry[] = [
    { name: 'use', target: 'global', serverCommands: [], shellOnly: true, description: 'Switches the current database context' },
    { name: 'help', target: 'global', serverCommands: [], shellOnly: true, description: 'Displays help information' },
    { name: 'print', target: 'global', serverCommands: [], shellOnly: true, description: 'Prints values to output' },
    { name: 'printjson', target: 'global', serverCommands: [], shellOnly: true, description: 'Prints values as formatted JSON' },
    { name: 'sleep', target: 'global', serverCommands: [], shellOnly: true, description: 'Pauses execution for a duration' },
    { name: 'version', target: 'global', serverCommands: ['buildInfo'], shellOnly: false, description: 'Returns the shell version string' },
];

// ---------------------------------------------------------------------------
// Combined registry
// ---------------------------------------------------------------------------

/** All shell API methods across all target objects. */
export const SHELL_API_METHODS: readonly ShellMethodEntry[] = [
    ...databaseMethods,
    ...collectionMethods,
    ...findCursorMethods,
    ...aggregationCursorMethods,
    ...globalMethods,
];

/**
 * Returns all unique server commands referenced by the shell API methods.
 * These are the commands that must be supported by the DocumentDB server
 * for the shell API to function correctly.
 */
export function getRequiredServerCommands(): readonly string[] {
    const commands = new Set<string>();
    for (const method of SHELL_API_METHODS) {
        for (const cmd of method.serverCommands) {
            commands.add(cmd);
        }
    }
    return [...commands].sort();
}

/**
 * Returns methods filtered by target object.
 */
export function getMethodsByTarget(target: ShellMethodEntry['target']): readonly ShellMethodEntry[] {
    return SHELL_API_METHODS.filter((m) => m.target === target);
}
