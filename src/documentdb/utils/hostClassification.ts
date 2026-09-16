/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { domainToASCII } from 'node:url';

/**
 * Host classification for the TLS-exception gating rules (Local Quick Start design §7.1).
 *
 * Decides whether a connection target is a local / private-network host for which a
 * self-signed or untrusted certificate is plausibly expected — i.e. whether to *offer*
 * the "Allow invalid TLS certificates" step in the new-connection wizard. The step itself
 * always defaults to **Enable TLS**; this gate only decides whether the step is shown.
 *
 * Caveat (design §7.1): `.local` suffixes and single-word names can also be corporate
 * infrastructure (AD domains, DNS search domains). That is why the gate only controls
 * whether the step is offered — the step defaults to keeping TLS on.
 *
 * Security note: classification is done on the IDNA/punycode-normalized hostname (see
 * `normalizeHostForClassification`). A public domain must never be able to masquerade as a
 * single-word local host by using a Unicode label separator (e.g. `example。com`, U+3002),
 * which DNS resolves as `example.com` but a naive ASCII-dot check would treat as one word.
 */

/**
 * Extract the bare hostname/IP from a connection-string host entry, stripping an optional
 * port and IPv6 brackets, lowercased. Handles `host`, `host:port`, `[ipv6]`, `[ipv6]:port`,
 * and bare IPv6 (`fe80::1`).
 */
export function extractHostname(host: string): string {
    const trimmed = host.trim();
    if (trimmed.startsWith('[')) {
        // [ipv6] or [ipv6]:port
        const end = trimmed.indexOf(']');
        if (end !== -1) {
            return trimmed.slice(1, end).toLowerCase();
        }
    }
    // `host:port` has exactly one colon; bare IPv6 has several (and no port without brackets).
    const colonCount = (trimmed.match(/:/g) ?? []).length;
    if (colonCount === 1) {
        return trimmed.slice(0, trimmed.indexOf(':')).toLowerCase();
    }
    return trimmed.toLowerCase();
}

/**
 * Normalize a bare hostname for classification so Unicode/IDNA homographs can't disguise a
 * public multi-label domain as a single-word local host. IPv6 literals (containing `:`) are
 * returned unchanged because `domainToASCII` rejects them. For everything else we first map the
 * Unicode full-stop variants that IDNA treats as label separators (U+3002 `。`, U+FF0E `．`,
 * U+FF61 `｡`) to ASCII `.` (defense-in-depth), then apply IDNA via `domainToASCII` (which also
 * punycodes other confusables). Falls back to the dot-normalized input if `domainToASCII` returns
 * empty (a malformed domain), so the downstream IP checks still run.
 */
function normalizeHostForClassification(hostname: string): string {
    if (hostname.includes(':')) {
        return hostname;
    }
    const dotNormalized = hostname.replace(/[\u3002\uFF0E\uFF61]/g, '.');
    return domainToASCII(dotNormalized) || dotNormalized;
}

/** Parse a dotted-quad IPv4 string into octets, or undefined if it is not a valid IPv4. */
function ipv4Octets(value: string): number[] | undefined {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
        return undefined;
    }
    const octets = value.split('.').map((part) => Number(part));
    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined;
}

/**
 * Fully expand an IPv6 literal into its 8 hextets, or undefined if it is not a valid IPv6 literal.
 * Handles the compressed `::` form, a zone index (`fe80::1%eth0`) and the dotted-quad tail of
 * IPv4-mapped / IPv4-compatible addresses (`::ffff:127.0.0.1`), which occupies the last two hextets.
 *
 * Expanding first is what lets the caller classify every spelling of the same address alike:
 * matching on the literal text made `0:0:0:0:0:0:0:1` and `::ffff:127.0.0.1` look public.
 */
