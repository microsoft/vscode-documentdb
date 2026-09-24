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

/** Identifies the structured Interactive Shell help payload across the worker boundary. */
export const SHELL_HELP_DOCUMENT_KIND = 'documentdb.shellHelp' as const;

export type ShellHelpTextTone = 'muted' | 'ghost';

export interface ShellHelpTextSpan {
    readonly text: string;
    readonly tone: ShellHelpTextTone;
    readonly link?: boolean;
}

export type ShellHelpDocumentLine =
    | { readonly kind: 'header'; readonly text: string }
    | { readonly kind: 'blank' }
    | {
          readonly kind: 'entry';
          readonly indent: string;
          readonly command: string;
          readonly gap: string;
          readonly description: string;
      }
    | { readonly kind: 'text'; readonly spans: readonly ShellHelpTextSpan[] };

export interface ShellHelpDocument {
    readonly kind: typeof SHELL_HELP_DOCUMENT_KIND;
    readonly lines: readonly ShellHelpDocumentLine[];
}

/** One semantic line of shell help, before it is laid out for a width. */
type ShellHelpSourceLine =
    | { readonly kind: 'header'; readonly text: string }
    | { readonly kind: 'blank' }
    | { readonly kind: 'entry'; readonly command: string; readonly description: string }
    | {
          readonly kind: 'tip';
          readonly text: string;
          readonly indent: string;
          readonly tone: ShellHelpTextTone;
      }
    | {
          readonly kind: 'link';
          readonly marker: string;
          readonly description: string;
          readonly indent: string;
      };

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
            return this.renderShellHelpText(this.buildShellHelp(columns));
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
            printable: this._surface === 'shell' ? this.buildShellHelp(columns) : this.getHelpText(columns),
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
     * Semantic line and span kinds survive layout so the extension host can apply
     * theme-aware ANSI styles without inferring meaning from the rendered text.
     */
    private buildShellHelp(columns: number = DEFAULT_HELP_COLUMNS): ShellHelpDocument {
        const header = (text: string): ShellHelpSourceLine => ({ kind: 'header', text });
        const blank: ShellHelpSourceLine = { kind: 'blank' };
        const entry = (command: string, description: string): ShellHelpSourceLine => ({
            kind: 'entry',
            command,
            description,
        });
        const tip = (
            text: string,
            tone: ShellHelpTextTone = 'muted',
            indent: string = ENTRY_INDENT,
        ): ShellHelpSourceLine => ({ kind: 'tip', text, indent, tone });
        const link = (marker: string, description: string): ShellHelpSourceLine => ({
            kind: 'link',
            marker,
            description,
            indent: ENTRY_INDENT,
        });

        const document: ShellHelpSourceLine[] = [
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
            link('⚙ [shellSettings]', 'Configure paste behavior, colors, inline hints, and autocompletion.'),
            tip('Manual access: search Settings for @ext:ms-azuretools.vscode-documentdb documentDB.shell', 'ghost'),
            blank,

            header('Tips'),
            tip('Variables persist across commands. console.log() output appears inline.'),
        ];

        return {
            kind: SHELL_HELP_DOCUMENT_KIND,
            lines: this.layoutShellHelp(document, columns),
        };
    }

    /**
     * Lay the shell help document out for a given terminal width.
     */
    private layoutShellHelp(document: readonly ShellHelpSourceLine[], columns: number): ShellHelpDocumentLine[] {
        const commandWidth = Math.max(
            ...document.filter((line) => line.kind === 'entry').map((line) => line.command.length),
        );

        const descriptionWidth = columns - ENTRY_INDENT.length - commandWidth - COLUMN_GAP;
        const stacked = descriptionWidth < MIN_DESCRIPTION_WIDTH;
        const output: ShellHelpDocumentLine[] = [];
        for (const line of document) {
            switch (line.kind) {
                case 'header':
                    output.push(line);
                    break;
                case 'blank':
                    output.push(line);
                    break;
                case 'tip':
                    for (const wrapped of wrapText(line.text, Math.max(1, columns - line.indent.length))) {
                        const indent =
                            line.indent.length + wrapped.length <= columns
                                ? line.indent
                                : ENTRY_INDENT.slice(0, Math.max(0, columns - wrapped.length));
                        output.push({
                            kind: 'text',
                            spans: [{ text: indent + wrapped, tone: line.tone }],
                        });
                    }
                    break;
                case 'link': {
                    const unbreakableMarker = line.marker.replaceAll(' ', '\u00a0');
                    const wrappedLines = wrapText(
                        `${unbreakableMarker} ${line.description}`,
                        Math.max(1, columns - line.indent.length),
                    ).map((wrapped) => wrapped.replaceAll('\u00a0', ' '));
                    const [firstLine, ...continuations] = wrappedLines;
                    output.push({
                        kind: 'text',
                        spans: [
                            { text: line.indent, tone: 'muted' },
                            { text: line.marker, tone: 'muted', link: true },
                            { text: firstLine.slice(line.marker.length), tone: 'muted' },
                        ],
                    });
                    for (const continuation of continuations) {
                        output.push({
                            kind: 'text',
                            spans: [{ text: line.indent + continuation, tone: 'muted' }],
                        });
                    }
                    break;
                }
                case 'entry':
                    if (stacked) {
                        output.push({
                            kind: 'text',
                            spans: [{ text: ENTRY_INDENT + line.command, tone: 'muted' }],
                        });
                        for (const wrapped of wrapText(line.description, Math.max(1, columns - 4))) {
                            output.push({
                                kind: 'text',
                                spans: [{ text: '    ' + wrapped, tone: 'muted' }],
                            });
                        }
                    } else {
                        const wrapped = wrapText(line.description, descriptionWidth);
                        const hangingIndent = ' '.repeat(ENTRY_INDENT.length + commandWidth + COLUMN_GAP);
                        output.push({
                            kind: 'entry',
                            indent: ENTRY_INDENT,
                            command: line.command,
                            gap: ' '.repeat(commandWidth - line.command.length + COLUMN_GAP),
                            description: wrapped[0],
                        });
                        for (const continuation of wrapped.slice(1)) {
                            output.push({
                                kind: 'text',
                                spans: [{ text: hangingIndent + continuation, tone: 'muted' }],
                            });
                        }
                    }
                    break;
            }
        }

        return output;
    }

    private renderShellHelpText(document: ShellHelpDocument): string {
        return document.lines
            .map((line) => {
                switch (line.kind) {
                    case 'header':
                        return `# ${line.text}`;
                    case 'blank':
                        return '';
                    case 'entry':
                        return line.indent + line.command + line.gap + line.description;
                    case 'text':
                        return line.spans.map((span) => span.text).join('');
                }
            })
            .join('\n');
    }
}
