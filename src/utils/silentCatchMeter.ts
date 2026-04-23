/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

/**
 * Lightweight telemetry meter for empty catch blocks.
 *
 * Records how many times each catch location is hit, then flushes
 * aggregate counts to a single telemetry event periodically.
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
    private static readonly _FLUSH_THRESHOLD = 20;

    /** Record a hit for the given location key. */
    public static hit(locationKey: string): void {
        SilentCatchMeter._counts.set(locationKey, (SilentCatchMeter._counts.get(locationKey) ?? 0) + 1);
        SilentCatchMeter._totalHits++;

        if (SilentCatchMeter._totalHits >= SilentCatchMeter._FLUSH_THRESHOLD) {
            SilentCatchMeter.flush();
        }
    }

    /** Flush accumulated counts to telemetry. */
    public static flush(): void {
        if (SilentCatchMeter._counts.size === 0) {
            return;
        }

        const snapshot = new Map(SilentCatchMeter._counts);
        SilentCatchMeter._counts.clear();
        SilentCatchMeter._totalHits = 0;

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
