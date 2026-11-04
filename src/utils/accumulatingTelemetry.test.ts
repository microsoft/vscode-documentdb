/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    AUTO_DURATION_DISTRIBUTION_KEY,
    INITIAL_BATCH_SIZE,
    MAX_BATCH_SIZE,
    accumulateTelemetry,
    flushAccumulatedTelemetry,
    type TelemetrySample,
} from './accumulatingTelemetry';

// Records the measurements snapshot each time the telemetry pipeline is entered
// (which, after the R766-P05 redesign, happens only on flush and on the rare
// populator-error path) so tests can inspect what a flush emitted.
const emitted: Array<Record<string, number | undefined>> = [];

// The mock runs the callback synchronously so the emitted snapshot is available
// immediately after a synchronous `flushAccumulatedTelemetry(...)` call (no
// microtask hop). The real helper's flush callback is synchronous, so this is a
// faithful stand-in.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn((_eventName: string, callback: (context: IActionContext) => unknown) => {
        const ctx = {
            telemetry: { properties: {}, measurements: {}, suppressAll: false },
            errorHandling: { suppressDisplay: false },
        } as unknown as IActionContext;
        try {
            const result = callback(ctx);
            emitted.push({ ...ctx.telemetry.measurements });
            return Promise.resolve(result);
        } catch {
            // Mirror the real helper: errors are caught/reported, not rethrown,
            // and nothing is emitted for a throwing callback.
            return Promise.resolve(undefined);
        }
    }),
}));

const mockCallWith = callWithTelemetryAndErrorHandling as Mock;

/**
 * Accumulates with a fixed batch size far above what any test reaches, so tests about how a
 * batch is folded (sums, distributions, errors) are not affected by the growing batch size.
 */
function accumulateFixed(id: string, populate: (sample: TelemetrySample) => void): void {
    accumulateTelemetry(id, populate, { batchSize: 1_000 });
}

