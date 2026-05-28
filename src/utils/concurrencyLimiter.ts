/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A lightweight promise-concurrency limiter with optional pacing delays.
 *
 * Caps the number of in-flight async tasks at `concurrency` and supports two
 * independent pacing knobs:
 *
 * - `interTaskDelayMs` — applied after each individual task completes, before
 *   the next queued task is dispatched. Produces a steady trickle: up to
 *   `concurrency` in flight at any time, but each new dispatch is paced.
 *
 * - `interBatchDelayMs` — applied only when the *entire* current set of
 *   in-flight tasks has drained (active count drops to 0) and more work is
 *   queued. After the delay, up to `concurrency` queued tasks are released at
 *   once as the next batch. Produces a "burst, rest, burst" pattern.
 *
 * Both can be combined, but in practice you usually want exactly one of them.
 *
 * Notes:
 * - This is a small in-house alternative to `p-limit`. The public `p-limit`
 *   package is ESM-only since v4; this extension is bundled as CommonJS, so
 *   pulling it in would require either pinning to v3 or migrating the whole
 *   build to ESM. Rolling our own avoids that and lets us add the pacing
 *   knobs used by low-priority background work.
 * - Tasks are dispatched in FIFO order.
 * - Batch mode trades parallelism for predictability: the slowest task in a
 *   batch blocks the next batch from starting. With small `concurrency` and
 *   roughly uniform task durations this is usually fine.
 */
export interface ConcurrencyLimiterOptions {
    /** Maximum number of tasks allowed to run in parallel (and batch size in batch mode). Must be >= 1. */
    readonly concurrency: number;
    /**
     * Optional delay (in milliseconds) applied before dispatching the next
     * queued task after a running task finishes. Defaults to 0 (no delay).
     *
     * Produces a steady trickle: dispatch rate is roughly capped at
     * `concurrency / interTaskDelayMs` tasks per ms while still allowing up to
     * `concurrency` to run in parallel.
     */
    readonly interTaskDelayMs?: number;
    /**
     * Optional delay (in milliseconds) applied between batches.
     *
     * When `> 0`, the limiter dispatches up to `concurrency` tasks, waits for
     * all of them to finish, sleeps for `interBatchDelayMs`, then dispatches
     * the next batch.
     *
     * Defaults to 0 (no inter-batch delay; behaviour is governed only by
     * `concurrency` and `interTaskDelayMs`).
     */
    readonly interBatchDelayMs?: number;
}

/**
 * Function returned by {@link createConcurrencyLimiter}. Wraps an async task so
 * that it respects the limiter's concurrency cap and any configured pacing.
 */
export type LimitedRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Creates a new concurrency limiter.
 *
 * @example Plain cap (semaphore):
 *   const limit = createConcurrencyLimiter({ concurrency: 5 });
 *
 * @example Per-task pacing (5 in parallel, each new dispatch waits 250 ms):
 *   const limit = createConcurrencyLimiter({ concurrency: 5, interTaskDelayMs: 250 });
 *
 * @example Batched pacing (5 at once, 250 ms rest, 5 at once, ...):
 *   const limit = createConcurrencyLimiter({ concurrency: 5, interBatchDelayMs: 250 });
 */
export function createConcurrencyLimiter(options: ConcurrencyLimiterOptions): LimitedRunner {
    const concurrency = Math.max(1, Math.floor(options.concurrency));
    const interTaskDelayMs = Math.max(0, options.interTaskDelayMs ?? 0);
    const interBatchDelayMs = Math.max(0, options.interBatchDelayMs ?? 0);

    let active = 0;
    const waiters: Array<() => void> = [];

    const dispatchOne = (): void => {
        const resume = waiters.shift();
        if (resume) {
            resume();
        }
    };

    const dispatchNextBatch = (): void => {
        // Release up to `concurrency` queued tasks at once as the next batch.
        const batchSize = Math.min(concurrency, waiters.length);
        for (let i = 0; i < batchSize; i++) {
            const resume = waiters.shift();
            if (resume) {
                resume();
            }
        }
    };

    const release = (): void => {
        active--;
        if (waiters.length === 0) {
            return;
        }

        // Inter-batch delay: only when the current batch has fully drained.
        if (interBatchDelayMs > 0 && active === 0) {
            setTimeout(dispatchNextBatch, interBatchDelayMs);
            return;
        }

        // Inter-task delay: applied before every individual dispatch.
        if (interTaskDelayMs > 0) {
            setTimeout(dispatchOne, interTaskDelayMs);
            return;
        }

        dispatchOne();
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
