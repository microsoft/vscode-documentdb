/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A lightweight promise-concurrency limiter (plain semaphore).
 *
 * Caps the number of in-flight async tasks at `concurrency`. As soon as one
 * task completes, the next queued task is dispatched. FIFO order.
 *
 * ```ts
 * const limit = createConcurrencyLimiter({ concurrency: 5 });
 * await Promise.all(items.map((item) => limit(() => fetchOne(item))));
 * ```
 *
 * Notes:
 *
 * - In-house alternative to `p-limit`. `p-limit` is ESM-only since v4 and this
 *   extension is bundled as CommonJS, so we roll our own.
 * - Tasks dispatch in FIFO order. Resolution order depends on task duration
 *   and may differ from dispatch order.
 * - No internal cancellation. Race against an `AbortSignal` at the call site
 *   if needed.
 */
export interface ConcurrencyLimiterOptions {
    /** Maximum number of tasks allowed to run in parallel. Must be >= 1. */
    readonly concurrency: number;
}

/**
 * Function returned by {@link createConcurrencyLimiter}. Wraps an async task so
 * that it respects the limiter's concurrency cap.
 */
export type LimitedRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Creates a new concurrency limiter.
 *
 * @example
 *   const limit = createConcurrencyLimiter({ concurrency: 5 });
 *   await limit(() => doWork());
 */
export function createConcurrencyLimiter(options: ConcurrencyLimiterOptions): LimitedRunner {
    // Reject NaN / Infinity / non-numeric inputs explicitly. Math.floor(NaN)
    // is NaN, and Math.max(1, NaN) is NaN, which would make `active >=
    // concurrency` always false and silently disable the limit. Clamp to 1
    // as a safe default.
    const concurrency = Number.isFinite(options.concurrency) ? Math.max(1, Math.floor(options.concurrency)) : 1;

    let active = 0;
    const waiters: Array<() => void> = [];

    const release = (): void => {
        active--;
        const resume = waiters.shift();
        if (resume) {
            resume();
        }
    };

    return async <T>(fn: () => Promise<T>): Promise<T> => {
        if (active >= concurrency) {
            await new Promise<void>((resolve) => waiters.push(resolve));
        }
        active++;
        try {
            return await fn();
        } finally {
            release();
        }
    };
}
