/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Logging middleware body and its pluggable sink (`ProcedureLogger`).
 *
 * This is the zero-dependency observability path: it times each procedure,
 * detects cooperative cancellation, and hands a structured entry to a
 * {@link ProcedureLogger}. The default {@link consoleProcedureLogger} prints to
 * the console so the package works out of the box; production consumers pass
 * their own logger.
 */

import {
    getInvocationSignal,
    type MiddlewareResultLike,
    type ProcedureErrorLike,
    type ProcedureInvocation,
    type ProcedureType,
} from './types';

/** One structured log entry describing a completed procedure invocation. */
export interface ProcedureLogEntry {
    /** The operation kind. */
    type: ProcedureType;
    /** The dotted procedure path, e.g. `collectionView.find`. */
    path: string;
    /** Wall-clock duration of the invocation in milliseconds. */
    durationMs: number;
    /** True when the procedure completed without error. */
    ok: boolean;
    /** True when the operation's `AbortSignal` had fired. */
    aborted: boolean;
    /** The error carried by a failed result, when `ok` is false. */
    error?: ProcedureErrorLike;
    /**
     * Number of concurrent in-flight operations (queries + mutations +
     * subscriptions) at the moment this entry was logged, including the one being
     * logged. Set by `attachTrpc`'s dispatch pump (R766-S04); omitted by the
     * standalone {@link loggingMiddlewareBody}, which has no view of the
     * transport's in-flight set. Route it to a telemetry distribution to observe
     * peak / average concurrency and decide whether the per-operation `window`
     * `message` listener ever needs a single-listener multiplexer.
     */
    concurrent?: number;
}

/** The subset of an invocation known before the procedure runs. */
export interface ProcedureStartEntry {
    /** The operation kind. */
    type: ProcedureType;
    /** The dotted procedure path, e.g. `collectionView.find`. */
    path: string;
}

/**
 * Pluggable sink for {@link loggingMiddlewareBody}. Implement either or both
 * hooks to route procedure log entries to your own logging channel.
 *
 * - `onStart` fires before the procedure runs (span-style start logging);
 * - `onEnd` fires after it completes (success, failure, or cancellation).
 *
 * Both are optional so a consumer can subscribe only to what it needs (for
 * example log only completions and skip start events).
 */
export interface ProcedureLogger {
    /** Called before the procedure runs. Optional. */
    onStart?(entry: ProcedureStartEntry): void;
    /** Called after the procedure completes. Optional. */
    onEnd?(entry: ProcedureLogEntry): void;
}

/**
 * Zero-config default logger. Prints a single line per completed procedure to
 * the console. Replace it with your own {@link ProcedureLogger} in production.
 */
export const consoleProcedureLogger: ProcedureLogger = {
    onEnd(entry: ProcedureLogEntry): void {
        const status = entry.aborted ? 'Canceled' : entry.ok ? 'OK' : 'Failed';
        // eslint-disable-next-line no-console -- this is the package's zero-config default sink
        console.log(
            `[tRPC] ${entry.type} ${entry.path} (${entry.durationMs}ms) ${status}`,
            entry.error ? (entry.error.message ?? entry.error.name ?? '') : '',
        );
    },
};

/**
 * Logging middleware body. Times the invocation, detects cancellation, and logs
 * a structured entry, then returns the procedure's result unchanged.
 *
 * Wire it onto your own tRPC instance:
 *
 * ```ts
 * const { publicProcedure } = initWebviewTrpc<RouterContext>();
 * const logged = publicProcedure.use((opts) => loggingMiddlewareBody(opts, myLogger));
 * ```
 *
 * @param invocation - the tRPC middleware options for this call.
 * @param logger     - sink for the log entry. Defaults to
 *                     {@link consoleProcedureLogger}.
 */
export async function loggingMiddlewareBody<TResult extends MiddlewareResultLike>(
    invocation: ProcedureInvocation<TResult>,
    logger: ProcedureLogger = consoleProcedureLogger,
): Promise<TResult> {
    logger.onStart?.({ type: invocation.type, path: invocation.path });

    const start = Date.now();
    const result = await invocation.next();
    const durationMs = Date.now() - start;

    logger.onEnd?.({
        type: invocation.type,
        path: invocation.path,
        durationMs,
        ok: result.ok,
        aborted: getInvocationSignal(invocation.ctx)?.aborted ?? false,
        error: result.ok ? undefined : result.error,
    });

    return result;
}
