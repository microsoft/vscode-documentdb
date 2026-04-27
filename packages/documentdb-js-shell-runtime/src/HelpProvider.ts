/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ShellEvaluationResult } from './types';

/**
 * The UI surface consuming the help text.
 *
 * - `'playground'` — Query Playground (`.documentdb` files, CodeLens-driven)
 * - `'shell'` — Interactive Shell (Pseudoterminal REPL)
 */
export type HelpSurface = 'playground' | 'shell';

/**
 * Provides DocumentDB-specific help text for the `help` and `help()` commands.
 *
 * Help content is tailored to the surface:
 * - **Shared sections** (query, write, index, cursor, database, BSON) appear in both.
 * - **Shell-only sections** (exit/quit, cls/clear, it, use) appear only in the shell.
 * - **Playground-only sections** (keyboard shortcuts, block tips) appear only in the playground.
 */
export class HelpProvider {
    private readonly _surface: HelpSurface;

    constructor(surface: HelpSurface = 'playground') {
        this._surface = surface;
    }

    /**
     * Returns help text appropriate for the configured surface.
     */
    getHelpText(): string {
        if (this._surface === 'shell') {
            return this.buildShellHelp();
        }
        return this.buildPlaygroundHelp();
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

    // ─── Private: Playground format (unchanged, wide monospaced layout) ──────

    private buildPlaygroundHelp(): string {
        const modKey = process.platform === 'darwin' ? '⌘' : 'Ctrl';

        const sections: string[][] = [
            // Header
            ['DocumentDB Query Playground: Quick Reference', '═══════════════════════════════════════'],

            // Collection Access
            [
                'Collection Access:',
                '  db.getCollection("name")                       Explicit (recommended)',
                '  db.name                                        Shorthand (also works)',
            ],

            // Query Commands
            [
                'Query Commands:',
                '  db.getCollection("name").find({})              Find documents',
                '  db.getCollection("name").findOne({})           Find one document',
                '  db.getCollection("name").countDocuments({})    Count documents',
                '  db.getCollection("name").estimatedDocumentCount()  Fast count',
                '  db.getCollection("name").distinct("field")     Distinct values',
                '  db.getCollection("name").aggregate([...])      Aggregation pipeline',
            ],

            // Write Commands
            [
                'Write Commands:',
                '  db.getCollection("name").insertOne({...})      Insert a document',
                '  db.getCollection("name").insertMany([...])     Insert multiple documents',
                '  db.getCollection("name").updateOne({}, {$set:{}})  Update one',
                '  db.getCollection("name").replaceOne({}, {...}) Replace one',
                '  db.getCollection("name").deleteOne({})         Delete one',
                '  db.getCollection("name").bulkWrite([...])      Batch operations',
            ],

            // Index Commands
            [
                'Index Commands:',
                '  db.getCollection("name").createIndex({field:1})  Create index',
                '  db.getCollection("name").getIndexes()          List indexes',
                '  db.getCollection("name").dropIndex("name")     Drop index',
            ],

            // Cursor Modifiers
            [
                'Cursor Modifiers:',
                '  .limit(n)                                      Limit results',
                '  .skip(n)                                       Skip results',
                '  .sort({field: 1})                              Sort results',
                '  .project({field: 1})                           Field projection',
                '  .toArray()                                     Get all results',
                '  .count()                                       Count matching',
                '  .explain()                                     Query plan',
            ],

            // Database Commands
            [
                'Database Commands:',
                '  show dbs                                       List databases',
                '  show collections                               List collections',
                '  db.getCollectionNames()                        List collection names',
                '  db.getCollectionInfos()                        Collection metadata',
                '  db.createCollection("name")                    Create collection',
                '  db.getCollection("name").drop()                Drop collection',
                '  db.runCommand({...})                           Run a database command',
            ],

            // BSON Constructors
            [
                'BSON Constructors:',
                '  ObjectId("...")                                Create ObjectId',
                '  ISODate("...")                                 Create Date',
                '  NumberDecimal("...")                           Create Decimal128',
            ],

            // Keyboard Shortcuts
            [
                'Keyboard Shortcuts:',
                `  ${modKey}+Enter             Run current block`,
                `  ${modKey}+Shift+Enter       Run entire file`,
            ],

            // Tips
            [
                'Tips:',
                '  • Separate code blocks with blank lines',
                '  • Variables persist within a block but not between separate runs',
                '  • When running multiple statements, only the last result is shown',
                '  • Use .toArray() to get all results (default batch size: documentDB.batchSize)',
            ],

            // Console Output
            [
                'Console Output:',
                '  console.log(value)                             Log to output channel',
                '  print() and printjson() are also supported',
                '  Output appears in the "DocumentDB Query Playground Output" panel',
            ],
        ];

        return sections.map((lines) => lines.join('\n')).join('\n\n');
    }

    // ─── Private: Shell compact format ───────────────────────────────────────

    /**
     * Build compact shell help with two-column layout.
     *
     * The output uses a line-prefix convention that {@link ShellOutputFormatter.colorizeHelpText}
     * uses to apply theme-aware ANSI colors:
     *
     * - Lines starting with `# ` → section header (bold cyan). The `# ` prefix is stripped from display.
     * - Lines starting with two spaces and matching `  <command><2+ spaces><description>` → two-column
     *   entry. The command column is colored yellow, description gray. The regex uses a greedy match on
     *   the command so entries with internal double-spaces (e.g. `.limit(n)  .skip(n)`) split correctly
     *   at the last gap, not the first.
     * - Other indented lines → treated as plain tip text (gray).
     * - Blank lines → passed through as-is.
     */
    private buildShellHelp(): string {
        const entry = (command: string, description: string) => `  ${command.padEnd(40)}${description}`;

        return [
            '# DocumentDB Shell: Quick Reference',
            '',

            '# Query',
            entry('db.<coll>.find({})', 'Find documents'),
            entry('db.<coll>.findOne({})', 'Find a single document'),
            entry('db.<coll>.aggregate([...])', 'Aggregation pipeline'),
            entry('.limit(n)  .skip(n)  .sort({f:1})', 'Chain on cursors'),
            '',

            '# Write',
            entry('db.<coll>.insertOne({...})', 'Insert a document'),
            entry('db.<coll>.updateOne({}, {$set:{}})', 'Update one document'),
            entry('db.<coll>.deleteOne({})', 'Delete one document'),
            '',

            '# Database',
            entry('show dbs', 'List databases'),
            entry('show collections', 'List collections'),
            entry('use <db>', 'Switch database'),
            '',

            '# Shell',
            entry('help', 'Show this reference'),
            entry('exit / quit', 'Close the shell'),
            entry('cls / clear', 'Clear the screen'),
            '',

            '# Tips',
            '  Variables persist across commands. console.log() output appears inline.',
        ].join('\n');
    }
}
