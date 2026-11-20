/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTimeoutFinding, formatTarget } from '../runner.js';

import { type Finding, type RunContext } from '../types.js';

/** A new socket was not established within the connection's `connectTimeoutMS`. */
export class ConnectionTimeoutError extends Error {
    public readonly code = 'ETIMEDOUT';

    public constructor(public readonly timeoutMs: number) {
        super('Connection timed out');
        this.name = 'ConnectionTimeoutError';
    }
}

/**
 * The connection's `connectTimeoutMS` when it is shorter than the probe timeout, which the runner
 * already enforces; otherwise `undefined`. Applies to each new socket a probe establishes, as it does
 * for the driver.
 */
export function connectionDeadlineMs(context: RunContext, connectTimeoutMS: number | undefined): number | undefined {
    const probeTimeout = context.effectiveTimeout('probe').timeoutMs;
    return connectTimeoutMS !== undefined && (probeTimeout === null || connectTimeoutMS < probeTimeout)
        ? connectTimeoutMS
        : undefined;
}

/**
 * Establishes one socket (TCP connect, and the TLS handshake for TLS) within `timeoutMs`. Expiry
 * aborts the attempt, so the I/O adapter destroys the socket, and rejects with
 * {@link ConnectionTimeoutError}. A socket that completes after an abort is destroyed.
 */
export async function establishWithin<T extends { destroy(): void }>(
    context: RunContext,
    timeoutMs: number | undefined,
    signal: AbortSignal,
    open: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    let timer: unknown;
    try {
        const pending = open(controller.signal);
        void pending.then(
            (lateSocket): void => {
                if (controller.signal.aborted) {
                    lateSocket.destroy();
                }
            },
            (): void => {},
        );
        if (timeoutMs === undefined) {
            return await pending;
        }
        const expired = new Promise<never>((_, reject): void => {
            timer = context.io.clock.setTimeout((): void => {
                const error = new ConnectionTimeoutError(timeoutMs);
                reject(error);
                controller.abort(error);
            }, timeoutMs);
        });
        return await Promise.race([pending, expired]);
    } finally {
        if (timer !== undefined) {
            context.io.clock.clearTimeout(timer);
        }
        signal.removeEventListener('abort', onAbort);
    }
}

/** The connection-sourced timeout result for a probe whose new socket was not established in time. */
export function connectionTimeoutFinding(
    context: RunContext,
    operation: string,
    error: ConnectionTimeoutError,
): Finding<'check.timeout'> {
    return createTimeoutFinding({
        operation,
        timeoutMs: error.timeoutMs,
        source: 'connection',
        ...(context.target === undefined ? {} : { target: formatTarget(context.target) }),
    });
}
