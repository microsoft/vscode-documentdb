/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Diagnostic tracing for MongoDB Atlas discovery.
 *
 * Discovery fans out across a fleet of credentials, caches snapshots, and mints tokens in the
 * background, so "why is the tree showing this?" is hard to answer from the UI alone. These
 * helpers write a readable, chronological account of that work to the extension output channel.
 *
 * Rules for anything logged here:
 *
 * - **Never log secret material.** No API keys, client secrets, access tokens, or Authorization
 *   headers. Credentials are identified by their user-facing label plus a short record-id prefix.
 * - Log *what happened*, not raw payloads: endpoint path, HTTP status, item counts, durations.
 * - Trace level only, so the output stays silent unless the user opts into verbose logging.
 */

import { ext } from '../../extensionVariables';

const PREFIX = '[Atlas]';

/** Writes a diagnostic line describing discovery activity. */
export function atlasTrace(message: string): void {
    ext.outputChannel.trace(`${PREFIX} ${message}`);
}

/** Writes a diagnostic line for a recoverable problem worth seeing without verbose logging. */
export function atlasWarn(message: string): void {
    ext.outputChannel.warn(`${PREFIX} ${message}`);
}

/** Writes a diagnostic line at error level for a failure worth surfacing without verbose logging. */
export function atlasError(message: string): void {
    ext.outputChannel.error(`${PREFIX} ${message}`);
}

/**
 * Shortens a record ID for log correlation. Record IDs are random UUIDs and carry no secret, but
 * a full UUID on every line makes the log unreadable.
 */
export function shortId(id: string): string {
    return id.slice(0, 8);
}

/**
 * Formats a credential for logs as `label (id-prefix)`. The label itself is user-supplied or an
 * Atlas organization name, never secret material.
 */
export function describeCredential(label: string, credentialId: string): string {
    return `${label} (${shortId(credentialId)})`;
}

/**
 * Reads the monotonic clock, for measuring how long something took.
 *
 * Deliberately not `Date.now()`. The wall clock can step backwards, and it does: an NTP
 * correction, a resume from sleep, or a VM restore all move it. When that lands mid-request the
 * log fills with negative durations, which is worse than useless because it silently discredits
 * every other number on the line. `performance.now()` only ever moves forward.
 *
 * Wall-clock time is still the right choice for anything persisted or compared across processes,
 * such as a Service Account token's `expiresAt`.
 */
export function monotonicNow(): number {
    return performance.now();
}

/** Formats a duration for logs. Pair with {@link monotonicNow}, never with `Date.now()`. */
export function formatMs(startedAt: number): string {
    return `${String(Math.round(monotonicNow() - startedAt))}ms`;
}
