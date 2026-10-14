/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Receives trace lines. The package never logs connection strings, userinfo, passwords or tokens.
 * Host names, SRV targets, ports, TXT option keys and DNS server addresses are allowed.
 */
export interface SrvResolverLogger {
    trace(message: string): void;
}

export const noopLogger: SrvResolverLogger = {
    trace: (): void => {
        /* no-op */
    },
};

/**
 * Thrown when the caller's `AbortSignal` fires and its `reason` is not an `Error`.
 *
 * Cancellation contract of this package: when the caller's signal aborts, the pending operation
 * rejects with `signal.reason` if it is an `Error` (so the caller gets back exactly the object it
 * aborted with), otherwise with an `SrvResolutionCancelledError`. A cancellation is never reported
 * as a DNS error, and the deadline expiring is never reported as a cancellation (it is `ETIMEOUT`).
 * Callers that need a framework-specific cancellation type (for example `UserCancelledError` in
 * VS Code) map it at their boundary by checking `signal.aborted`.
 */
export class SrvResolutionCancelledError extends Error {
    public readonly name = 'AbortError';
    public readonly code = 'ABORT_ERR';

    constructor(message = 'SRV resolution was cancelled') {
        super(message);
    }
}

/** Returns the error to reject with when `signal` has aborted. */
export function cancellationError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    return reason instanceof Error ? reason : new SrvResolutionCancelledError();
}

/** Throws the cancellation error if `signal` has aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw cancellationError(signal);
    }
}
