/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type ExecutionResult, type PlaygroundConnection } from './types';

/**
 * Formats a query playground execution result for display in a read-only output panel.
 *
 * Output includes:
 * - The executed code (truncated if long)
 * - Result metadata (type, timing, document count)
 * - Formatted result value (EJSON for documents, raw for scalars)
 */
export function formatResult(
    result: ExecutionResult,
    code: string,
    connection: PlaygroundConnection,
    displayBatchSize?: number,
): string {
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

    // Result metadata — state what we know, don't guess
    const unwrapped = unwrapCursorResult(result.printable);
    if (result.type === 'Cursor' && Array.isArray(unwrapped)) {
        // Cursor with a known batch: "Result: Cursor (50 documents)"
        lines.push(`// ${l10n.t('Result: Cursor ({0} documents)', unwrapped.length)}`);
    } else if (result.type) {
        // Typed result: "Result: Document", "Result: string", etc.
        lines.push(`// ${l10n.t('Result: {0}', result.type)}`);
    } else if (Array.isArray(unwrapped)) {
        // Untyped array (e.g. .toArray()) — show type and count
        lines.push(`// ${l10n.t('Result: Array ({0} elements)', unwrapped.length)}`);
    }

    lines.push(`// ${l10n.t('Executed in {0}ms', result.durationMs)}`);

    // Batch size hint — shown when the cursor has more documents beyond the returned batch.
    // Primary signal: cursorHasMore from @mongosh. Fallback: count matches displayBatchSize.
    if (result.type === 'Cursor' && Array.isArray(unwrapped)) {
        const truncated =
            result.cursorHasMore === true ||
            (result.cursorHasMore === undefined &&
                displayBatchSize !== undefined &&
                unwrapped.length === displayBatchSize);
        if (truncated) {
            lines.push(
                `// ${l10n.t('Showing first {0} documents (batch size). To change: Settings → documentDB.shell.batchSize', unwrapped.length)}`,
            );
        }
    }

    lines.push('// ─────────────────────────');
    lines.push('');

    // Result value — unwrap cursor wrapper for clean output
    lines.push(formatPrintable(unwrapCursorResult(result.printable)));

    return lines.join('\n');
}

/**
 * Formats an error from query playground execution for display.
 */
export function formatError(
    error: unknown,
    code: string,
    durationMs: number,
    connection: PlaygroundConnection,
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
 * @mongosh's `asPrintable()` on CursorIterationResult produces
 * `{ cursorHasMore: boolean, documents: unknown[] }` instead of a plain array.
 * Only unwraps when the full wrapper shape is present to avoid
 * false positives on user documents that happen to have a `documents` field.
 */
function unwrapCursorResult(printable: unknown): unknown {
    if (
        printable !== null &&
        printable !== undefined &&
        typeof printable === 'object' &&
        !Array.isArray(printable) &&
        'cursorHasMore' in printable &&
        typeof (printable as Record<string, unknown>).cursorHasMore === 'boolean' &&
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
