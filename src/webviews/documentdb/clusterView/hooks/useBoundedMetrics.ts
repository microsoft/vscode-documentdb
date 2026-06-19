/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { type MetricStatus } from '../types';

/** A single row's metric load state, as tracked by {@link useBoundedMetrics}. */
export interface MetricEntry<TMetrics> {
    status: MetricStatus;
    metrics?: TMetrics;
}

/**
 * Loader for a single row's metrics. Receives the row key and an `AbortSignal`
 * that is triggered when the run is superseded (keys changed, reset, or
 * unmount). Should resolve to the metrics, or `null` when the metrics are
 * unavailable (e.g. a stats command is denied or unsupported).
 */
export type MetricLoader<TMetrics> = (key: string, signal: AbortSignal) => Promise<TMetrics | null>;

/**
 * Streams per-row metrics for a list of keys with bounded concurrency.
 *
 * Rows start in the `loading` state and transition to `loaded` (metrics
 * present) or `unavailable` (loader resolved `null` or threw) as results
 * arrive. At most `limit` loaders run at once so a large cluster does not fan
 * out hundreds of simultaneous stats calls.
 *
 * The run restarts whenever the set of keys changes or `resetToken` is bumped
 * (used by the dashboard's Refresh button). A superseded run is aborted via the
 * `AbortSignal` passed to the loader and its late results are ignored.
 *
 * @param keys - Stable row identities (e.g. database or collection names).
 * @param loader - Fetches metrics for one key; kept current via a ref so the
 *                 hook does not restart when the caller passes a new closure.
 * @param limit - Maximum number of concurrent loaders.
 * @param resetToken - Bump to force a full reload of all rows.
 * @returns A map from key to its current {@link MetricEntry}.
 */
export function useBoundedMetrics<TMetrics>(
    keys: ReadonlyArray<string>,
    loader: MetricLoader<TMetrics>,
    limit: number,
    resetToken: number,
): Record<string, MetricEntry<TMetrics>> {
    const [entries, setEntries] = useState<Record<string, MetricEntry<TMetrics>>>({});

    // Keep the latest loader without making it an effect dependency: a new
    // closure each render must not restart the streaming run.
    const loaderRef = useRef(loader);
    useEffect(() => {
        loaderRef.current = loader;
    }, [loader]);

    // A stable signature so the effect only re-runs when the actual set of keys
    // changes, not on every array-identity change.
    const keysSignature = keys.join('\u0000');

    useEffect(() => {
        const abortController = new AbortController();
        const signal = abortController.signal;

        // Seed every row into the loading state for an immediate render.
        const initial: Record<string, MetricEntry<TMetrics>> = {};
        for (const key of keys) {
            initial[key] = { status: 'loading' };
        }
        setEntries(initial);

        let cursor = 0;
        const workerCount = Math.min(limit, keys.length);

        const runWorker = async (): Promise<void> => {
            while (!signal.aborted) {
                const index = cursor;
                cursor += 1;
                if (index >= keys.length) {
                    return;
                }
                const key = keys[index];
                let result: TMetrics | null = null;
                try {
                    result = await loaderRef.current(key, signal);
                } catch {
                    result = null;
                }
                if (signal.aborted) {
                    return;
                }
                setEntries((prev) => ({
                    ...prev,
                    [key]: result === null ? { status: 'unavailable' } : { status: 'loaded', metrics: result },
                }));
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < workerCount; i += 1) {
            workers.push(runWorker());
        }
        void Promise.all(workers);

        return () => {
            abortController.abort();
        };
        // `keys` is intentionally excluded in favour of its stable signature
        // (`keysSignature`) so the streaming run only restarts when the actual
        // set of keys changes, not on every array-identity change.
    }, [keysSignature, limit, resetToken]);

    return entries;
}
