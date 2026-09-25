/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConcurrencyLimiter } from './concurrencyLimiter';

/**
 * Returns `{ promise, resolve, reject }` for an externally-resolvable promise.
 * Used to construct tasks whose completion the test controls precisely.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Flush pending microtasks so that synchronously-resolved awaits propagate
 * through the limiter's state machine before the test inspects counters.
 */
async function flush(): Promise<void> {
    // A couple of macrotask-boundary flushes is plenty: the limiter only uses
    // promise microtasks, no timers.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

describe('createConcurrencyLimiter', () => {
    describe('cap enforcement', () => {
        it('never lets more than `concurrency` tasks run in parallel', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 3 });
            let active = 0;
            let peak = 0;

            const gates = Array.from({ length: 10 }, () => deferred<void>());

            const runs = gates.map((gate, i) =>
                limit(async () => {
                    active++;
                    if (active > peak) {
                        peak = active;
                    }
                    await gate.promise;
                    active--;
                    return i;
                }),
            );

            await flush();
            expect(active).toBe(3);
            expect(peak).toBe(3);

            // Release tasks one at a time and verify cap stays respected.
            for (const gate of gates) {
                gate.resolve();
                await flush();
                expect(active).toBeLessThanOrEqual(3);
                expect(peak).toBe(3);
            }

            const results = await Promise.all(runs);
            expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            expect(peak).toBe(3);
        });

        it('clamps concurrency to at least 1', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 0 });
            let active = 0;
            let peak = 0;

            const gates = Array.from({ length: 3 }, () => deferred<void>());

            const runs = gates.map((gate) =>
                limit(async () => {
                    active++;
                    if (active > peak) {
                        peak = active;
                    }
                    await gate.promise;
                    active--;
                }),
            );

            await flush();
            expect(active).toBe(1);
            expect(peak).toBe(1);

            for (const gate of gates) {
                gate.resolve();
                await flush();
            }
            await Promise.all(runs);
            expect(peak).toBe(1);
        });

        it('rounds fractional concurrency down', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 2.9 });
            let active = 0;
            let peak = 0;

            const gates = Array.from({ length: 4 }, () => deferred<void>());

            const runs = gates.map((gate) =>
                limit(async () => {
                    active++;
                    if (active > peak) {
                        peak = active;
                    }
                    await gate.promise;
                    active--;
                }),
            );

            await flush();
            expect(peak).toBe(2);

            for (const gate of gates) {
                gate.resolve();
                await flush();
            }
            await Promise.all(runs);
        });
    });

    describe('FIFO dispatch', () => {
        it('dispatches queued tasks in enqueue order', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 1 });
            const dispatchOrder: number[] = [];
            const gates = Array.from({ length: 5 }, () => deferred<void>());

            const runs = gates.map((gate, i) =>
                limit(async () => {
                    dispatchOrder.push(i);
                    await gate.promise;
                    return i;
                }),
            );

            await flush();
            expect(dispatchOrder).toEqual([0]);

            for (let i = 0; i < gates.length; i++) {
                gates[i].resolve();
                await flush();
            }

            await Promise.all(runs);
            expect(dispatchOrder).toEqual([0, 1, 2, 3, 4]);
        });
    });

    describe('error handling', () => {
        it('releases capacity when a task rejects', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 2 });
            const gate = deferred<void>();
            let secondStarted = false;

            const first = limit(async () => {
                throw new Error('boom');
            });
            const second = limit(async () => {
                throw new Error('also boom');
            });
            const third = limit(async () => {
                secondStarted = true;
                await gate.promise;
            });

            await expect(first).rejects.toThrow('boom');
            await expect(second).rejects.toThrow('also boom');
            await flush();
            expect(secondStarted).toBe(true);

            gate.resolve();
            await third;
        });

        it('keeps the cap correct after a rejection while others are queued', async () => {
            const limit = createConcurrencyLimiter({ concurrency: 1 });
            const gateA = deferred<void>();
            const gateB = deferred<void>();
            let bStarted = false;

            const a = limit(async () => {
                await gateA.promise;
                throw new Error('a failed');
            });
            const b = limit(async () => {
                bStarted = true;
                await gateB.promise;
                return 'b';
            });

            await flush();
            expect(bStarted).toBe(false);

            gateA.resolve();
            await expect(a).rejects.toThrow('a failed');
            await flush();
            expect(bStarted).toBe(true);

            gateB.resolve();
            await expect(b).resolves.toBe('b');
        });
    });

    describe('option sanitization', () => {
        it.each([
            ['NaN', Number.NaN],
            ['positive Infinity', Number.POSITIVE_INFINITY],
            ['negative Infinity', Number.NEGATIVE_INFINITY],
            ['negative number', -5],
        ])('treats %s as concurrency=1', async (_label, value) => {
            const limit = createConcurrencyLimiter({ concurrency: value });
            let active = 0;
            let peak = 0;

            const gates = Array.from({ length: 4 }, () => deferred<void>());

            const runs = gates.map((gate) =>
                limit(async () => {
                    active++;
                    if (active > peak) {
                        peak = active;
                    }
                    await gate.promise;
                    active--;
                }),
            );

            await flush();
            expect(peak).toBe(1);

            for (const gate of gates) {
                gate.resolve();
                await flush();
            }
            await Promise.all(runs);
            expect(peak).toBe(1);
        });
    });
});
