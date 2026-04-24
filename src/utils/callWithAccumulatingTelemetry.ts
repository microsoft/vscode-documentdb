/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';

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
 *
 * Restriction: measurements are summed, so this API is for counters only.
 * For durations, timings, or gauges, use `callWithTelemetryAndErrorHandling`.
 */
export async function callWithAccumulatingTelemetry<T>(
    callbackId: string,
    callback: (context: IActionContext) => T | PromiseLike<T>,
    options?: AccumulatingTelemetryOptions,
): Promise<T | undefined> {
    const state = getOrCreateState(callbackId, options);

    let capturedMeasurements: Record<string, number> | undefined;
    let capturedProperties: Record<string, string> | undefined;

    const result = await callWithTelemetryAndErrorHandling(callbackId, async (ctx) => {
        ctx.errorHandling.suppressDisplay = true;

        // Run the user callback first. If it throws, suppressAll stays false
        // and the error flows through the standard pipeline (errors never batch).
        const value = await callback(ctx);

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

        ctx.telemetry.suppressAll = true;
        return value;
    });

    if (capturedMeasurements || capturedProperties) {
        accumulate(callbackId, state, capturedMeasurements ?? {}, capturedProperties ?? {});
    }

    return result;
}

function accumulate(
    callbackId: string,
    state: AccumulatorState,
    measurements: Record<string, number>,
    properties: Record<string, string>,
): void {
    for (const [k, v] of Object.entries(measurements)) {
        state.measurements[k] = (state.measurements[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(properties)) {
        state.properties[k] = v; // last-wins
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
    if (measurementKeys.length === 0 && propertyKeys.length === 0) {
        return;
    }

    const measurementsSnapshot = state.measurements;
    const propertiesSnapshot = state.properties;
    state.measurements = {};
    state.properties = {};
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
