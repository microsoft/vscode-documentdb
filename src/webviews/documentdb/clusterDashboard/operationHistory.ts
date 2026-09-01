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
    /**
     * Identity of one continuous run, stable for its whole life and never reused.
     *
     * `opid` alone is not an identity: servers reissue it the moment an operation finishes.
     * Anything that must still refer to the *same* operation a moment later — a row's React
     * key, an open menu, a pending kill — has to key on this instead.
     */
    occurrenceId: string;
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

/** A live operation with the host's occurrence identity attached. */
export interface IdentifiedOperation extends CurrentOpEntry {
    /** Empty when the server did not identify the operation, which makes it untrackable. */
    occurrenceId: string;
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
    if (entry.opid !== operation.opid || entry.namespace !== operation.namespace) {
        return false;
    }

    // An entry a later poll already retired is finished. Matching it again would resurrect it
    // and fold a new operation's sightings into the dead one's totals.
    if (entry.ended) {
        return false;
    }

    if (nowMs - entry.lastSeenMs > REOCCURRENCE_GAP_MS) {
        return false;
    }

    // Elapsed time only ever grows within one run, so a clock that went backwards means the
    // server reissued this id to a different operation. This is the only signal that
    // distinguishes a recycled id from a continuing one inside the gap window — without it,
    // an operation that ended and was replaced within a minute is indistinguishable from one
    // that never stopped.
    if (
        entry.longestSecsRunning !== null &&
        operation.secsRunning !== null &&
        operation.secsRunning < entry.longestSecsRunning
    ) {
        return false;
    }

    return true;
}

/**
 * Builds the identity of one continuous run.
 *
 * `firstSeenMs` is what makes it unique: a reissued opid is a new occurrence with a new first
 * sighting, so the two never collide even though they share an id and a namespace.
 */
function buildOccurrenceId(opid: string, namespace: string, firstSeenMs: number): string {
    return `${opid}\u0000${namespace}\u0000${firstSeenMs}`;
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
 * @returns The same operations, each stamped with the occurrence identity the history assigned
 *          it. Occurrence identity is decided here because this is the only place that knows
 *          whether an opid is continuing or has just been reissued.
 */
export function recordObservedOperations(
    clusterId: string,
    operations: CurrentOpEntry[],
    nowMs: number,
    pollSucceeded: boolean = true,
): IdentifiedOperation[] {
    // A poll that never reached the server tells us nothing about what stopped.
    if (!pollSucceeded) {
        return operations.map((operation) => ({ ...operation, occurrenceId: '' }));
    }

    // The panel closed while this poll was in flight; its result belongs to a session that no
    // longer exists.
    if (!openSessions.has(clusterId)) {
        return operations.map((operation) => ({ ...operation, occurrenceId: '' }));
    }

    const identified: IdentifiedOperation[] = [];

    const history = historyByCluster.get(clusterId) ?? [];
    const stillRunning = new Set<ObservedOperation>();

    for (const operation of operations) {
        // Operations the server could not identify cannot be tracked across polls: every
        // sighting would look like the same entry, or like a new one, arbitrarily.
        if (operation.opid === '') {
            identified.push({ ...operation, occurrenceId: '' });
            continue;
        }

        const existing = history.find((entry) => isSameOccurrence(entry, operation, nowMs));

        if (existing === undefined) {
            history.push({
                occurrenceId: buildOccurrenceId(operation.opid, operation.namespace, nowMs),
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
            const created = history[history.length - 1];
            stillRunning.add(created);
            identified.push({ ...operation, occurrenceId: created.occurrenceId });
            continue;
        }

        identified.push({ ...operation, occurrenceId: existing.occurrenceId });

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

    return identified;
}

/**
 * Whether the occurrence the user acted on is still the one holding that opid.
 *
 * Read-only: a destructive action must not disturb the record it is consulting.
 */
export function isOccurrenceStillRunning(clusterId: string, occurrenceId: string): boolean {
    const history = historyByCluster.get(clusterId) ?? [];

    return history.some((entry) => entry.occurrenceId === occurrenceId && !entry.ended);
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
