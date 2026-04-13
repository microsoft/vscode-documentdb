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
        const sections: string[][] = [];

        sections.push(this.getHeader());
        sections.push(this.getCollectionAccessSection());
        sections.push(this.getQueryCommandsSection());
        sections.push(this.getWriteCommandsSection());
        sections.push(this.getIndexCommandsSection());
        sections.push(this.getCursorModifiersSection());
        sections.push(this.getDatabaseCommandsSection());
        sections.push(this.getBsonConstructorsSection());
        sections.push(this.getKeyboardShortcutsSection());
        sections.push(this.getPlaygroundTipsSection());
        sections.push(this.getConsoleOutputSection());

        return sections.map((lines) => lines.join('\n')).join('\n\n');
    }

    // ─── Private: Shell compact format ───────────────────────────────────────

    /**
     * Build compact shell help with two-column layout.
     *
     * The output uses a structured format that {@link ShellOutputFormatter}
     * can colorize with theme-aware ANSI codes.
     *
     * Lines starting with `#` are section headers (rendered bold/colored).
     * Lines starting with `  ` are command entries (command  description).
     */
    private buildShellHelp(): string {
        const lines: string[] = [];

        lines.push('# DocumentDB Shell — Quick Reference');
        lines.push('');

        // Query & Read
        lines.push('# Query');
        this.addEntry(lines, 'db.<coll>.find({})', 'Find documents');
        this.addEntry(lines, 'db.<coll>.findOne({})', 'Find a single document');
        this.addEntry(lines, 'db.<coll>.countDocuments({})', 'Count matching documents');
        this.addEntry(lines, 'db.<coll>.distinct("field")', 'Distinct field values');
        this.addEntry(lines, 'db.<coll>.aggregate([...])', 'Aggregation pipeline');
        lines.push('');

        // Cursor Modifiers
        lines.push('# Cursor Modifiers');
        this.addEntry(lines, '.limit(n)  .skip(n)  .sort({f:1})', 'Chain on find() cursors');
        this.addEntry(lines, '.project({field: 1})  .toArray()', 'Project fields / materialize');
        this.addEntry(lines, 'it', 'Fetch next batch of results');
        lines.push('');

        // Write
        lines.push('# Write');
        this.addEntry(lines, 'db.<coll>.insertOne({...})', 'Insert a document');
        this.addEntry(lines, 'db.<coll>.insertMany([...])', 'Insert multiple documents');
        this.addEntry(lines, 'db.<coll>.updateOne({}, {$set:{}})', 'Update one document');
        this.addEntry(lines, 'db.<coll>.replaceOne({}, {...})', 'Replace one document');
        this.addEntry(lines, 'db.<coll>.deleteOne({})', 'Delete one document');
        lines.push('');

        // Index
        lines.push('# Indexes');
        this.addEntry(lines, 'db.<coll>.createIndex({field: 1})', 'Create an index');
        this.addEntry(lines, 'db.<coll>.getIndexes()', 'List indexes');
        this.addEntry(lines, 'db.<coll>.dropIndex("name")', 'Drop an index');
        lines.push('');

        // Database
        lines.push('# Database');
        this.addEntry(lines, 'show dbs', 'List databases');
        this.addEntry(lines, 'show collections', 'List collections in current db');
        this.addEntry(lines, 'use <db>', 'Switch database');
        this.addEntry(lines, 'db.createCollection("name")', 'Create a collection');
        this.addEntry(lines, 'db.runCommand({...})', 'Run a database command');
        lines.push('');

        // BSON
        lines.push('# BSON Constructors');
        this.addEntry(lines, 'ObjectId("...")', 'Create ObjectId');
        this.addEntry(lines, 'ISODate("...")', 'Create Date');
        this.addEntry(lines, 'NumberDecimal("...")', 'Create Decimal128');
        lines.push('');

        // Shell
        lines.push('# Shell');
        this.addEntry(lines, 'help', 'Show this reference');
        this.addEntry(lines, 'exit / quit', 'Close the shell');
        this.addEntry(lines, 'cls / clear', 'Clear the screen');
        lines.push('');

        // Tips
        lines.push('# Tips');
        lines.push('  Variables persist across commands within a session.');
        lines.push('  Use db.getCollection("name") for collection names with special characters.');
        lines.push('  console.log() output appears inline.');

        return lines.join('\n');
    }

    /**
     * Append a padded two-column entry: `  command  description`.
     */
    private addEntry(lines: string[], command: string, description: string): void {
        const padded = command.padEnd(40);
        lines.push(`  ${padded}${description}`);
    }

    // ─── Private: Help sections ──────────────────────────────────────────────

    private getHeader(): string[] {
        return ['DocumentDB Query Playground - Quick Reference', '═══════════════════════════════════════'];
    }

    private getCollectionAccessSection(): string[] {
        return [
            'Collection Access:',
            '  db.getCollection("name")                       Explicit (recommended)',
            '  db.name                                        Shorthand (also works)',
        ];
    }

    private getQueryCommandsSection(): string[] {
        return [
            'Query Commands:',
            '  db.getCollection("name").find({})              Find documents',
            '  db.getCollection("name").findOne({})           Find one document',
            '  db.getCollection("name").countDocuments({})    Count documents',
            '  db.getCollection("name").estimatedDocumentCount()  Fast count',
            '  db.getCollection("name").distinct("field")     Distinct values',
            '  db.getCollection("name").aggregate([...])      Aggregation pipeline',
        ];
    }

    private getWriteCommandsSection(): string[] {
        return [
            'Write Commands:',
            '  db.getCollection("name").insertOne({...})      Insert a document',
            '  db.getCollection("name").insertMany([...])     Insert multiple documents',
            '  db.getCollection("name").updateOne({}, {$set:{}})  Update one',
            '  db.getCollection("name").replaceOne({}, {...}) Replace one',
            '  db.getCollection("name").deleteOne({})         Delete one',
            '  db.getCollection("name").bulkWrite([...])      Batch operations',
        ];
    }

    private getIndexCommandsSection(): string[] {
        return [
            'Index Commands:',
            '  db.getCollection("name").createIndex({field:1})  Create index',
            '  db.getCollection("name").getIndexes()          List indexes',
            '  db.getCollection("name").dropIndex("name")     Drop index',
        ];
    }

    private getCursorModifiersSection(): string[] {
        return [
            'Cursor Modifiers:',
            '  .limit(n)                                      Limit results',
            '  .skip(n)                                       Skip results',
            '  .sort({field: 1})                              Sort results',
            '  .project({field: 1})                           Field projection',
            '  .toArray()                                     Get all results',
            '  .count()                                       Count matching',
            '  .explain()                                     Query plan',
        ];
    }

    private getDatabaseCommandsSection(): string[] {
        return [
            'Database Commands:',
            '  show dbs                                       List databases',
            '  show collections                               List collections',
            '  db.getCollectionNames()                        List collection names',
            '  db.getCollectionInfos()                        Collection metadata',
            '  db.createCollection("name")                    Create collection',
            '  db.getCollection("name").drop()                Drop collection',
            '  db.runCommand({...})                           Run a database command',
        ];
    }

    private getBsonConstructorsSection(): string[] {
        return [
            'BSON Constructors:',
            '  ObjectId("...")                                Create ObjectId',
            '  ISODate("...")                                 Create Date',
            '  NumberDecimal("...")                           Create Decimal128',
        ];
    }

    private getKeyboardShortcutsSection(): string[] {
        const modKey = process.platform === 'darwin' ? '⌘' : 'Ctrl';
        return [
            'Keyboard Shortcuts:',
            `  ${modKey}+Enter             Run current block`,
            `  ${modKey}+Shift+Enter       Run entire file`,
        ];
    }

    private getPlaygroundTipsSection(): string[] {
        return [
            'Tips:',
            '  • Separate code blocks with blank lines',
            '  • Variables persist within a block but not between separate runs',
            '  • When running multiple statements, only the last result is shown',
            '  • Use .toArray() to get all results (default batch size: documentDB.shell.batchSize)',
        ];
    }

    private getConsoleOutputSection(): string[] {
        return [
            'Console Output:',
            '  console.log(value)                             Log to output channel',
            '  print() and printjson() are also supported',
            '  Output appears in the "DocumentDB Query Playground Output" panel',
        ];
    }
}
