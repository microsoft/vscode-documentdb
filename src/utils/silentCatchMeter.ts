/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryAccumulator } from './telemetryAccumulator';

/**
 * Lightweight telemetry meter for empty catch blocks.
 *
 * Thin wrapper over {@link TelemetryAccumulator} configured for silent-catch
 * telemetry: no immediate events (catches are noisy), batch-only with a
 * threshold of 20 hits and 30 s minimum interval.
 *
 * Usage:
 *   catch { SilentCatchMeter.hit('feedResultToSchemaStore_ejson'); }
 *
 * KQL example:
 *   customEvents
 *   | where name contains "silentCatch"
 *   | extend counts = parse_json(tostring(customMeasurements))
 *   | evaluate bag_unpack(counts)
 */
export class SilentCatchMeter {
    private static readonly _accumulator = new TelemetryAccumulator('silentCatch', {
        immediateCount: 0, // never send individual catch events
        batchSize: 20,
        minFlushIntervalMs: 30_000,
    });

    /** Record a hit for the given location key. */
    public static hit(locationKey: string): void {
        SilentCatchMeter._accumulator.record({ location: locationKey });
    }

    /** Force-flush accumulated counts to telemetry (e.g., on dispose). */
    public static flush(): void {
        SilentCatchMeter._accumulator.flush();
    }
}
