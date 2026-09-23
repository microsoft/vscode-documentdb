/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { meterSilentCatch } from '../../utils/accumulatingTelemetry';
import { type SerializableExecutionResult } from '../playground/workerTypes';
import { shellAnsi, shellStyles } from './shellStyles';

/**
 * Matches a technical error code prefix at the start of an error message.
 * Pattern: `[LETTERS-DIGITS]` followed by a space and the actual message.
 * Examples: `[PREFIX-12345]`, `[ERR-90001]`, `[API-100]`
 */
const ERROR_CODE_PREFIX_RE = /^\[([A-Z]+-\d+)\]\s*/;

/** Compact settings markers embedded in shell help and handled by the terminal link provider. */
const HELP_SETTINGS_LINK_RE = /\u{2699} \[[^\]]+\]/gu;
const HELP_MANUAL_ACCESS_PREFIX = 'Manual access:';

/**
 * Result of extracting a technical error code from an error message.
 */
export interface ErrorCodeExtraction {
    /** The error message with the technical code prefix removed. */
    readonly message: string;
    /** The extracted error code, if one was present (e.g. `'COMMON-10001'`). */
    readonly errorCode?: string;
}

/**
 * Extracts a technical error code prefix from an error message.
 *
 * Internal error codes are stripped from user-facing output to keep messages
 * clean. The extracted code is preserved for telemetry and diagnostics.
 *
 * @param errorMessage - The raw error message string.
 * @returns The cleaned message and any extracted error code.
 *
 * @example
 * extractErrorCode("[PREFIX-12345] Invalid input provided")
 * // → { message: "Invalid input provided", errorCode: "PREFIX-12345" }
 *
 * extractErrorCode("Connection refused")
 * // → { message: "Connection refused", errorCode: undefined }
 */
export function extractErrorCode(errorMessage: string): ErrorCodeExtraction {
    const match = ERROR_CODE_PREFIX_RE.exec(errorMessage);
    if (!match) {
        return { message: errorMessage };
    }
    return {
        message: errorMessage.slice(match[0].length),
        errorCode: match[1],
    };
}

/**
 * Formats shell evaluation results for terminal output.
 *
 * Handles EJSON deserialization, pretty-printing, and optional ANSI coloring
 * based on the `documentDB.shell.display.colorSupport` setting.
 */
export class ShellOutputFormatter {
    /**
     * Format a successful evaluation result for terminal display.
     *
     * @param result - The serializable result from the worker.
     * @returns Formatted string ready to write to the terminal.
     */
    formatResult(result: SerializableExecutionResult): string {
        // Suppress display for undefined results (e.g. print(), side-effect-only expressions).
        // mongosh convention: undefined return values produce no output.
        if (result.printableIsUndefined) {
            return '';
        }

        const printable = this.deserializePrintable(result.printable);
        const colorEnabled = this.isColorEnabled();

        // Handle special result types
        if (result.type === 'Help') {
            return this.formatHelpText(printable);
        }

        // Format the printable value
        let output = this.formatValue(printable, colorEnabled);

        // Add cursor "more" indicator
        if (result.cursorHasMore) {
            const moreText = l10n.t('Type "it" for more');
            output += '\r\n' + (colorEnabled ? `${shellStyles.muted}${moreText}${shellAnsi.reset}` : moreText);
        }

        return output;
    }

    /**
     * Format an error for terminal display.
     *
     * @param error - The error message string.
     * @returns Red-colored error text (if color enabled).
     */
    formatError(error: string): string {
        const colorEnabled = this.isColorEnabled();
        if (colorEnabled) {
            return `${shellStyles.error}${error}${shellAnsi.reset}`;
        }
        return error;
    }

    /**
     * Format a system message (e.g., "Connecting...", "Disconnected").
     */
    formatSystemMessage(message: string): string {
        const colorEnabled = this.isColorEnabled();
        if (colorEnabled) {
            return `${shellStyles.muted}${message}${shellAnsi.reset}`;
        }
        return message;
    }

    /**
     * Format the shell title as the strongest line in the startup banner.
     */
    formatShellTitle(message: string): string {
        if (!this.isColorEnabled()) {
            return message;
        }
        return `${shellStyles.emphasis}${message}${shellAnsi.reset}`;
    }

