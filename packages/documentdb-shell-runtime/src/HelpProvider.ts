/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ShellEvaluationResult } from './types';

/**
 * Provides DocumentDB-specific help text for the `help` and `help()` commands.
 *
 * This is extracted from the query playground to be shared between the
 * scratchpad surface and the future interactive shell (Step 9).
 */
export class HelpProvider {
    /**
     * Returns help text for the DocumentDB shell.
     * Includes only commands verified to work on DocumentDB.
     */
    getHelpText(): string {
        const modKey = process.platform === 'darwin' ? '⌘' : 'Ctrl';

        return [
            'DocumentDB Shell - Quick Reference',
            '═══════════════════════════════════════',
            '',
            'Collection Access:',
            '  db.getCollection("name")                       Explicit (recommended)',
            '  db.name                                        Shorthand (also works)',
            '',
            'Query Commands:',
            '  db.getCollection("name").find({})              Find documents',
            '  db.getCollection("name").findOne({})           Find one document',
            '  db.getCollection("name").countDocuments({})    Count documents',
            '  db.getCollection("name").estimatedDocumentCount()  Fast count',
            '  db.getCollection("name").distinct("field")     Distinct values',
            '  db.getCollection("name").aggregate([...])      Aggregation pipeline',
            '',
            'Write Commands:',
            '  db.getCollection("name").insertOne({...})      Insert a document',
            '  db.getCollection("name").insertMany([...])     Insert multiple documents',
            '  db.getCollection("name").updateOne({}, {$set:{}})  Update one',
            '  db.getCollection("name").replaceOne({}, {...}) Replace one',
            '  db.getCollection("name").deleteOne({})         Delete one',
            '  db.getCollection("name").bulkWrite([...])      Batch operations',
            '',
            'Index Commands:',
            '  db.getCollection("name").createIndex({field:1})  Create index',
            '  db.getCollection("name").getIndexes()          List indexes',
            '  db.getCollection("name").dropIndex("name")     Drop index',
            '',
            'Cursor Modifiers:',
            '  .limit(n)                                      Limit results',
            '  .skip(n)                                       Skip results',
            '  .sort({field: 1})                              Sort results',
            '  .project({field: 1})                           Field projection',
            '  .toArray()                                     Get all results',
            '  .count()                                       Count matching',
            '  .explain()                                     Query plan',
            '',
            'Database Commands:',
            '  show dbs                                       List databases',
            '  show collections                               List collections',
            '  use <db>                                       Switch database',
            '  db.getCollectionNames()                        List collection names',
            '  db.getCollectionInfos()                        Collection metadata',
            '  db.createCollection("name")                    Create collection',
            '  db.getCollection("name").drop()                Drop collection',
            '  db.runCommand({...})                           Run a database command',
            '',
            'Shell Commands:',
            '  help                                           Show this help text',
            '  exit / quit                                    Close the shell',
            '  cls / clear                                    Clear the screen',
            '  it                                             Show next batch of cursor results',
            '',
            'BSON Constructors:',
            '  ObjectId("...")                                Create ObjectId',
            '  ISODate("...")                                 Create Date',
            '  NumberDecimal("...")                           Create Decimal128',
            '',
            'Keyboard Shortcuts:',
            `  ${modKey}+Enter             Run current block`,
            `  ${modKey}+Shift+Enter       Run entire file`,
            '',
            'Tips:',
            '  • Separate code blocks with blank lines',
            '  • Variables persist within a block but not between separate runs',
            '  • When running multiple statements, only the last result is shown',
            '  • Use .toArray() to get all results (default batch size: documentDB.shell.batchSize)',
            '',
            'Console Output:',
            '  console.log(value)                             Log to output channel',
            '  print() and printjson() are also supported',
            '  Output appears in the "DocumentDB Query Playground Output" panel',
        ].join('\n');
    }

    /**
     * Returns a help evaluation result with durationMs: 0 (no server round-trip).
     */
    getHelpResult(): ShellEvaluationResult {
        return {
            type: 'Help',
            printable: this.getHelpText(),
            durationMs: 0,
        };
    }
}
