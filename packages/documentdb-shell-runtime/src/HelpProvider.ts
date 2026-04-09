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
        const sections: string[][] = [];

        sections.push(this.getHeader());
        sections.push(this.getCollectionAccessSection());
        sections.push(this.getQueryCommandsSection());
        sections.push(this.getWriteCommandsSection());
        sections.push(this.getIndexCommandsSection());
        sections.push(this.getCursorModifiersSection());
        sections.push(this.getDatabaseCommandsSection());

        if (this._surface === 'shell') {
            sections.push(this.getShellCommandsSection());
        }

        sections.push(this.getBsonConstructorsSection());

        if (this._surface === 'playground') {
            sections.push(this.getKeyboardShortcutsSection());
            sections.push(this.getPlaygroundTipsSection());
            sections.push(this.getConsoleOutputSection());
        }

        if (this._surface === 'shell') {
            sections.push(this.getShellTipsSection());
        }

        return sections.map((lines) => lines.join('\n')).join('\n\n');
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

    // ─── Private: Help sections ──────────────────────────────────────────────

    private getHeader(): string[] {
        const title =
            this._surface === 'shell'
                ? 'DocumentDB Interactive Shell - Quick Reference'
                : 'DocumentDB Query Playground - Quick Reference';
        return [title, '═══════════════════════════════════════'];
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
        const lines = [
            'Database Commands:',
            '  show dbs                                       List databases',
            '  show collections                               List collections',
        ];

        if (this._surface === 'shell') {
            lines.push('  use <db>                                       Switch database');
        }

        lines.push(
            '  db.getCollectionNames()                        List collection names',
            '  db.getCollectionInfos()                        Collection metadata',
            '  db.createCollection("name")                    Create collection',
            '  db.getCollection("name").drop()                Drop collection',
            '  db.runCommand({...})                           Run a database command',
        );

        return lines;
    }

    private getShellCommandsSection(): string[] {
        return [
            'Shell Commands:',
            '  help                                           Show this help text',
            '  exit / quit                                    Close the shell',
            '  cls / clear                                    Clear the screen',
            '  it                                             Show next batch of cursor results',
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

    private getShellTipsSection(): string[] {
        return [
            'Tips:',
            '  • Variables persist across commands within a session',
            '  • Use "it" to page through cursor results',
            '  • Use .toArray() to get all results (default batch size: documentDB.shell.batchSize)',
            '  • console.log() output appears inline',
        ];
    }
}
