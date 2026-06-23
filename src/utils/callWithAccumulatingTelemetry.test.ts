/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    AUTO_DURATION_DISTRIBUTION_KEY,
    callWithAccumulatingTelemetry,
    flushAccumulatingTelemetry,
    type TelemetryWithDistributions,
} from './callWithAccumulatingTelemetry';

// Each invocation gets a fresh context; we record the measurements snapshot
// after the callback runs so we can inspect what a flush emitted.
const emitted: Array<Record<string, number | undefined>> = [];

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: IActionContext) => unknown) => {
            const ctx = {
                telemetry: { properties: {}, measurements: {}, suppressAll: false },
                errorHandling: { suppressDisplay: false },
            } as unknown as IActionContext;
            try {
                // Mirror the real helper: swallow callback errors and return undefined.
                const result = await callback(ctx);
                // Per-call events set suppressAll; only the flush event actually emits.
                if (!ctx.telemetry.suppressAll) {
                    emitted.push({ ...ctx.telemetry.measurements });
                }
                return result;
            } catch {
                return undefined;
            }
        },
    ),
}));

describe('callWithAccumulatingTelemetry', () => {
    beforeEach(() => {
        emitted.length = 0;
    });

    function findFlush(measurementKey: string): Record<string, number | undefined> | undefined {
        return emitted.find((m) => measurementKey in m);
    }

    it('sums numeric measurements across the batch', async () => {
        const id = 'test.counter';
        for (let i = 0; i < 20; i++) {
            await callWithAccumulatingTelemetry(id, (ctx) => {
                ctx.telemetry.measurements.hits = 1;
            });
        }
        flushAccumulatingTelemetry(id);

        const flush = findFlush('hits');
        expect(flush).toBeDefined();
        expect(flush?.hits).toBe(20);
    });

    it('records caller-provided distribution gauges as min/max/sum/count', async () => {
        const id = 'test.callerGauge';
        for (let i = 0; i < 20; i++) {
            await callWithAccumulatingTelemetry(id, (ctx) => {
                (ctx.telemetry as TelemetryWithDistributions).distributions.candidateCount = i;
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

    it('automatically records per-call duration with no caller bookkeeping', async () => {
        const id = 'test.autoDuration';
        for (let i = 0; i < 20; i++) {
            await callWithAccumulatingTelemetry(id, () => {
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

    it('does not accumulate when the callback throws', async () => {
        const id = 'test.errorsNeverBatch';
        await expect(
            callWithAccumulatingTelemetry(id, () => {
                throw new Error('boom');
            }),
        ).resolves.toBeUndefined();
        flushAccumulatingTelemetry(id);

        const countKey = `dist_${AUTO_DURATION_DISTRIBUTION_KEY}_count`;
        expect(findFlush(countKey)).toBeUndefined();
    });
});
