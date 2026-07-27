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

/** Formats a duration for logs. */
export function formatMs(startedAt: number): string {
    return `${String(Date.now() - startedAt)}ms`;
}
