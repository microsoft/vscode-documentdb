/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Recognises MongoDB Atlas connection failures that the raw driver error describes badly.
 */

/**
 * Matches a TLS-level failure reported by OpenSSL, of which `internal_error` (alert 80) is the
 * one seen against Atlas:
 * `ssl3_read_bytes:tlsv1 alert internal error ... SSL alert number 80`.
 *
 * What this justifies saying, and nothing more: the connection died at the transport layer. That
 * is not the shape of an authentication rejection, which the driver surfaces as
 * `bad auth : Authentication failed`. So the username and password are not the obvious suspect,
 * even though the failure appears immediately after the user typed them.
 *
 * What this deliberately does **not** claim is a cause. MongoDB documents that the project IP
 * access list gates client connections to a cluster, and that a blocked address fails an
 * end-to-end connectivity test on port 27017, but it nowhere documents that a blocked address
 * surfaces as this particular alert. Other candidates (a paused or provisioning cluster, a TLS
 * version or cipher mismatch) are equally undocumented for this signature. The UX therefore lists
 * what to check rather than asserting a diagnosis that cannot be supported.
 */
const ATLAS_TLS_FAILURE_PATTERN = /SSL alert number 80|tlsv1 alert internal error|ssl3_read_bytes/i;

/** True when the failure happened at the TLS layer rather than being an Atlas auth response. */
export function isAtlasTlsHandshakeRejection(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return ATLAS_TLS_FAILURE_PATTERN.test(message);
}
