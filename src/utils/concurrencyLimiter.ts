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
 * ## Picking a mode
 *
 * | Want                                                | Use                                              |
 * | --------------------------------------------------- | ------------------------------------------------ |
 * | "Never more than N in flight, refill on completion" | `{ concurrency: N }` (plain semaphore)           |
 * | "Trickle, paced between dispatches"                 | `{ concurrency: N, interTaskDelayMs: ms }`       |
 * | "Burst of N, rest, burst of N"                      | `{ concurrency: N, interBatchDelayMs: ms }`      |
 *
 * ### Plain semaphore — recommended for slow background work
 *
 * ```ts
 * const limit = createConcurrencyLimiter({ concurrency: 5 });
 * await Promise.all(items.map((item) => limit(() => fetchOne(item))));
 * ```
 *
 * Timeline (5 tasks of varying duration, concurrency = 3):
 * ```
 *   t=0   t1┐  t2┐  t3┐                       <- 3 dispatched immediately
 *   t=10        ┘  ┘                          <- t2 finishes; t4 starts
 *   t=10        t4┐
 *   t=15  ┘            <- t1 finishes; t5 starts
 *   t=15  t5┐
 *   t=22                ┘  <- t3 finishes (queue empty)
 *   t=25        t4┘
 *   t=30  t5┘
 * ```
 * Pipe is never idle while there is work queued, never exceeds the cap. This
 * is the right shape when individual tasks vary in latency (a fast task
 * shouldn't be held up by a slow one in the same "batch").
 *
 * ### `interTaskDelayMs` — when the server wants you to slow down
 *
 * ```ts
 * const limit = createConcurrencyLimiter({ concurrency: 5, interTaskDelayMs: 100 });
 * ```
 *
 * After any task completes, the limiter waits 100 ms before pulling the next
 * one from the queue. Up to 5 may still be in flight at any moment, but new
 * dispatches are paced. Useful when a downstream rate-limit is per-request
 * (e.g. "no more than 10 requests per second per user").
 *
 * ### `interBatchDelayMs` — when you want quiet periods
 *
 * ```ts
 * const limit = createConcurrencyLimiter({ concurrency: 5, interBatchDelayMs: 250 });
 * ```
 *
 * Dispatches 5 at once. Waits for ALL 5 to finish. Sleeps 250 ms. Dispatches
 * the next 5. Useful for low-priority background work that should leave gaps
 * for foreground operations — at the cost of latency, since the slowest task
 * in the batch holds up the next batch.
 *
 * ## Implementation notes
 *
 * - This is a small in-house alternative to `p-limit`. The public `p-limit`
 *   package is ESM-only since v4; this extension is bundled as CommonJS, so
 *   pulling it in would require either pinning to v3 or migrating the whole
 *   build to ESM. Rolling our own avoids that and lets us add the pacing
 *   knobs used by low-priority background work.
 * - Tasks are dispatched in **FIFO order** based on when `limit(fn)` was
 *   called. The order in which their promises *resolve* depends on task
 *   duration and can differ from dispatch order.
 * - Batch mode trades parallelism for predictability: the slowest task in a
 *   batch blocks the next batch from starting. With small `concurrency` and
 *   roughly uniform task durations this is usually fine.
 * - The limiter has no internal cancellation. To cancel queued work, race the
 *   `limit(fn)` promise against an `AbortSignal` at the call site.
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
 * Each call to the returned function enqueues the task; the returned promise
 * resolves with the task's result (or rejects with its error). The limiter's
 * internal state is private — there is no `pending`/`active` accessor. If you
 * need that, expose it from the call site.
 *
 * @example Plain cap (semaphore) — recommended default
 *   const limit = createConcurrencyLimiter({ concurrency: 5 });
 *   // 5 always in flight, refill on completion, no idle gaps:
 *   await Promise.all(items.map((x) => limit(() => fetchOne(x))));
 *
 * @example Per-task pacing (5 in parallel, each new dispatch waits 100 ms)
 *   const limit = createConcurrencyLimiter({ concurrency: 5, interTaskDelayMs: 100 });
 *
 * @example Batched pacing (5 at once, drain, 250 ms rest, next 5, ...)
 *   const limit = createConcurrencyLimiter({ concurrency: 5, interBatchDelayMs: 250 });
 *
 * @example One-at-a-time strict serialization
 *   const limit = createConcurrencyLimiter({ concurrency: 1 });
 *
 * @example Per-key limiters (one independent queue per cluster, user, etc.)
 *   const limiters = new Map<string, LimitedRunner>();
 *   function getLimiter(key: string): LimitedRunner {
 *       let l = limiters.get(key);
 *       if (!l) { l = createConcurrencyLimiter({ concurrency: 5 }); limiters.set(key, l); }
 *       return l;
 *   }
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
