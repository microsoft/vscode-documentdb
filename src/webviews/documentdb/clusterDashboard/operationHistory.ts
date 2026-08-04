/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Short-lived record of the operations a dashboard has *observed*, kept host-side.
 *
 * `currentOp` only ever answers "what is running right now". At a multi-second polling
 * cadence that misses most real traffic — a measured 288 reads and 146 writes over 45 s
 * against a live cluster were never visible as more than four concurrent operations. Every
 * poll's results are folded in here so the Operations tab can also answer "what has run
 * since I opened this", which is the question people actually arrive with.
 *
 * Host-side rather than in the webview so the record survives switching tabs, hiding the
 * panel, and the webview remounting. It is deliberately in-memory and per-session: this is
 * an aid to watching a cluster, not an audit log.
 */

import { type CurrentOpEntry } from '../../../documentdb/utils/getClusterHealth';

/** Maximum operations retained per cluster. Oldest by last sighting are evicted first. */
const MAX_HISTORY_ENTRIES = 200;

/**
 * Gap after which a reappearing opid is treated as a *new* operation rather than the same
 * one continuing.
 *
 * Servers recycle operation ids, so `opid` alone does not identify an operation over time.
 * A gap this long means the earlier operation ended and the id was reissued; merging them
 * would invent one long-running operation out of two short ones.
 */
const REOCCURRENCE_GAP_MS = 60_000;

/** One operation the dashboard saw at least once. */
export interface ObservedOperation {
    opid: string;
    type: string;
    namespace: string;
    /** Already credential-redacted upstream by `buildCommandPreview`. */
    commandPreview: string;
    clientDescription: string | null;
    /** When this dashboard first saw the operation — not when the server started it. */
    firstSeenMs: number;
    lastSeenMs: number;
    /**
     * Largest `secs_running` the server reported for it.
     *
     * Preferred over `lastSeenMs - firstSeenMs`, which only measures how long the *polling*
     * happened to overlap the operation and understates anything that began before the
     * dashboard opened.
     */
    longestSecsRunning: number | null;
    /** How many polls saw it — 1 means it was caught in a single sample. */
    observations: number;
    /** `true` once a later poll no longer reported it. */
    ended: boolean;
}

/** Per-cluster history. Module-level so it outlives any single webview instance. */
const historyByCluster = new Map<string, ObservedOperation[]>();

function isSameOccurrence(entry: ObservedOperation, operation: CurrentOpEntry, nowMs: number): boolean {
    return (
        entry.opid === operation.opid &&
        entry.namespace === operation.namespace &&
        nowMs - entry.lastSeenMs <= REOCCURRENCE_GAP_MS
    );
}

/**
 * Folds one poll's results into a cluster's history.
 *
 * @param clusterId - Stable cluster identifier (never a tree id).
 * @param operations - The operations the poll reported.
 * @param nowMs - Timestamp of the poll, injected so callers and tests share one clock.
 */
export function recordObservedOperations(clusterId: string, operations: CurrentOpEntry[], nowMs: number): void {
    const history = historyByCluster.get(clusterId) ?? [];
    const stillRunning = new Set<ObservedOperation>();

    for (const operation of operations) {
        // Operations the server could not identify cannot be tracked across polls: every
        // sighting would look like the same entry, or like a new one, arbitrarily.
        if (operation.opid === '') {
            continue;
        }

        const existing = history.find((entry) => isSameOccurrence(entry, operation, nowMs));

        if (existing === undefined) {
            history.push({
                opid: operation.opid,
                type: operation.type,
                namespace: operation.namespace,
                commandPreview: operation.commandPreview,
                clientDescription: operation.clientDescription,
                firstSeenMs: nowMs,
                lastSeenMs: nowMs,
                longestSecsRunning: operation.secsRunning,
                observations: 1,
                ended: false,
            });
            stillRunning.add(history[history.length - 1]);
            continue;
        }

        existing.lastSeenMs = nowMs;
        existing.observations += 1;
        existing.ended = false;
        if (operation.secsRunning !== null) {
            existing.longestSecsRunning = Math.max(existing.longestSecsRunning ?? 0, operation.secsRunning);
        }
        // A later poll usually carries a fuller command than the first sighting did.
        if (existing.commandPreview === '' && operation.commandPreview !== '') {
            existing.commandPreview = operation.commandPreview;
        }
        stillRunning.add(existing);
    }

    for (const entry of history) {
        if (!stillRunning.has(entry)) {
            entry.ended = true;
        }
    }

    if (history.length > MAX_HISTORY_ENTRIES) {
        // Evict by last sighting rather than by insertion: a long-running operation seen
        // throughout the session is more interesting than a stale one-off recorded earlier.
        history.sort((left, right) => left.lastSeenMs - right.lastSeenMs);
        history.splice(0, history.length - MAX_HISTORY_ENTRIES);
    }

    historyByCluster.set(clusterId, history);
}

/** Everything observed for a cluster, most recently seen first. */
export function getObservedOperations(clusterId: string): ObservedOperation[] {
    return [...(historyByCluster.get(clusterId) ?? [])].sort((left, right) => right.lastSeenMs - left.lastSeenMs);
}

/** Drops a cluster's history — used by the tab's Clear action. */
export function clearObservedOperations(clusterId: string): void {
    historyByCluster.delete(clusterId);
}