    /**
     * Format a value embedded in the gray connection-details line.
     * The trailing gray code restores the surrounding system-message style.
     */
    formatConnectionValue(value: string): string {
        if (!this.isColorEnabled()) {
            return value;
        }
        return `${shellStyles.value}${value}${shellAnsi.reset}${shellStyles.muted}`;
    }

    // ─── Private: Value formatting ───────────────────────────────────────────

    private formatValue(value: unknown, colorEnabled: boolean): string {
        if (value === undefined) {
            return '';
        }
        if (value === null) {
            return colorEnabled ? `${shellStyles.result.boolean}null${shellAnsi.reset}` : 'null';
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number') {
            return colorEnabled ? `${shellStyles.result.number}${String(value)}${shellAnsi.reset}` : String(value);
        }
        if (typeof value === 'boolean') {
            return colorEnabled ? `${shellStyles.result.boolean}${String(value)}${shellAnsi.reset}` : String(value);
        }

        // Objects and arrays — pretty-print as EJSON
        const jsonStr = this.toEjsonString(value);
        if (colorEnabled) {
            return this.colorizeJson(jsonStr);
        }
        return jsonStr;
    }

    /**
     * Deserialize the printable value from the worker.
     *
     * The worker serializes results as EJSON strings. We parse them back
     * to get structured objects. Also unwraps the @mongosh CursorIterationResult
     * wrapper `{ cursorHasMore, documents }` if present.
     */
    private deserializePrintable(printable: string): unknown {
        try {
            const parsed: unknown = EJSON.parse(printable);
            return this.unwrapCursorResult(parsed);
        } catch {
            // If EJSON parsing fails, return the raw string
            return printable;
        }
    }

    /**
     * Unwrap CursorIterationResult from @mongosh.
     *
     * @mongosh produces `{ cursorHasMore, documents }` for cursor results.
     * We unwrap to display just the documents array.
     */
    private unwrapCursorResult(value: unknown): unknown {
        if (
            value !== null &&
            value !== undefined &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            'cursorHasMore' in value &&
            typeof (value as Record<string, unknown>).cursorHasMore === 'boolean' &&
            'documents' in value &&
            Array.isArray((value as { documents: unknown }).documents)
        ) {
            return (value as { documents: unknown[] }).documents;
        }
        return value;
    }

    private toEjsonString(value: unknown): string {
        try {
            return EJSON.stringify(value, undefined, 2, { relaxed: true });
        } catch {
            meterSilentCatch('ShellOutputFormatter_ejson');
            try {
                return JSON.stringify(value, undefined, 2);
            } catch {
                meterSilentCatch('ShellOutputFormatter_json');
                return String(value);
            }
        }
    }

    /**
     * Add ANSI color codes to a JSON string for terminal display.
     *
     * Colors:
     * - Keys: cyan
     * - String values: green
     * - Number values: yellow
     * - Boolean/null: magenta
     * - `_id` field: bold
     */
    private colorizeJson(json: string): string {
        // Process line by line to handle indented JSON
        return json
            .split('\n')
            .map((line) => this.colorizeLine(line))
            .join('\r\n');
    }

