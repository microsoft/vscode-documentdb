/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from './DocumentDBConnectionString';
import { isLocalOrPrivateHost } from './hostClassification';

/**
 * Canonicalize the TLS exception carried by a connection string (Local Quick Start design §7).
 *
 * Why this exists: TLS-allow-invalid is keyed off `emulatorConfiguration.disableEmulatorSecurity`
 * (a stored flag), but a user-supplied connection string can ALSO request a TLS bypass via URL
 * params: certificate-validation bypass (`tlsAllowInvalidCertificates`, the legacy alias
 * `sslAllowInvalidCertificates`, or `tlsInsecure`), hostname-validation bypass
 * (`tlsAllowInvalidHostnames` / `sslAllowInvalidHostnames`), and the low-level Node socket toggle
 * `rejectUnauthorized` (inverse semantics: `false` = skip validation).
 * Two sources of truth are dangerous: the UI could show "TLS enabled" while the URL silently
 * disables certificate or hostname validation. And because the option is connection-wide, a public
 * host must never be able to disable validation through a pasted/deep-linked URL.
 *
 * This helper makes `emulatorConfiguration.disableEmulatorSecurity` the SINGLE source of truth:
 * - It strips every TLS-bypass param from the connection string (case-insensitive). Local/private
 *   connections re-derive the relaxed TLS posture from the stored flag (the option builders set
 *   `tlsAllowInvalidCertificates`), so no bypass param ever needs to persist in the string. Note a
 *   hostname-only bypass request is intentionally promoted to the broader certificate bypass for
 *   local hosts: `tlsAllowInvalidCertificates` (⇒ `rejectUnauthorized: false`) is a superset that
 *   also relaxes hostname checking, which keeps the single-source-of-truth model to one knob.
 * - It returns `disableEmulatorSecurity: true` ONLY when a bypass was requested AND **every** host
 *   is local/private (loopback/RFC1918/etc., per §7.1). For a public host (or a mixed seed list),
 *   the bypass is dropped and the connection validates certificates and hostnames.
 */

/** TLS-bypass URL params (lower-cased keys) whose value `true` disables certificate/hostname validation. */
const TLS_BYPASS_KEYS = new Set([
    'tlsallowinvalidcertificates',
    'sslallowinvalidcertificates',
    'tlsinsecure',
    'tlsallowinvalidhostnames',
    'sslallowinvalidhostnames',
]);

/**
 * The low-level Node TLS socket toggle `rejectUnauthorized`, which the MongoDB driver also accepts
 * as a URL param. It has INVERSE semantics (`false` = skip validation) and is the one with the
 * subtlest footgun: via a URL it is parsed as the *string* `"false"`, and Node's `tls.connect`
 * only treats the *boolean* `false` as "skip validation" (`rejectUnauthorized !== false`), so a
 * URL `?rejectUnauthorized=false` does NOT actually disable validation today. We still strip it
 * from the stored string (it is a socket-level toggle that should never persist in a user-facing
 * connection string) and, for hygiene + consistency, treat `=false` as a bypass *request* so a
 * local user's intent is honored through the single source of truth and a public host is gated.
 */
const REJECT_UNAUTHORIZED_KEY = 'rejectunauthorized';

export interface CanonicalTls {
    /** The connection string with all TLS-bypass params removed. */
    readonly connectionString: string;
    /** Whether allow-invalid certificates should be enabled (bypass requested AND all hosts local). */
    readonly disableEmulatorSecurity: boolean;
}

/**
 * Delete every TLS-bypass param (case-insensitive) from a parsed connection string in place.
 * Returns `stripped` (any bypass param was present and removed) and `bypassRequested` (the string
 * asked to skip certificate/hostname validation: a `TLS_BYPASS_KEYS` param set to `true`, or
 * `rejectUnauthorized` set to `false`).
 */
export function stripTlsBypassParams(parsed: DocumentDBConnectionString): {
    stripped: boolean;
    bypassRequested: boolean;
} {
    let stripped = false;
    let bypassRequested = false;
    for (const key of [...parsed.searchParams.keys()]) {
        const lowerKey = key.toLowerCase();
        const value = (parsed.searchParams.get(key) ?? '').toLowerCase();
        if (TLS_BYPASS_KEYS.has(lowerKey)) {
            if (value === 'true') {
                bypassRequested = true;
            }
            parsed.searchParams.delete(key);
            stripped = true;
        } else if (lowerKey === REJECT_UNAUTHORIZED_KEY) {
            // Inverse semantics: `rejectUnauthorized=false` is the bypass request.
            if (value === 'false') {
                bypassRequested = true;
            }
            parsed.searchParams.delete(key);
            stripped = true;
        }
    }
    return { stripped, bypassRequested };
}

export function canonicalizeTlsException(connectionString: string): CanonicalTls {
    let parsed: DocumentDBConnectionString;
    try {
        parsed = new DocumentDBConnectionString(connectionString);
    } catch {
        // Unparseable — leave it for the regular validators; never claim an exception.
        return { connectionString, disableEmulatorSecurity: false };
    }

    const { stripped, bypassRequested } = stripTlsBypassParams(parsed);

    // Allow-invalid is connection-wide, so only honor it when EVERY seed host is local/private.
    const allHostsLocal = parsed.hosts.length > 0 && parsed.hosts.every((host) => isLocalOrPrivateHost(host));

    return {
        connectionString: stripped ? parsed.toString() : connectionString,
        disableEmulatorSecurity: bypassRequested && allHostsLocal,
    };
}

/**
 * Whether EVERY host in a connection string is local/private (§7.1). Use this to host-gate a
 * TLS exception that was decided elsewhere (e.g. a wizard choice or a previously-stored flag),
 * so a connection string later changed to a public/mixed host can never keep allow-invalid.
 * Returns false for an unparseable or host-less string.
 */
export function areAllHostsLocal(connectionString: string): boolean {
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        return parsed.hosts.length > 0 && parsed.hosts.every((host) => isLocalOrPrivateHost(host));
    } catch {
        return false;
    }
}

/**
 * Resolve the runtime `tlsAllowInvalidCertificates` MongoClient option from the stored
 * `emulatorConfiguration.disableEmulatorSecurity` flag (design §7 "hybrid" runtime policy).
 *
 * The stored flag is honored ONLY when every host is local/private — the case where a self-signed
 * certificate is expected. For a public host a bare stored flag is deliberately NOT activated, so an
 * orphaned flag left on a connection (e.g. an old shared deep link that was later edited to drop its
 * `tlsAllowInvalidCertificates` URL param) can't silently disable certificate validation after the
 * flag was decoupled from `isEmulator`.
 *
 * Returns `true` to enable allow-invalid, or `undefined` to stay silent. It NEVER returns `false`:
 * staying silent (rather than forcing `tlsAllowInvalidCertificates: false`) lets the MongoDB driver
 * still honor an explicit `tlsAllowInvalidCertificates=true` that a user deliberately put in their
 * connection string, so self-hosted databases on public hostnames keep working.
 */
export function resolveAllowInvalidCertificates(
    disableEmulatorSecurity: boolean | undefined,
    connectionString: string,
): true | undefined {
    return disableEmulatorSecurity && areAllHostsLocal(connectionString) ? true : undefined;
}
