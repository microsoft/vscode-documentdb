/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Endpoint normalization for the "is this connection already here?" checks in the New Local
 * Connection wizard (#858).
 *
 * `localhost`, `127.0.0.1`, and `::1` all address the same machine, so comparing host strings
 * verbatim let the same local service be added twice under different spellings — including
 * alongside the Quick Start managed instance, which is not a stored connection and so was not
 * compared against at all.
 */

import { type InstanceStatus } from '../../services/localQuickStart/quickStartTypes';

/** Default MongoDB/DocumentDB wire-protocol port, used when a host carries no explicit port. */
export const DEFAULT_WIRE_PROTOCOL_PORT = 27017;

/**
 * Host spellings that all mean "this machine". `0:0:0:0:0:0:0:1` is the expanded form of `::1`;
 * anything else in `127.0.0.0/8` (e.g. `127.0.0.2`) is deliberately NOT here — it is loopback at
 * the IP layer, but a service bound to one such address is not reachable on another, so treating
 * them as the same endpoint would produce false duplicates.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

/** Canonical spelling every loopback form collapses to. */
const CANONICAL_LOOPBACK = 'localhost';

/**
 * Split `host[:port]`, honouring the bracket form IPv6 requires (`[::1]:10260`) and the bare form
 * that carries no port (`::1`). A bare address with more than one colon cannot also carry a port —
 * that is exactly why the bracket form exists — so it is returned whole.
 */
function splitHostPort(host: string): { readonly hostname: string; readonly port?: string } {
    const trimmed = host.trim();

    if (trimmed.startsWith('[')) {
        const closing = trimmed.indexOf(']');
        if (closing > 0) {
            const rest = trimmed.slice(closing + 1);
            return {
                hostname: trimmed.slice(1, closing),
                port: rest.startsWith(':') ? rest.slice(1) : undefined,
            };
        }
        return { hostname: trimmed };
    }

    const colons = (trimmed.match(/:/g) ?? []).length;
    if (colons !== 1) {
        // Zero colons: a plain hostname. More than one: a bare IPv6 address.
        return { hostname: trimmed };
    }
    const separator = trimmed.indexOf(':');
    return { hostname: trimmed.slice(0, separator), port: trimmed.slice(separator + 1) };
}

/**
 * Canonical `host:port` for comparison. Loopback spellings collapse to `localhost` and a missing
 * port is filled in with the wire-protocol default, so `localhost`, `127.0.0.1:27017`, and
 * `[::1]:27017` all normalize to the same string.
 */
export function normalizeEndpoint(host: string, defaultPort: number = DEFAULT_WIRE_PROTOCOL_PORT): string {
    const { hostname, port } = splitHostPort(host);
    const lowered = hostname.toLowerCase();
    const canonical = LOOPBACK_HOSTNAMES.has(lowered) ? CANONICAL_LOOPBACK : lowered;
    const resolvedPort = port?.trim() ? port.trim() : String(defaultPort);
    return `${canonical}:${resolvedPort}`;
}

/**
 * Canonical, order-independent key for a whole host list, so a seed list written in a different
 * order (or with different loopback spellings) still compares equal.
 */
export function normalizeEndpointList(hosts: readonly string[], defaultPort?: number): string {
    return hosts
        .map((host) => normalizeEndpoint(host, defaultPort))
        .sort()
        .join(',');
}

/** True when any host in the list addresses the local machine. */
export function hasLoopbackHost(hosts: readonly string[]): boolean {
    return hosts.some((host) => normalizeEndpoint(host).startsWith(`${CANONICAL_LOOPBACK}:`));
}

/**
 * The Quick Start managed instance serving one of `hosts`, if any.
 *
 * Matching is by endpoint alone — the instance owns that port on this machine, so any connection
 * pointed at it reaches the same server regardless of the credentials used. Instances with no known
 * port yet (never provisioned) can't collide with anything and are skipped.
 */
export function findQuickStartInstanceForHosts(
    hosts: readonly string[],
    instances: readonly InstanceStatus[],
): InstanceStatus | undefined {
    const normalized = new Set(hosts.map((host) => normalizeEndpoint(host)));
    return instances.find(
        (instance) => instance.port !== undefined && normalized.has(`${CANONICAL_LOOPBACK}:${instance.port}`),
    );
}
