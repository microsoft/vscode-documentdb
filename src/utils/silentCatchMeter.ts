/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

/**
 * Lightweight telemetry meter for empty catch blocks.
 *
 * Records how many times each catch location is hit, then flushes
 * aggregate counts to a single telemetry event. Flushing is throttled
 * by both a hit count threshold AND a minimum time window:
 *
 * - After reaching {@link _FLUSH_THRESHOLD} hits, a flush is attempted.
 * - If fewer than {@link _MIN_FLUSH_INTERVAL_MS} ms have elapsed since
 *   the last flush, the flush is deferred until the next hit that
 *   crosses the *deferred* threshold (doubling each deferral).
 *
 * This prevents bursts of telemetry when a single code path fires
 * thousands of catches per second.
 *
 * Usage:
 *   catch { SilentCatchMeter.hit('feedResultToSchemaStore_ejson'); }
 *
 * KQL example:
 *   customEvents
 *   | where name == "documentDB/silentCatch.stats"
 *   | extend counts = parse_json(tostring(customMeasurements))
 *   | evaluate bag_unpack(counts)
 */
export class SilentCatchMeter {
    private static readonly _counts = new Map<string, number>();
    private static _totalHits = 0;

    /** Base hit count that triggers a flush attempt. */
    private static readonly _FLUSH_THRESHOLD = 20;
    /** Minimum milliseconds between flushes (30 seconds). */
    private static readonly _MIN_FLUSH_INTERVAL_MS = 30_000;

    /** Current threshold — doubles each time a flush is deferred. */
    private static _currentThreshold = SilentCatchMeter._FLUSH_THRESHOLD;
    /** Timestamp of the last successful flush. */
    private static _lastFlushTime = 0;

    /** Record a hit for the given location key. */
    public static hit(locationKey: string): void {
        SilentCatchMeter._counts.set(locationKey, (SilentCatchMeter._counts.get(locationKey) ?? 0) + 1);
        SilentCatchMeter._totalHits++;

        if (SilentCatchMeter._totalHits >= SilentCatchMeter._currentThreshold) {
            const now = Date.now();
            const elapsed = now - SilentCatchMeter._lastFlushTime;

            if (elapsed >= SilentCatchMeter._MIN_FLUSH_INTERVAL_MS) {
                // Enough time has passed — flush and reset threshold
                SilentCatchMeter._currentThreshold = SilentCatchMeter._FLUSH_THRESHOLD;
                SilentCatchMeter._doFlush(now);
            } else {
                // Too soon — double the threshold so we accumulate more before retrying
                SilentCatchMeter._currentThreshold *= 2;
            }
        }
    }

    /** Force-flush accumulated counts to telemetry (e.g., on dispose). */
    public static flush(): void {
        SilentCatchMeter._doFlush(Date.now());
    }

    private static _doFlush(now: number): void {
        if (SilentCatchMeter._counts.size === 0) {
            return;
        }

        const snapshot = new Map(SilentCatchMeter._counts);
        SilentCatchMeter._counts.clear();
        SilentCatchMeter._totalHits = 0;
        SilentCatchMeter._lastFlushTime = now;

        void callWithTelemetryAndErrorHandling('silentCatch.stats', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
            ctx.telemetry.suppressIfSuccessful = false;
            for (const [key, count] of snapshot) {
                ctx.telemetry.measurements[`catch_${key}`] = count;
            }
            ctx.telemetry.measurements.distinctLocations = snapshot.size;
        });
    }
}
