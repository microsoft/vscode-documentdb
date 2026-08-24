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

/**
 * Clusters with a dashboard panel currently open.
 *
 * The history is a module-level store but a *session*-scoped fact ("what has run since I opened
 * this"). Disposal clears the map, yet a poll already in flight when the panel closed resolves
 * afterwards and would write the entry straight back — leaving up to `MAX_HISTORY_ENTRIES`
 * command previews retained for the lifetime of the extension host, and presenting them to the
 * next session as its own. Recording is therefore gated on the session still being open.
 */
const openSessions = new Set<string>();

/** Marks a cluster's dashboard session as open, so polls may record into its history. */
export function beginObservedOperationsSession(clusterId: string): void {
    openSessions.add(clusterId);
}

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
 * @param pollSucceeded - Whether the poll actually reached the server. A failed poll reports no
 *        operations, which is not the same fact as "nothing is running": recording it would mark
 *        every entry ended. Defaults to `true` so an explicit empty poll still ends entries.
 */
export function recordObservedOperations(
    clusterId: string,
    operations: CurrentOpEntry[],
    nowMs: number,
    pollSucceeded: boolean = true,
): void {
    // A poll that never reached the server tells us nothing about what stopped.
    if (!pollSucceeded) {
        return;
    }

    // The panel closed while this poll was in flight; its result belongs to a session that no
    // longer exists.
    if (!openSessions.has(clusterId)) {
        return;
    }

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

/**
 * Ends a cluster's dashboard session and drops its history.
 *
 * Distinct from {@link clearObservedOperations}, which is the tab's Clear action and leaves the
 * session open to keep recording. This is disposal: after it, a poll still in flight cannot
 * resurrect the entry.
 */
export function endObservedOperationsSession(clusterId: string): void {
    openSessions.delete(clusterId);
    historyByCluster.delete(clusterId);
}
