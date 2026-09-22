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

/** Indent applied to every shell help entry. */
const ENTRY_INDENT = '  ';

/** Blank columns between the command and description columns. */
const COLUMN_GAP = 2;

/**
 * Narrowest description column worth keeping. Below this the two-column layout
 * is abandoned and entries are stacked, because a description that wraps every
 * two or three words is harder to read than one on its own line.
 */
const MIN_DESCRIPTION_WIDTH = 12;

/** Assumed terminal width when the caller does not supply one. */
const DEFAULT_HELP_COLUMNS = 80;

/** One line of the shell help document, before it is laid out for a width. */
type ShellHelpLine =
    | { readonly kind: 'header'; readonly text: string }
    | { readonly kind: 'blank' }
    | { readonly kind: 'entry'; readonly command: string; readonly description: string }
    | { readonly kind: 'tip'; readonly text: string; readonly indent: string };

/**
 * Greedy word wrap. Words longer than `width` are left intact rather than split,
 * since every over-long token here is a code fragment.
 */
function wrapText(text: string, width: number): string[] {
    if (width <= 0) {
        return [text];
    }

    const lines: string[] = [];
    let current = '';
    for (const word of text.split(' ')) {
        if (current.length === 0) {
            current = word;
        } else if (current.length + 1 + word.length <= width) {
            current += ' ' + word;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current.length > 0) {
        lines.push(current);
    }
    return lines.length > 0 ? lines : [''];
}

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
     *
     * @param columns - terminal width in columns. Shell help lays itself out to
     * fit; the playground format is fixed-width and ignores this.
     */
    getHelpText(columns?: number): string {
        if (this._surface === 'shell') {
            return this.buildShellHelp(columns);
        }
        return this.buildPlaygroundHelp();
    }

    /**
     * Returns a help evaluation result with durationMs: 0 (no server round-trip).
     *
     * @param columns - terminal width in columns, forwarded to {@link getHelpText}.
     */
    getHelpResult(columns?: number): ShellEvaluationResult {
        return {
            type: 'Help',
            printable: this.getHelpText(columns),
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
     * Build compact shell help, laid out to fit `columns` terminal columns.
     *
     * The command column is sized to the widest command rather than a fixed 40,
     * and descriptions wrap with a hanging indent so they stay in their column.
     * When there is not enough room for a usable description column, entries are
     * stacked instead — command on one line, description indented beneath it.
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
    private buildShellHelp(columns: number = DEFAULT_HELP_COLUMNS): string {
        const header = (text: string): ShellHelpLine => ({ kind: 'header', text });
        const blank: ShellHelpLine = { kind: 'blank' };
        const entry = (command: string, description: string): ShellHelpLine => ({
            kind: 'entry',
            command,
            description,
        });
        const tip = (text: string, indent: string = ENTRY_INDENT): ShellHelpLine => ({ kind: 'tip', text, indent });

        const document: ShellHelpLine[] = [
            header('DocumentDB Shell: Quick Reference'),
            blank,

            header('Query'),
            entry('db.<coll>.find({})', 'Find documents'),
            entry('db.<coll>.findOne({})', 'Find a single document'),
            entry('db.<coll>.aggregate([...])', 'Aggregation pipeline'),
            entry('.limit(n)  .skip(n)  .sort({f:1})', 'Chain on cursors'),
            blank,

            header('Write'),
            entry('db.<coll>.insertOne({...})', 'Insert a document'),
            entry('db.<coll>.updateOne({}, {$set:{}})', 'Update one document'),
            entry('db.<coll>.deleteOne({})', 'Delete one document'),
            blank,

            header('Database'),
            entry('show dbs', 'List databases'),
            entry('show collections', 'List collections'),
            entry('use <db>', 'Switch database'),
            blank,

            header('Shell'),
            entry('help', 'Show this reference'),
            entry('exit / quit', 'Close the shell'),
            entry('cls / clear', 'Clear the screen'),
            blank,

            header('Settings'),
            tip('Select an option to open it in VS Code Settings:'),
            tip('1. ⚙ [colorSupport] Toggle syntax and output colors.'),
            tip('Manual access: search Settings for documentDB.shell.display.colorSupport', '     '),
            tip('2. ⚙ [inlineHints] Toggle 🛈 descriptions, counts, and previews.'),
            tip('Manual access: search Settings for documentDB.shell.display.inlineHints', '     '),
            tip('3. ⚙ [autocompletion] Toggle Tab completion and inline suggestions.'),
            tip('Manual access: search Settings for documentDB.shell.display.autocompletion', '     '),
            blank,

            header('Tips'),
            tip('Variables persist across commands. console.log() output appears inline.'),
        ];

        return this.layoutShellHelp(document, columns).join('\n');
    }

    /**
     * Lay the shell help document out for a given terminal width.
     */
    private layoutShellHelp(document: readonly ShellHelpLine[], columns: number): string[] {
        const commandWidth = Math.max(
            ...document.filter((line) => line.kind === 'entry').map((line) => line.command.length),
        );

        const descriptionWidth = columns - ENTRY_INDENT.length - commandWidth - COLUMN_GAP;
        const stacked = descriptionWidth < MIN_DESCRIPTION_WIDTH;
        const output: string[] = [];
        for (const line of document) {
            switch (line.kind) {
                case 'header':
                    output.push(`# ${line.text}`);
                    break;
                case 'blank':
                    output.push('');
                    break;
                case 'tip':
                    for (const wrapped of wrapText(line.text, Math.max(1, columns - line.indent.length))) {
                        const indent =
                            line.indent.length + wrapped.length <= columns
                                ? line.indent
                                : ENTRY_INDENT.slice(0, Math.max(0, columns - wrapped.length));
                        output.push(indent + wrapped);
                    }
                    break;
                case 'entry':
                    if (stacked) {
                        output.push(ENTRY_INDENT + line.command);
                        for (const wrapped of wrapText(line.description, Math.max(1, columns - 4))) {
                            output.push('    ' + wrapped);
                        }
                    } else {
                        const wrapped = wrapText(line.description, descriptionWidth);
                        const hangingIndent = ' '.repeat(ENTRY_INDENT.length + commandWidth + COLUMN_GAP);
                        output.push(
                            ENTRY_INDENT + line.command.padEnd(commandWidth) + ' '.repeat(COLUMN_GAP) + wrapped[0],
                        );
                        for (const continuation of wrapped.slice(1)) {
                            output.push(hangingIndent + continuation);
                        }
                    }
                    break;
            }
        }

        return output;
    }
}
