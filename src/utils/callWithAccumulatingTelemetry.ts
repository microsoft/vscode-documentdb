/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';

/**
 * Bag attached to `ctx.telemetry.distributions` during an accumulating
 * telemetry callback. Each key records a numeric value that will be reduced
 * to min / max / sum / count across the batch.
 *
 * ```ts
 * callWithAccumulatingTelemetry('myEvent', (ctx) => {
 *     const t = ctx.telemetry as TelemetryWithDistributions;
 *     t.distributions.candidateCount = candidates.length;
 * });
 * ```
 */
export type TelemetryWithDistributions = IActionContext['telemetry'] & {
    distributions: Record<string, number>;
};

/**
 * Accumulated stats for a single distribution key across a batch.
 */
interface DistributionAccumulator {
    min: number;
    max: number;
    sum: number;
    count: number;
}

/**
 * Reserved distribution key under which every successful call automatically
 * records its own wall-clock duration (in milliseconds). This is collected by
 * the wrapper itself, so every call site gets latency min / max / sum / count
 * for free without any caller bookkeeping. On flush it surfaces as
 * `dist_auto_duration_ms_min`, `_max`, `_sum`, `_count`.
 */
export const AUTO_DURATION_DISTRIBUTION_KEY = 'auto_duration_ms';

/**
 * Options controlling how `callWithAccumulatingTelemetry` batches events.
 */
export interface AccumulatingTelemetryOptions {
    /**
     * How many accumulated calls trigger a flush attempt.
     *
     * @default 20
     */
    batchSize?: number;

    /**
     * Minimum ms between flushes. If `batchSize` is hit sooner, we keep
     * accumulating and retry on the next call.
     *
     * @default 30_000
     */
    minFlushIntervalMs?: number;
}

interface AccumulatorState {
    batchSize: number;
    minFlushIntervalMs: number;
    sinceLastFlush: number;
    lastFlushTime: number;
    measurements: Record<string, number>;
    properties: Record<string, string>;
    distributions: Record<string, DistributionAccumulator>;
}

const accumulators = new Map<string, AccumulatorState>();

function getOrCreateState(callbackId: string, options: AccumulatingTelemetryOptions | undefined): AccumulatorState {
    let state = accumulators.get(callbackId);
    if (!state) {
        state = {
            batchSize: options?.batchSize ?? 20,
            minFlushIntervalMs: options?.minFlushIntervalMs ?? 30_000,
            sinceLastFlush: 0,
            lastFlushTime: 0,
            measurements: {},
            properties: {},
            distributions: {},
        };
        accumulators.set(callbackId, state);
    }
    return state;
}

/**
 * Like `callWithTelemetryAndErrorHandling`, but accumulates successful events
 * under the same `callbackId` and flushes them as a single telemetry event.
 *
 * Mental model: each call contributes to a running total.
 * - Numeric values on `context.telemetry.measurements` are **summed** across
 *   calls. Use this for counters (`measurements.myCounter = 1`).
 * - Numeric values on `context.telemetry.distributions` are tracked as
 *   **distribution metrics** (min / max / sum / count) across the batch.
 *   Use this for gauges like candidate counts, latencies, or sizes.
 *   On flush each key is emitted as four measurement fields:
 *   `dist_{key}_min`, `dist_{key}_max`, `dist_{key}_sum`, `dist_{key}_count`.
 * - Every successful call automatically contributes its own wall-clock
 *   duration to the `auto_duration_ms` distribution, with no caller code.
 *   This surfaces as `dist_auto_duration_ms_min/max/sum/count` on flush,
 *   giving per-event latency for free at every call site.
 * - String values on `context.telemetry.properties` are **last-wins**
 *   (overwritten on each call). Use this for stable metadata only
 *   (e.g., session id, version). Do NOT use properties to bucket data —
 *   encode the bucket into a measurement key instead:
 *     `ctx.telemetry.measurements[`cat_${category}`] = 1`
 *
 * Behavior:
 * - Flushes every `batchSize` calls with a `minFlushIntervalMs` throttle.
 * - Flushed event name is exactly `callbackId` (same as the non-accumulating
 *   variant — no `.batch` suffix, no schema split).
 * - Errors NEVER accumulate: if the callback throws, the error flows through
 *   the standard `callWithTelemetryAndErrorHandling` pipeline and the
 *   accumulator state is untouched.
 * - The callback's return value passes through.
 */
