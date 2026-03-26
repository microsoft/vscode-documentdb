/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type ExecutionResult, type ScratchpadConnection } from './types';

/**
 * Formats a scratchpad execution result for display in a read-only output panel.
 *
 * Output includes:
 * - The executed code (truncated if long)
 * - Result metadata (type, timing, document count)
 * - Formatted result value (EJSON for documents, raw for scalars)
 */
export function formatResult(result: ExecutionResult, code: string, connection: ScratchpadConnection): string {
    const lines: string[] = [];

    // Connection and timestamp
    lines.push(`// ${connection.clusterDisplayName} / ${connection.databaseName}`);
    lines.push(`// ${new Date().toLocaleString()}`);
    lines.push('//');

    // Code echo — truncate to first 120 chars if long
    const codePreview = code.length > 120 ? code.slice(0, 120) + '…' : code;
    for (const codeLine of codePreview.split('\n')) {
        lines.push(`// ▶ ${codeLine}`);
    }

    // Result metadata
    // Result metadata — state what we know from @mongosh, don't guess
    const unwrapped = unwrapCursorResult(result.printable);
    if (result.type === 'Cursor' && Array.isArray(unwrapped)) {
        // Cursor with a known batch: "Result: Cursor (20 documents)"
        lines.push(`// ${l10n.t('Result: Cursor ({0} documents)', unwrapped.length)}`);
    } else if (result.type) {
        // Typed result: "Result: Document", "Result: string", etc.
        lines.push(`// ${l10n.t('Result: {0}', result.type)}`);
    } else if (Array.isArray(unwrapped)) {
        // Untyped array (e.g. .toArray()) — show type and count
        lines.push(`// ${l10n.t('Result: Array ({0} elements)', unwrapped.length)}`);
    }

    lines.push(`// ${l10n.t('Executed in {0}ms', result.durationMs)}`);
    lines.push('// ─────────────────────────');
    lines.push('');

    // Result value — unwrap cursor wrapper for clean output
    lines.push(formatPrintable(unwrapCursorResult(result.printable)));

    return lines.join('\n');
}

/**
 * Formats an error from scratchpad execution for display.
 */
export function formatError(
    error: unknown,
    code: string,
    durationMs: number,
    connection: ScratchpadConnection,
): string {
    const lines: string[] = [];

    // Connection and timestamp
    lines.push(`// ${connection.clusterDisplayName} / ${connection.databaseName}`);
    lines.push(`// ${new Date().toLocaleString()}`);
    lines.push('//');

    const codePreview = code.length > 120 ? code.slice(0, 120) + '…' : code;
    for (const codeLine of codePreview.split('\n')) {
        lines.push(`// ▶ ${codeLine}`);
    }

    lines.push(`// ❌ ${l10n.t('Error executing query')}`);
    lines.push(`// ${l10n.t('Executed in {0}ms', durationMs)}`);
    lines.push('// ─────────────────────────');
    lines.push('');

    const errorMessage = error instanceof Error ? error.message : String(error);
    lines.push(errorMessage);

    return lines.join('\n');
}

/**
 * Unwrap CursorIterationResult from @mongosh.
 *
 * @mongosh's `asPrintable()` on CursorIterationResult produces `{ cursorHasMore, documents }`
 * instead of a plain array. This function extracts the `documents` array for clean display
 * and schema feeding.
 */
function unwrapCursorResult(printable: unknown): unknown {
    if (
        printable !== null &&
        printable !== undefined &&
        typeof printable === 'object' &&
        !Array.isArray(printable) &&
        'documents' in printable &&
        Array.isArray((printable as { documents: unknown }).documents)
    ) {
        return (printable as { documents: unknown[] }).documents;
    }
    return printable;
}

function formatPrintable(printable: unknown): string {
    if (printable === undefined) {
        return 'undefined';
    }
    if (printable === null) {
        return 'null';
    }
    if (typeof printable === 'string') {
        return printable;
    }
    if (typeof printable === 'number' || typeof printable === 'boolean') {
        return String(printable);
    }
    // Documents, arrays, cursors — use EJSON for structured output.
    // Fall back to JSON.stringify with circular reference handling if EJSON fails.
    try {
        return EJSON.stringify(printable, undefined, 2, { relaxed: true });
    } catch {
        try {
            return JSON.stringify(printable, undefined, 2);
        } catch {
            return String(printable);
        }
    }
}