describe('accumulateTelemetry', () => {
    beforeEach(() => {
        emitted.length = 0;
        // Clears recorded calls between tests but keeps the mock implementation.
        vi.clearAllMocks();
    });

    function findFlush(measurementKey: string): Record<string, number | undefined> | undefined {
        return emitted.find((m) => measurementKey in m);
    }

    it('sums numeric measurements across the batch', () => {
        const id = 'test.counter';
        for (let i = 0; i < 20; i++) {
            accumulateFixed(id, (sample) => {
                sample.measurements.hits = 1;
            });
        }
        flushAccumulatedTelemetry(id);

        const flush = findFlush('hits');
        expect(flush).toBeDefined();
        expect(flush?.hits).toBe(20);
    });

    it('records caller-provided distribution gauges as min/max/sum/count', () => {
        const id = 'test.callerGauge';
        for (let i = 0; i < 20; i++) {
            accumulateFixed(id, (sample) => {
                sample.distributions.candidateCount = i;
            });
        }
        flushAccumulatedTelemetry(id);

        const flush = findFlush('dist_candidateCount_count');
        expect(flush).toBeDefined();
        expect(flush?.dist_candidateCount_min).toBe(0);
        expect(flush?.dist_candidateCount_max).toBe(19);
        expect(flush?.dist_candidateCount_sum).toBe(190);
        expect(flush?.dist_candidateCount_count).toBe(20);
    });

    it('automatically records per-call duration with no caller bookkeeping', () => {
        const id = 'test.autoDuration';
        for (let i = 0; i < 20; i++) {
            accumulateFixed(id, () => {
                // Caller records nothing; duration must still be captured.
            });
        }
        flushAccumulatedTelemetry(id);

        const countKey = `dist_${AUTO_DURATION_DISTRIBUTION_KEY}_count`;
        const flush = findFlush(countKey);
        expect(flush).toBeDefined();
        expect(flush?.[countKey]).toBe(20);
        // Duration values are non-negative wall-clock measurements.
        expect(flush?.[`dist_${AUTO_DURATION_DISTRIBUTION_KEY}_min`]).toBeGreaterThanOrEqual(0);
        expect(flush?.[`dist_${AUTO_DURATION_DISTRIBUTION_KEY}_sum`]).toBeGreaterThanOrEqual(0);
    });

    it('skips non-finite numbers so a stray NaN/Infinity cannot poison the batch', () => {
        const id = 'test.finiteGuard';
        for (let i = 0; i < 20; i++) {
            accumulateFixed(id, (sample) => {
                sample.measurements.hits = i === 0 ? Number.NaN : 1; // one bad value
                sample.distributions.gauge = i === 1 ? Number.POSITIVE_INFINITY : 5;
            });
        }
        flushAccumulatedTelemetry(id);

        const flush = findFlush('hits');
        expect(flush).toBeDefined();
        // 19 finite `1`s summed; the NaN call is skipped, not added.
        expect(flush?.hits).toBe(19);
        // 19 finite `5`s recorded; the Infinity sample is skipped.
        expect(flush?.dist_gauge_count).toBe(19);
        expect(flush?.dist_gauge_max).toBe(5);
    });

    it('does not enter the telemetry pipeline on the per-call path — only on flush (R766-P05)', () => {
        const id = 'test.cheapPath';
        // Stay below the default batch size so no auto-flush fires.
        for (let i = 0; i < 5; i++) {
            accumulateFixed(id, (sample) => {
                sample.measurements.hits = 1;
            });
        }
        // The whole point of the redesign: the accumulate path is pure in-memory
        // work and never opens a telemetry/error scope.
        expect(mockCallWith).not.toHaveBeenCalled();

        flushAccumulatedTelemetry(id);

        // The heavy wrapper is entered exactly once, on flush.
        expect(mockCallWith).toHaveBeenCalledTimes(1);
    });

    it('does not accumulate when the populator throws, and reports the error once', () => {
        const id = 'test.errorsNeverBatch';
        accumulateFixed(id, () => {
            throw new Error('boom');
        });

        // The throw is reported once through the standard pipeline, under the
        // same event id, without accumulating anything.
        expect(mockCallWith).toHaveBeenCalledTimes(1);
        expect(mockCallWith.mock.calls[0][0]).toBe(id);

        flushAccumulatedTelemetry(id);
        const countKey = `dist_${AUTO_DURATION_DISTRIBUTION_KEY}_count`;
        expect(findFlush(countKey)).toBeUndefined();
    });

    describe('growing batch size (default)', () => {
        const count = (sample: TelemetrySample): void => {
            sample.measurements.hits = 1;
        };

        it('flushes after 1, 2, 4, 8, 16 calls and then every 32', () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(1_000_000);
                const id = 'test.growing';
                // 1 + 2 + 4 + 8 + 16 = 31 calls fill the growing batches.
                for (let i = 0; i < 31; i++) {
                    accumulateTelemetry(id, count);
                }
                // At the cap the interval applies; let it pass so the next 32 calls flush as one batch.
                vi.advanceTimersByTime(30_000);
                for (let i = 0; i < 32; i++) {
                    accumulateTelemetry(id, count);
                }

                expect(emitted.map((m) => m.hits)).toEqual([1, 2, 4, 8, 16, 32]);
                expect(INITIAL_BATCH_SIZE).toBe(1);
                expect(MAX_BATCH_SIZE).toBe(32);
            } finally {
                vi.useRealTimers();
            }
        });

        it('reports the very first call at once, so a single use is never lost', () => {
            accumulateTelemetry('test.firstUse', count);

            expect(emitted).toEqual([expect.objectContaining({ hits: 1 })]);
        });

        it('throttles by minFlushIntervalMs only once the size has reached the cap', () => {
            vi.useFakeTimers();
            try {
                vi.setSystemTime(1_000_000);
                const id = 'test.throttleAtCap';
                // All growing batches flush back to back, without waiting for the interval.
                for (let i = 0; i < 31; i++) {
                    accumulateTelemetry(id, count);
                }
                expect(emitted).toHaveLength(5);

                // The first capped batch is full, but the interval since the last flush has not passed.
                for (let i = 0; i < 32; i++) {
                    accumulateTelemetry(id, count);
                }
                expect(emitted).toHaveLength(5);

                vi.advanceTimersByTime(30_000);
                accumulateTelemetry(id, count);
                expect(emitted).toHaveLength(6);
                expect(emitted[5].hits).toBe(33);
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps a fixed size when batchSize is passed', () => {
            const id = 'test.fixedSize';
            for (let i = 0; i < 4; i++) {
                accumulateTelemetry(id, count, { batchSize: 5 });
            }
            expect(emitted).toHaveLength(0);

            accumulateTelemetry(id, count, { batchSize: 5 });
            expect(emitted.map((m) => m.hits)).toEqual([5]);
        });

        it('does not grow on an explicit flush', () => {
            const id = 'test.explicitFlush';
            accumulateTelemetry(id, count); // size 1: flushes, size becomes 2
            accumulateTelemetry(id, count);
            flushAccumulatedTelemetry(id); // explicit: size stays 2
            accumulateTelemetry(id, count);
            accumulateTelemetry(id, count); // fills the batch of 2

            expect(emitted.map((m) => m.hits)).toEqual([1, 1, 2]);
        });
    });
});
