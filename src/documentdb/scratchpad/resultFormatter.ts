/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type ExecutionResult } from './types';

/**
 * Formats a scratchpad execution result for display in a read-only output panel.
 *
 * Output includes:
 * - The executed code (truncated if long)
 * - Result metadata (type, timing, document count)
 * - Formatted result value (EJSON for documents, raw for scalars)
 */
export function formatResult(result: ExecutionResult, code: string): string {
    const lines: string[] = [];

    // Code echo — truncate to first 120 chars if long
    const codePreview = code.length > 120 ? code.slice(0, 120) + '…' : code;
    for (const codeLine of codePreview.split('\n')) {
        lines.push(`// ▶ ${codeLine}`);
    }

    // Result metadata
    if (result.type) {
        const printable = result.printable;
        if (Array.isArray(printable)) {
            lines.push(`// ${l10n.t('{0} documents returned', printable.length)}`);
        } else {
            lines.push(`// ${l10n.t('Result: {0}', result.type)}`);
        }
    }

    lines.push(`// ${l10n.t('Executed in {0}ms', result.durationMs)}`);
    lines.push('// ─────────────────────────');

    // Result value
    lines.push(formatPrintable(result.printable));

    return lines.join('\n');
}

/**
 * Formats an error from scratchpad execution for display.
 */
export function formatError(error: unknown, code: string, durationMs: number): string {
    const lines: string[] = [];

    const codePreview = code.length > 120 ? code.slice(0, 120) + '…' : code;
    for (const codeLine of codePreview.split('\n')) {
        lines.push(`// ▶ ${codeLine}`);
    }

    lines.push(`// ❌ ${l10n.t('Error executing query')}`);
    lines.push(`// ${l10n.t('Executed in {0}ms', durationMs)}`);
    lines.push('// ─────────────────────────');

    const errorMessage = error instanceof Error ? error.message : String(error);
    lines.push(errorMessage);

    return lines.join('\n');
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
