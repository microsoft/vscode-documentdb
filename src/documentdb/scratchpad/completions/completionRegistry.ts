/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static completion registry for the DocumentDB scratchpad.
 *
 * Contains shell globals, database methods, collection methods, and cursor
 * methods as structured data. These are NOT in `documentdb-constants` because
 * they are shell API surface, not query language operators.
 *
 * Each entry has enough information to produce a `vscode.CompletionItem`.
 */

export interface ShellCompletionEntry {
    /** The label shown in the suggest widget. */
    readonly label: string;
    /** Brief description shown next to the label. */
    readonly description: string;
    /** Snippet text with tab stops (`$1`, `$2`). If absent, `label` is used as insert text. */
    readonly snippet?: string;
    /** Sort prefix for ordering within the category. */
    readonly sortPrefix: string;
    /** The kind of completion item (maps to vscode.CompletionItemKind). */
    readonly kind: 'function' | 'variable' | 'method' | 'module' | 'constructor';
}

// ---------------------------------------------------------------------------
// S1: Top-level globals
// ---------------------------------------------------------------------------

export const SHELL_GLOBALS: readonly ShellCompletionEntry[] = [
    { label: 'db', description: 'Current database object', sortPrefix: '0_', kind: 'variable' },
    { label: 'use', description: 'Switch database', snippet: 'use("${1:database}")', sortPrefix: '1_', kind: 'function' },
    { label: 'help', description: 'Display help information', snippet: 'help()', sortPrefix: '1_', kind: 'function' },
    { label: 'print', description: 'Print values to output', snippet: 'print(${1})', sortPrefix: '1_', kind: 'function' },
    {
        label: 'printjson',
        description: 'Print formatted JSON',
        snippet: 'printjson(${1})',
        sortPrefix: '1_',
        kind: 'function',
    },
    { label: 'sleep', description: 'Pause execution (ms)', snippet: 'sleep(${1:1000})', sortPrefix: '1_', kind: 'function' },
    { label: 'version', description: 'Shell version', snippet: 'version()', sortPrefix: '1_', kind: 'function' },

    // BSON constructors
    {
        label: 'ObjectId',
        description: 'Create an ObjectId',
        snippet: 'ObjectId("${1}")',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    { label: 'UUID', description: 'Create a UUID', snippet: 'UUID("${1}")', sortPrefix: '2_', kind: 'constructor' },
    {
        label: 'ISODate',
        description: 'Create a Date from ISO string',
        snippet: 'ISODate("${1}")',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    {
        label: 'NumberInt',
        description: 'Create a 32-bit integer',
        snippet: 'NumberInt(${1:0})',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    {
        label: 'NumberLong',
        description: 'Create a 64-bit integer',
        snippet: 'NumberLong(${1:0})',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    {
        label: 'NumberDecimal',
        description: 'Create a 128-bit decimal',
        snippet: 'NumberDecimal("${1:0}")',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    {
        label: 'Timestamp',
        description: 'Create a Timestamp',
        snippet: 'Timestamp(${1:0}, ${2:0})',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    {
        label: 'BinData',
        description: 'Create binary data',
        snippet: 'BinData(${1:0}, "${2}")',
        sortPrefix: '2_',
        kind: 'constructor',
    },
    { label: 'MinKey', description: 'Smallest BSON value', snippet: 'MinKey()', sortPrefix: '2_', kind: 'constructor' },
    { label: 'MaxKey', description: 'Largest BSON value', snippet: 'MaxKey()', sortPrefix: '2_', kind: 'constructor' },
];

// ---------------------------------------------------------------------------
// S2: Database methods (db.*)
// ---------------------------------------------------------------------------

export const DATABASE_METHODS: readonly ShellCompletionEntry[] = [
    {
        label: 'getCollection',
        description: 'Get collection by name',
        snippet: 'getCollection("${1:name}")',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'getCollectionNames',
        description: 'List collection names',
        snippet: 'getCollectionNames()',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'createCollection',
        description: 'Create a collection',
        snippet: 'createCollection("${1:name}")',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'dropDatabase',
        description: 'Drop current database',
        snippet: 'dropDatabase()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'runCommand',
        description: 'Execute a database command',
        snippet: 'runCommand({ ${1} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'adminCommand',
        description: 'Execute an admin command',
        snippet: 'adminCommand({ ${1} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'aggregate',
        description: 'Database-level aggregation',
        snippet: 'aggregate([{ ${1} }])',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'getName',
        description: 'Get database name',
        snippet: 'getName()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'stats',
        description: 'Database statistics',
        snippet: 'stats()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'getSiblingDB',
        description: 'Switch to another database',
        snippet: 'getSiblingDB("${1:name}")',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'version',
        description: 'Server version',
        snippet: 'version()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'getCollectionInfos',
        description: 'Collection metadata',
        snippet: 'getCollectionInfos()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'createView',
        description: 'Create a view',
        snippet: 'createView("${1:name}", "${2:source}", [{ ${3} }])',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'listCommands',
        description: 'List available commands',
        snippet: 'listCommands()',
        sortPrefix: '1_',
        kind: 'method',
    },
];

// ---------------------------------------------------------------------------
// S3: Collection methods (db.<collection>.*)
// ---------------------------------------------------------------------------

export const COLLECTION_METHODS: readonly ShellCompletionEntry[] = [
    // High-frequency — sortPrefix '0_'
    { label: 'find', description: 'Query documents', snippet: 'find({ ${1} })', sortPrefix: '0_', kind: 'method' },
    { label: 'findOne', description: 'Query one document', snippet: 'findOne({ ${1} })', sortPrefix: '0_', kind: 'method' },
    {
        label: 'insertOne',
        description: 'Insert one document',
        snippet: 'insertOne({ ${1} })',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'insertMany',
        description: 'Insert multiple documents',
        snippet: 'insertMany([{ ${1} }])',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'updateOne',
        description: 'Update one document',
        snippet: 'updateOne({ ${1:filter} }, { \\$set: { ${2} } })',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'updateMany',
        description: 'Update multiple documents',
        snippet: 'updateMany({ ${1:filter} }, { \\$set: { ${2} } })',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'deleteOne',
        description: 'Delete one document',
        snippet: 'deleteOne({ ${1:filter} })',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'deleteMany',
        description: 'Delete documents',
        snippet: 'deleteMany({ ${1:filter} })',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'aggregate',
        description: 'Aggregation pipeline',
        snippet: 'aggregate([{ ${1} }])',
        sortPrefix: '0_',
        kind: 'method',
    },

    // Medium-frequency — sortPrefix '1_'
    {
        label: 'countDocuments',
        description: 'Count matching documents',
        snippet: 'countDocuments({ ${1} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'estimatedDocumentCount',
        description: 'Fast approximate count',
        snippet: 'estimatedDocumentCount()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'distinct',
        description: 'Distinct field values',
        snippet: 'distinct("${1:field}")',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'createIndex',
        description: 'Create an index',
        snippet: 'createIndex({ ${1:field}: ${2|1,-1|} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'getIndexes',
        description: 'List indexes',
        snippet: 'getIndexes()',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'dropIndex',
        description: 'Drop an index',
        snippet: 'dropIndex("${1:name}")',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'findOneAndUpdate',
        description: 'Find and update atomically',
        snippet: 'findOneAndUpdate({ ${1:filter} }, { \\$set: { ${2} } })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'findOneAndDelete',
        description: 'Find and delete atomically',
        snippet: 'findOneAndDelete({ ${1:filter} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'findOneAndReplace',
        description: 'Find and replace atomically',
        snippet: 'findOneAndReplace({ ${1:filter} }, { ${2} })',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'replaceOne',
        description: 'Replace one document',
        snippet: 'replaceOne({ ${1:filter} }, { ${2} })',
        sortPrefix: '1_',
        kind: 'method',
    },

    // Low-frequency — sortPrefix '2_'
    {
        label: 'bulkWrite',
        description: 'Batch write operations',
        snippet: 'bulkWrite([{ ${1} }])',
        sortPrefix: '2_',
        kind: 'method',
    },
    { label: 'drop', description: 'Drop the collection', snippet: 'drop()', sortPrefix: '2_', kind: 'method' },
    {
        label: 'renameCollection',
        description: 'Rename collection',
        snippet: 'renameCollection("${1:newName}")',
        sortPrefix: '2_',
        kind: 'method',
    },
    { label: 'stats', description: 'Collection statistics', snippet: 'stats()', sortPrefix: '2_', kind: 'method' },
    { label: 'isCapped', description: 'Check if capped', snippet: 'isCapped()', sortPrefix: '2_', kind: 'method' },
    {
        label: 'explain',
        description: 'Query plan explanation',
        snippet: 'explain()',
        sortPrefix: '2_',
        kind: 'method',
    },
];

// ---------------------------------------------------------------------------
// S4: Find cursor methods
// ---------------------------------------------------------------------------

export const FIND_CURSOR_METHODS: readonly ShellCompletionEntry[] = [
    { label: 'limit', description: 'Limit results', snippet: 'limit(${1:10})', sortPrefix: '0_', kind: 'method' },
    { label: 'skip', description: 'Skip results', snippet: 'skip(${1:0})', sortPrefix: '0_', kind: 'method' },
    { label: 'sort', description: 'Sort results', snippet: 'sort({ ${1}: ${2|1,-1|} })', sortPrefix: '0_', kind: 'method' },
    { label: 'toArray', description: 'Get all as array', snippet: 'toArray()', sortPrefix: '0_', kind: 'method' },
    {
        label: 'forEach',
        description: 'Iterate documents',
        snippet: 'forEach(doc => ${1})',
        sortPrefix: '0_',
        kind: 'method',
    },
    {
        label: 'map',
        description: 'Transform documents',
        snippet: 'map(doc => ${1})',
        sortPrefix: '0_',
        kind: 'method',
    },
    { label: 'count', description: 'Count results', snippet: 'count()', sortPrefix: '1_', kind: 'method' },
    { label: 'explain', description: 'Query plan', snippet: 'explain()', sortPrefix: '1_', kind: 'method' },
    { label: 'hasNext', description: 'Check for more', snippet: 'hasNext()', sortPrefix: '1_', kind: 'method' },
    { label: 'next', description: 'Get next document', snippet: 'next()', sortPrefix: '1_', kind: 'method' },
    { label: 'batchSize', description: 'Set batch size', snippet: 'batchSize(${1:50})', sortPrefix: '1_', kind: 'method' },
    { label: 'close', description: 'Close cursor', snippet: 'close()', sortPrefix: '1_', kind: 'method' },
    {
        label: 'collation',
        description: 'Set collation',
        snippet: 'collation({ locale: "${1:en}" })',
        sortPrefix: '1_',
        kind: 'method',
    },
    { label: 'hint', description: 'Force index', snippet: 'hint({ ${1}: 1 })', sortPrefix: '1_', kind: 'method' },
    {
        label: 'comment',
        description: 'Add trace comment',
        snippet: 'comment("${1}")',
        sortPrefix: '1_',
        kind: 'method',
    },
    {
        label: 'maxTimeMS',
        description: 'Set timeout (ms)',
        snippet: 'maxTimeMS(${1:5000})',
        sortPrefix: '1_',
        kind: 'method',
    },
];

// ---------------------------------------------------------------------------
// S5: Aggregation cursor methods (subset of find cursor)
// ---------------------------------------------------------------------------

export const AGGREGATION_CURSOR_METHODS: readonly ShellCompletionEntry[] = [
    { label: 'toArray', description: 'Get all as array', snippet: 'toArray()', sortPrefix: '0_', kind: 'method' },
    {
        label: 'forEach',
        description: 'Iterate documents',
        snippet: 'forEach(doc => ${1})',
        sortPrefix: '0_',
        kind: 'method',
    },
    { label: 'hasNext', description: 'Check for more', snippet: 'hasNext()', sortPrefix: '1_', kind: 'method' },
    { label: 'next', description: 'Get next document', snippet: 'next()', sortPrefix: '1_', kind: 'method' },
    { label: 'batchSize', description: 'Set batch size', snippet: 'batchSize(${1:50})', sortPrefix: '1_', kind: 'method' },
    { label: 'close', description: 'Close cursor', snippet: 'close()', sortPrefix: '1_', kind: 'method' },
    { label: 'explain', description: 'Execution plan', snippet: 'explain()', sortPrefix: '1_', kind: 'method' },
    {
        label: 'maxTimeMS',
        description: 'Set timeout (ms)',
        snippet: 'maxTimeMS(${1:5000})',
        sortPrefix: '1_',
        kind: 'method',
    },
];
