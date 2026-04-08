/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ShellEvaluationResult } from './types';

/**
 * Transforms raw @mongosh `ShellResult` objects into clean `ShellEvaluationResult` values.
 *
 * Handles:
 * - Cursor result unwrapping (`{ cursorHasMore, documents }` → plain array)
 * - Array subclass normalization (CursorIterationResult → plain Array)
 * - Source namespace extraction
 */
export class ResultTransformer {
    /**
     * Transform a raw @mongosh ShellResult into a ShellEvaluationResult.
     *
     * @param shellResult - Raw result from `ShellEvaluator.customEval()`.
     *   Expected shape: `{ type: string | null, printable: unknown, source?: { namespace?: {...} } }`
     * @param durationMs - Execution duration in milliseconds.
     */
    transform(shellResult: ShellResultLike, durationMs: number): ShellEvaluationResult {
        const printable = this.normalizePrintable(shellResult.type, shellResult.printable);
        const cursorHasMore = this.extractCursorHasMore(shellResult.type, shellResult.printable);
        const source = this.extractSource(shellResult.source);

        return {
            type: shellResult.type,
            printable,
            durationMs,
            cursorHasMore,
            source,
        };
    }

    /**
     * Normalize the printable value from @mongosh.
     *
     * @mongosh wraps cursor results differently depending on execution context:
     * - Worker context: `{ cursorHasMore: boolean, documents: unknown[] }`
     * - In-process: `CursorIterationResult` (Array subclass)
     *
     * This normalizes both to a plain array.
     */
    private normalizePrintable(type: string | null, printable: unknown): unknown {
        // Cursor result wrapped as { cursorHasMore, documents }
        if (
            type === 'Cursor' &&
            typeof printable === 'object' &&
            printable !== null &&
            'documents' in printable &&
            Array.isArray((printable as { documents?: unknown }).documents)
        ) {
            return (printable as { documents: unknown[] }).documents;
        }

        // Array subclass (CursorIterationResult) — normalize to plain Array
        if (Array.isArray(printable)) {
            return Array.from(printable as unknown[]);
        }

        return printable;
    }

    /**
     * Extract the cursorHasMore flag from the raw @mongosh result.
     *
     * @mongosh may deliver cursor results in two forms:
     * - Object: `{ cursorHasMore: boolean, documents: unknown[] }` (from CursorIterationResult.asPrintable)
     * - Array with property: `CursorIterationResult` (Array subclass with `cursorHasMore` as own property)
     *
     * Both are checked. Non-Cursor types always return undefined.
     */
    private extractCursorHasMore(type: string | null, printable: unknown): boolean | undefined {
        if (type !== 'Cursor' || typeof printable !== 'object' || printable === null) {
            return undefined;
        }

        // Object shape: { cursorHasMore, documents }
        if (
            'cursorHasMore' in printable &&
            typeof (printable as { cursorHasMore: unknown }).cursorHasMore === 'boolean'
        ) {
            return (printable as { cursorHasMore: boolean }).cursorHasMore;
        }

        return undefined;
    }

    /**
     * Extract source namespace from the @mongosh ShellResult.
     */
    private extractSource(source: ShellResultLike['source']): ShellEvaluationResult['source'] | undefined {
        if (!source?.namespace) {
            return undefined;
        }
        return {
            namespace: {
                db: source.namespace.db,
                collection: source.namespace.collection,
            },
        };
    }
}

/**
 * Shape of the raw @mongosh ShellResult.
 * Declared as an interface to avoid depending on @mongosh/shell-api types.
 */
export interface ShellResultLike {
    readonly type: string | null;
    readonly printable: unknown;
    readonly source?: {
        readonly namespace?: {
            readonly db: string;
            readonly collection: string;
        };
    };
}
