/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Recognises MongoDB Atlas connection failures that the raw driver error describes badly.
 */

/**
 * Matches the TLS handshake rejection Atlas produces for a client that is not on the project's
 * IP access list.
 *
 * Atlas fronts its clusters with a proxy that decides whether to continue the TLS handshake based
 * on the caller's IP. A caller that is not on the access list gets the handshake torn down with
 * `internal_error` (alert 80), which OpenSSL reports as
 * `ssl3_read_bytes:tlsv1 alert internal error ... SSL alert number 80`.
 *
 * The important consequence for the UX: this happens **before** authentication, so the message the
 * user sees has nothing to do with the username and password they just typed. Left untranslated it
 * sends people to re-check credentials that were never even presented.
 */
const ATLAS_TLS_REJECTION_PATTERN = /SSL alert number 80|tlsv1 alert internal error|ssl3_read_bytes/i;

/** True when the failure looks like the Atlas proxy refusing the TLS handshake. */
export function isAtlasTlsHandshakeRejection(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return ATLAS_TLS_REJECTION_PATTERN.test(message);
}
