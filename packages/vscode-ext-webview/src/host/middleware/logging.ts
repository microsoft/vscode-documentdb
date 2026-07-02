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
}

/**
 * Pluggable sink for {@link loggingMiddlewareBody}. Implement this to route
 * procedure log entries to your own logging channel.
 */
export interface ProcedureLogger {
    log(entry: ProcedureLogEntry): void;
}

/**
 * Zero-config default logger. Prints a single line per procedure to the
 * console. Replace it with your own {@link ProcedureLogger} in production.
 */
export const consoleProcedureLogger: ProcedureLogger = {
    log(entry: ProcedureLogEntry): void {
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
    const start = Date.now();
    const result = await invocation.next();
    const durationMs = Date.now() - start;

    logger.log({
        type: invocation.type,
        path: invocation.path,
        durationMs,
        ok: result.ok,
        aborted: getInvocationSignal(invocation.ctx)?.aborted ?? false,
        error: result.ok ? undefined : result.error,
    });

    return result;
}