    private colorizeLine(line: string): string {
        // Match JSON key-value patterns: "key": value
        // This regex handles the common cases in pretty-printed JSON
        return line.replace(
            /^(\s*)"([^"]+)"(\s*:\s*)(.*)/,
            (_match: string, indent: string, key: string, colon: string, rest: string) => {
                const keyColor =
                    key === '_id' ? `${shellStyles.emphasis}${shellStyles.result.key}` : shellStyles.result.key;
                const coloredKey = `${indent}${keyColor}"${key}"${shellAnsi.reset}${colon}`;
                return coloredKey + this.colorizeValue(rest);
            },
        );
    }

    private colorizeValue(value: string): string {
        const trimmed = value.trim();

        // String value: "..."
        if (trimmed.startsWith('"')) {
            return value.replace(
                /"(?:[^"\\]|\\.)*"/,
                (match) => `${shellStyles.result.string}${match}${shellAnsi.reset}`,
            );
        }

        // Boolean or null
        const boolOrNull = trimmed.replace(/[,\s]/g, '');
        if (boolOrNull === 'true' || boolOrNull === 'false' || boolOrNull === 'null') {
            return value.replace(
                /(true|false|null)/,
                (match) => `${shellStyles.result.boolean}${match}${shellAnsi.reset}`,
            );
        }

        // Number
        if (/^-?\d+(\.\d+)?[,\s]*$/.test(trimmed)) {
            return value.replace(/-?\d+(\.\d+)?/, (match) => `${shellStyles.result.number}${match}${shellAnsi.reset}`);
        }

        return value;
    }

    // ─── Private: Help formatting ────────────────────────────────────────────

    /**
     * Format help text for terminal display.
     *
     * Shell help uses a structured format:
     * - Lines starting with `# ` are section headers → rendered bold
     * - Lines starting with `  ` contain a padded command/description pair → command in yellow
     * - Other lines (tips, blanks) are rendered as-is in gray
     *
     * ANSI colors are theme-aware in VS Code terminals: the basic 16 ANSI colors
     * map to `terminal.ansiRed`, `terminal.ansiGreen`, etc. from the active color theme.
     * This means we get automatic light/dark adaptation and users can customize.
     */
    private formatHelpText(printable: unknown): string {
        let text: string;
        if (typeof printable === 'string') {
            text = printable;
        } else if (typeof printable === 'object' && printable !== null && 'help' in printable) {
            // @mongosh Help results have a .help property with the help text
            text = String((printable as { help: unknown }).help);
        } else {
            return this.toEjsonString(printable);
        }

        const formatted = this.isColorEnabled() ? this.colorizeHelpText(text) : text;
        return formatted.replace(HELP_SETTINGS_LINK_RE, (link) => this.formatLinkSentinel(link));
    }

    /**
     * Apply theme-aware ANSI coloring to structured help text.
     */
    private colorizeHelpText(text: string): string {
        return text
            .split('\n')
            .map((line) => {
                // Section headers: "# Title"
                if (line.startsWith('# ')) {
                    return `${shellStyles.emphasis}${line.slice(2)}${shellAnsi.reset}`;
                }

                // Command entries: "  command(padded)     description"
                // The command column may itself contain internal double-spaces (e.g. ".limit(n)  .skip(n)"),
                // so we use a greedy match for the command and non-greedy for the gap so the split
                // happens at the LAST run of 2+ spaces before the description, not the first.
                const entryMatch = /^( {2})(\S.*\S)( {2,})(\S.+)$/.exec(line);
                if (entryMatch) {
                    const [, indent, command, gap, description] = entryMatch;
                    return `${indent}${shellStyles.completion.action}${command}${shellAnsi.reset}${gap}${shellStyles.muted}${description}${shellAnsi.reset}`;
                }

                if (line.trimStart().startsWith(HELP_MANUAL_ACCESS_PREFIX)) {
                    return `${shellStyles.ghostText}${line}${shellAnsi.reset}`;
                }

                // Tip lines (indented text without two-column structure)
                if (line.startsWith('  ') && line.trim().length > 0) {
                    return `${shellStyles.muted}${line}${shellAnsi.reset}`;
                }

                return line;
            })
            .join('\r\n');
    }

    /**
     * Wrap text with ANSI underline codes to visually indicate a clickable link.
     *
     * Uses `\x1b[4m` (underline on) and `\x1b[24m` (underline off) instead of
     * a full reset, so that surrounding styles (e.g., gray from {@link formatSystemMessage})
     * are preserved.
     *
     * Underline is applied regardless of the `colorSupport` setting because it
     * communicates clickability, not decoration.
     */
    formatLinkSentinel(text: string): string {
        return `${shellAnsi.underline}${text}${shellAnsi.noUnderline}`;
    }

    // ─── Private: Settings ───────────────────────────────────────────────────

    private isColorEnabled(): boolean {
        const config = vscode.workspace.getConfiguration();
        return config.get<boolean>('documentDB.shell.display.colorSupport', true);
    }
}
