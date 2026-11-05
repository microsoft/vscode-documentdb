/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';

/** How long the filter must stay unchanged before a use is reported. */
export const FILTER_SETTLE_MS = 1500;

export interface FilterUsageSnapshot {
    /** True while any filter narrows the list. */
    readonly active: boolean;
    /** Identifies the list being filtered. A change ends the current use and starts a new one. */
    readonly scope: string;
    /** Never the filter text: names typed into a filter are user data. */
    readonly properties: Record<string, string>;
    readonly measurements: Record<string, number>;
}

/**
 * Reports each use of a list filter once.
 *
 * A use begins when the filter starts narrowing the list and ends when it is cleared or the
 * list changes. It is reported when the input has been still for {@link FILTER_SETTLE_MS},
 * so the counts describe what the reader settled on rather than every keystroke. A use that
 * ends before it settles (typing and immediately opening a match, which clears the filter) is
 * reported as it ends, with its last state.
 */
export function useFilterUsageReporter(
    snapshot: FilterUsageSnapshot,
    report: (properties: Record<string, string>, measurements: Record<string, number>) => void,
): void {
    const latest = useRef<FilterUsageSnapshot | undefined>(undefined);
    const pending = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const scope = useRef(snapshot.scope);
    const reportRef = useRef(report);
    useEffect(() => {
        reportRef.current = report;
    });

    const flush = (): void => {
        if (timer.current !== undefined) {
            clearTimeout(timer.current);
            timer.current = undefined;
        }
        if (pending.current && latest.current) {
            reportRef.current(latest.current.properties, latest.current.measurements);
        }
        pending.current = false;
    };

    const signature = JSON.stringify([snapshot.active, snapshot.scope, snapshot.properties, snapshot.measurements]);

    useEffect(() => {
        if (snapshot.scope !== scope.current) {
            flush();
            latest.current = undefined;
            scope.current = snapshot.scope;
        }

        if (!snapshot.active) {
            flush();
            latest.current = undefined;
            return;
        }

        // Once settled, refining the same filter is not a new use.
        if (latest.current !== undefined && !pending.current) {
            return;
        }

        latest.current = snapshot;
        pending.current = true;
        if (timer.current !== undefined) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => {
            timer.current = undefined;
            flush();
        }, FILTER_SETTLE_MS);
        // The signature captures every snapshot field; the snapshot object itself is new on every render.
    }, [signature]);

    useEffect(() => flush, []);
}
