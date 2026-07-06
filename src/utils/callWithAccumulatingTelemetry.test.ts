/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    AUTO_DURATION_DISTRIBUTION_KEY,
    callWithAccumulatingTelemetry,
    flushAccumulatingTelemetry,
} from './callWithAccumulatingTelemetry';

// Records the measurements snapshot each time the telemetry pipeline is entered
// (which, after the R766-P05 redesign, happens only on flush and on the rare
// populator-error path) so tests can inspect what a flush emitted.
const emitted: Array<Record<string, number | undefined>> = [];

// The mock runs the callback synchronously so the emitted snapshot is available
// immediately after a synchronous `flushAccumulatingTelemetry(...)` call (no
// microtask hop). The real helper's flush callback is synchronous, so this is a
// faithful stand-in.
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn((_eventName: string, callback: (context: IActionContext) => unknown) => {
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

const mockCallWith = callWithTelemetryAndErrorHandling as jest.Mock;

describe('callWithAccumulatingTelemetry', () => {
    beforeEach(() => {
        emitted.length = 0;
        // Clears recorded calls between tests but keeps the mock implementation.
        jest.clearAllMocks();
    });

    function findFlush(measurementKey: string): Record<string, number | undefined> | undefined {
        return emitted.find((m) => measurementKey in m);
    }

    it('sums numeric measurements across the batch', () => {
        const id = 'test.counter';
        for (let i = 0; i < 20; i++) {
            callWithAccumulatingTelemetry(id, (sample) => {
                sample.measurements.hits = 1;
            });
        }
        flushAccumulatingTelemetry(id);

        const flush = findFlush('hits');
        expect(flush).toBeDefined();
        expect(flush?.hits).toBe(20);
    });

    it('records caller-provided distribution gauges as min/max/sum/count', () => {
        const id = 'test.callerGauge';
        for (let i = 0; i < 20; i++) {
            callWithAccumulatingTelemetry(id, (sample) => {
                sample.distributions.candidateCount = i;
            });
        }
        flushAccumulatingTelemetry(id);

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
            callWithAccumulatingTelemetry(id, () => {
                // Caller records nothing; duration must still be captured.
            });
        }
        flushAccumulatingTelemetry(id);

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
            callWithAccumulatingTelemetry(id, (sample) => {
                sample.measurements.hits = i === 0 ? Number.NaN : 1; // one bad value
                sample.distributions.gauge = i === 1 ? Number.POSITIVE_INFINITY : 5;
            });
        }
        flushAccumulatingTelemetry(id);

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
            callWithAccumulatingTelemetry(id, (sample) => {
                sample.measurements.hits = 1;
            });
        }
        // The whole point of the redesign: the accumulate path is pure in-memory
        // work and never opens a telemetry/error scope.
        expect(mockCallWith).not.toHaveBeenCalled();

        flushAccumulatingTelemetry(id);

        // The heavy wrapper is entered exactly once, on flush.
        expect(mockCallWith).toHaveBeenCalledTimes(1);
    });

    it('does not accumulate when the populator throws, and reports the error once', () => {
        const id = 'test.errorsNeverBatch';
        callWithAccumulatingTelemetry(id, () => {
            throw new Error('boom');
        });

        // The throw is reported once through the standard pipeline, under the
        // same event id, without accumulating anything.
        expect(mockCallWith).toHaveBeenCalledTimes(1);
        expect(mockCallWith.mock.calls[0][0]).toBe(id);

        flushAccumulatingTelemetry(id);
        const countKey = `dist_${AUTO_DURATION_DISTRIBUTION_KEY}_count`;
        expect(findFlush(countKey)).toBeUndefined();
    });
});