function expandIpv6(value: string): number[] | undefined {
    const literal = value.split('%')[0];
    if (!literal.includes(':')) {
        return undefined;
    }
    const sides = literal.split('::');
    if (sides.length > 2) {
        return undefined;
    }

    const expandSide = (side: string): number[] | undefined => {
        if (side === '') {
            return [];
        }
        const groups = side.split(':');
        const hextets: number[] = [];
        for (let index = 0; index < groups.length; index++) {
            const group = groups[index];
            if (group.includes('.')) {
                // A dotted-quad is legal only as the final element, and fills two hextets.
                const octets = ipv4Octets(group);
                if (!octets || index !== groups.length - 1) {
                    return undefined;
                }
                hextets.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
                continue;
            }
            if (!/^[0-9a-f]{1,4}$/.test(group)) {
                return undefined;
            }
            hextets.push(parseInt(group, 16));
        }
        return hextets;
    };

    const head = expandSide(sides[0]);
    const tail = sides.length === 2 ? expandSide(sides[1]) : [];
    if (!head || !tail) {
        return undefined;
    }
    if (sides.length === 1) {
        return head.length === 8 ? head : undefined;
    }
    const fill = 8 - head.length - tail.length;
    return fill < 1 ? undefined : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Whether a host is a loopback / private-network / local-discovery target for which a
 * TLS-exception step should be offered (design §7.1):
 * - Loopback: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` (in any spelling)
 * - Unspecified/wildcard: `0.0.0.0`, `::` — these address the local machine
 * - IPv4 private (RFC 1918): `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
 * - IPv4 link-local: `169.254.0.0/16`
 * - IPv6 unique-local (`fc00::/7`) and link-local (`fe80::/10`)
 * - IPv4-mapped / IPv4-compatible IPv6 (`::ffff:127.0.0.1`) — classified by the embedded IPv4
 * - Single-word hostnames (no dots), e.g. `home`, `devbox`
 * - `*.local` mDNS names
 */
export function isLocalOrPrivateHost(host: string): boolean {
    const extracted = extractHostname(host);
    if (!extracted) {
        return false;
    }
    // Normalize away IDNA/Unicode homographs so a public domain can't pose as a single-word host.
    const hostname = normalizeHostForClassification(extracted);
    if (!hostname) {
        return false;
    }

    // Loopback / mDNS / single-word names.
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return true;
    }
    if (hostname.endsWith('.local')) {
        return true;
    }
    // A single-word hostname has no dots and is not IPv6 (no colons).
    if (!hostname.includes('.') && !hostname.includes(':')) {
        return true;
    }

    // IPv4 ranges.
    const octets = ipv4Octets(hostname);
    if (octets) {
        return isLocalOrPrivateIpv4(octets);
    }

    // IPv6: expand first, so every spelling of the same address classifies alike.
    const hextets = hostname.includes(':') ? expandIpv6(hostname) : undefined;
    if (hextets) {
        // ::1 loopback and :: unspecified, in any spelling (`0:0:0:0:0:0:0:1`, `::1`, `::`).
        if (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] <= 1) {
            return true;
        }
        // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`): the address IS that
        // IPv4, so classify it with the IPv4 rules rather than as an opaque public IPv6.
        if (hextets.slice(0, 5).every((hextet) => hextet === 0) && (hextets[5] === 0xffff || hextets[5] === 0)) {
            return isLocalOrPrivateIpv4([hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff]);
        }
        if ((hextets[0] & 0xfe00) === 0xfc00) {
            return true; // fc00::/7 unique-local
        }
        if ((hextets[0] & 0xffc0) === 0xfe80) {
            return true; // fe80::/10 link-local
        }
    }

    return false;
}

/** Classify parsed IPv4 octets against the loopback / private / link-local ranges. */
function isLocalOrPrivateIpv4(octets: number[]): boolean {
    const [a, b] = octets;
    if (a === 127) {
        return true; // 127.0.0.0/8 loopback
    }
    if (a === 0) {
        return true; // 0.0.0.0/8 — the unspecified address targets the local machine
    }
    if (a === 10) {
        return true; // 10.0.0.0/8
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true; // 172.16.0.0/12
    }
    if (a === 192 && b === 168) {
        return true; // 192.168.0.0/16
    }
    if (a === 169 && b === 254) {
        return true; // 169.254.0.0/16 link-local
    }
    return false;
}
