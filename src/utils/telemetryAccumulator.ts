/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

/**
 * Accumulating telemetry counter for high-frequency events.
 *
 * Sends the first {@link _immediateCount} events individually (so dashboards
 * see the feature is alive immediately), then switches to batch mode:
 * accumulates counts keyed by a caller-supplied dimension string and
 * flushes them as measurements on a single telemetry event every
 * {@link _batchSize} hits (with 30 s minimum interval between flushes).
 *
 * Usage:
 * ```ts
 * const completionCounter = new TelemetryAccumulator('completion.accepted');
 * // Each call either sends immediately or accumulates:
 * completionCounter.record({ category: 'operator', source: 'playground' });
 * ```
 *
 * KQL:
 * ```
 * customEvents
 * | where name contains "completion.accepted"
 * | extend counts = parse_json(tostring(customMeasurements))
 * | evaluate bag_unpack(counts)
 * ```
 */
export class TelemetryAccumulator {
    private readonly _eventName: string;

    /** How many events to send individually before switching to batch mode. */
    private readonly _immediateCount: number;
    /** How many accumulated hits trigger a batch flush. */
    private readonly _batchSize: number;
    /** Minimum milliseconds between batch flushes. */
    private readonly _minFlushIntervalMs: number;

    private _totalCalls = 0;
    private _sinceLastFlush = 0;
    private _lastFlushTime = 0;
    private readonly _counts = new Map<string, number>();

    constructor(
        eventName: string,
        options?: {
            /** Events sent individually before batching (default: 5). */
            immediateCount?: number;
            /** Accumulated hits per batch flush (default: 20). */
            batchSize?: number;
            /** Minimum ms between flushes (default: 30 000). */
            minFlushIntervalMs?: number;
        },
    ) {
        this._eventName = eventName;
        this._immediateCount = options?.immediateCount ?? 5;
        this._batchSize = options?.batchSize ?? 20;
        this._minFlushIntervalMs = options?.minFlushIntervalMs ?? 30_000;
    }

    /**
     * Record one occurrence. Properties are flattened into a dimension key
     * (e.g., `"operator|playground"`) for batch aggregation.
     */
    record(properties: Record<string, string>): void {
        this._totalCalls++;

        if (this._totalCalls <= this._immediateCount) {
            // Early phase: send individually so dashboards light up fast
            void callWithTelemetryAndErrorHandling(this._eventName, (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                for (const [key, value] of Object.entries(properties)) {
                    ctx.telemetry.properties[key] = value;
                }
                ctx.telemetry.measurements.totalCalls = this._totalCalls;
                ctx.telemetry.properties.mode = 'immediate';
            });
            return;
        }

        // Batch phase: accumulate by dimension key
        const dimensionKey = Object.values(properties).join('|');
        this._counts.set(dimensionKey, (this._counts.get(dimensionKey) ?? 0) + 1);
        this._sinceLastFlush++;

        if (this._sinceLastFlush >= this._batchSize) {
            const now = Date.now();
            if (now - this._lastFlushTime >= this._minFlushIntervalMs) {
                this._flush(now, properties);
            }
            // If too soon, just keep accumulating — next batch threshold will retry
        }
    }

    /** Force-flush accumulated counts (e.g., on dispose). */
    flush(): void {
        if (this._counts.size > 0) {
            this._flush(Date.now());
        }
    }

    private _flush(now: number, lastProperties?: Record<string, string>): void {
        const snapshot = new Map(this._counts);
        this._counts.clear();
        this._sinceLastFlush = 0;
        this._lastFlushTime = now;

        void callWithTelemetryAndErrorHandling(`${this._eventName}.batch`, (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.telemetry.properties.mode = 'batch';
            ctx.telemetry.measurements.totalCalls = this._totalCalls;
            ctx.telemetry.measurements.batchedEvents = [...snapshot.values()].reduce((a, b) => a + b, 0);
            ctx.telemetry.measurements.distinctDimensions = snapshot.size;

            for (const [key, count] of snapshot) {
                ctx.telemetry.measurements[`dim_${key}`] = count;
            }

            // Include the property keys from the last call for schema discovery
            if (lastProperties) {
                for (const [key, value] of Object.entries(lastProperties)) {
                    ctx.telemetry.properties[`last_${key}`] = value;
                }
            }
        });
    }
}