export async function callWithAccumulatingTelemetry<T>(
    callbackId: string,
    callback: (context: IActionContext) => T | PromiseLike<T>,
    options?: AccumulatingTelemetryOptions,
): Promise<T | undefined> {
    const state = getOrCreateState(callbackId, options);

    let capturedMeasurements: Record<string, number> | undefined;
    let capturedProperties: Record<string, string> | undefined;
    let capturedDistributions: Record<string, number> | undefined;

    const result = await callWithTelemetryAndErrorHandling(callbackId, async (ctx) => {
        ctx.errorHandling.suppressDisplay = true;

        // Attach the distributions bag to ctx.telemetry so callers can write
        // gauges that will be reduced across the batch.
        (ctx.telemetry as TelemetryWithDistributions).distributions = {};

        // Run the user callback first. If it throws, suppressAll stays false
        // and the error flows through the standard pipeline (errors never batch).
        // Time the call so we can record its duration automatically below.
        const startTime = performance.now();
        const value = await callback(ctx);
        const durationMs = performance.now() - startTime;

        // Success path: capture measurements/properties and suppress per-call emit.
        const m: Record<string, number> = {};
        for (const [k, v] of Object.entries(ctx.telemetry.measurements)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
                m[k] = v;
            }
        }
        capturedMeasurements = m;

        const p: Record<string, string> = {};
        for (const [k, v] of Object.entries(ctx.telemetry.properties)) {
            if (typeof v === 'string') {
                p[k] = v;
            }
        }
        capturedProperties = p;

        const d: Record<string, number> = {};
        const dist = (ctx.telemetry as TelemetryWithDistributions).distributions;
        if (dist && typeof dist === 'object') {
            for (const [k, v] of Object.entries(dist)) {
                if (typeof v === 'number' && Number.isFinite(v)) {
                    d[k] = v;
                }
            }
        }
        // Always record the call's own duration as a distribution. A caller
        // value under the reserved key (if any) does not override this; the
        // wrapper's measured duration wins.
        if (Number.isFinite(durationMs)) {
            d[AUTO_DURATION_DISTRIBUTION_KEY] = durationMs;
        }
        capturedDistributions = Object.keys(d).length ? d : undefined;

        ctx.telemetry.suppressAll = true;
        return value;
    });

    if (capturedMeasurements || capturedProperties || capturedDistributions) {
        accumulate(callbackId, state, capturedMeasurements ?? {}, capturedProperties ?? {}, capturedDistributions);
    }

    return result;
}

function accumulate(
    callbackId: string,
    state: AccumulatorState,
    measurements: Record<string, number>,
    properties: Record<string, string>,
    distributions?: Record<string, number>,
): void {
    for (const [k, v] of Object.entries(measurements)) {
        state.measurements[k] = (state.measurements[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(properties)) {
        state.properties[k] = v; // last-wins
    }
    if (distributions) {
        for (const [k, v] of Object.entries(distributions)) {
            const acc = state.distributions[k];
            if (acc) {
                acc.min = Math.min(acc.min, v);
                acc.max = Math.max(acc.max, v);
                acc.sum += v;
                acc.count++;
            } else {
                state.distributions[k] = { min: v, max: v, sum: v, count: 1 };
            }
        }
    }
    state.sinceLastFlush++;

    if (state.sinceLastFlush >= state.batchSize) {
        const now = Date.now();
        if (now - state.lastFlushTime >= state.minFlushIntervalMs) {
            flushState(callbackId, state, now);
        }
        // Otherwise keep accumulating; the next call will re-check.
    }
}

function flushState(callbackId: string, state: AccumulatorState, now: number): void {
    const measurementKeys = Object.keys(state.measurements);
    const propertyKeys = Object.keys(state.properties);
    const distributionKeys = Object.keys(state.distributions);
    if (measurementKeys.length === 0 && propertyKeys.length === 0 && distributionKeys.length === 0) {
        return;
    }

    const measurementsSnapshot = state.measurements;
    const propertiesSnapshot = state.properties;
    const distributionsSnapshot = state.distributions;
    state.measurements = {};
    state.properties = {};
    state.distributions = {};
    state.sinceLastFlush = 0;
    state.lastFlushTime = now;

    void callWithTelemetryAndErrorHandling(callbackId, (ctx) => {
        ctx.errorHandling.suppressDisplay = true;
        for (const [k, v] of Object.entries(measurementsSnapshot)) {
            ctx.telemetry.measurements[k] = v;
        }
        for (const [k, v] of Object.entries(propertiesSnapshot)) {
            ctx.telemetry.properties[k] = v;
        }
        for (const [k, v] of Object.entries(distributionsSnapshot)) {
            ctx.telemetry.measurements[`dist_${k}_min`] = v.min;
            ctx.telemetry.measurements[`dist_${k}_max`] = v.max;
            ctx.telemetry.measurements[`dist_${k}_sum`] = v.sum;
            ctx.telemetry.measurements[`dist_${k}_count`] = v.count;
        }
    });
}

/**
 * Force-flush accumulated totals to telemetry. Pass a specific `callbackId`
 * to flush just that accumulator, or omit it to flush all registered ones
 * (e.g., on extension deactivation).
 */
export function flushAccumulatingTelemetry(callbackId?: string): void {
    const now = Date.now();
    if (callbackId !== undefined) {
        const state = accumulators.get(callbackId);
        if (state) {
            flushState(callbackId, state, now);
        }
        return;
    }
    for (const [id, state] of accumulators) {
        flushState(id, state, now);
    }
}

/**
 * Shorthand for silent-catch metering.
 *
 * Counts a hit under the shared event `silentCatch`, keyed by
 * `accumulated_<locationKey>`. The `accumulated_` prefix prevents collision
 * with framework-injected measurement names (e.g. `duration`) and keeps the
 * discovery query clean:
 *
 * ```kql
 * customEvents
 * | where name == "documentDB/silentCatch"
 * | mv-expand m = customMeasurements
 * | where tostring(m.key) startswith "accumulated_"
 * | summarize sum(todouble(m.value)) by tostring(m.key)
 * ```
 *
 * Usage:
 * ```ts
 * catch {
 *     meterSilentCatch('feedResultToSchemaStore_ejson');
 * }
 * ```
 */
export function meterSilentCatch(locationKey: string): void {
    void callWithAccumulatingTelemetry('silentCatch', (ctx) => {
        ctx.telemetry.measurements[`accumulated_${locationKey}`] = 1;
    });
}
