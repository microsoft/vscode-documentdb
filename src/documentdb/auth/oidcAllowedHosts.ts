/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';

// Safe default when we cannot positively identify an Azure endpoint. This is the
// historical behavior and covers the public cloud (including private endpoints,
// which still resolve under *.azure.com).
const DEFAULT_ALLOWED_HOSTS = ['*.azure.com'];

/**
 * Resolve the OIDC ALLOWED_HOSTS list from a connection string.
 *
 * ALLOWED_HOSTS is a security control: the driver only sends the OIDC token to a
 * server whose hostname matches one of these patterns. It must therefore stay a
 * curated allowlist. We intentionally do NOT echo the raw connection-string host
 * back into the allowlist: doing so would let an attacker-supplied host (e.g.
 * `evil.com`) widen its own allowlist to `*.evil.com`, defeating the control.
 *
 * Instead we recognize the Azure-family registrable suffix (`azure.<tld>`) and
 * allow only `*.azure.<tld>`. This keeps the public-cloud posture identical to
 * the previous hardcoded `*.azure.com` while transparently extending it to
 * sovereign clouds (`azure.us`, `azure.cn`, ...). Anything we cannot positively
 * classify as Azure falls back to the safe public-cloud default.
 *
 * Note: sovereign clouds also use a different Entra token endpoint; wiring that
 * up is tracked separately. This change only widens the host allowlist.
 */
export function getOidcAllowedHosts(connectionString: string): string[] {
    try {
        const parsed = new DocumentDBConnectionString(connectionString);

        // Deduplicate so a replica-set connection string with several hosts in
        // the same cloud yields a single `*.azure.<tld>` entry.
        const suffixes = new Set<string>();
        for (const host of parsed.hosts ?? []) {
            const suffix = getAzureHostSuffix(host);
            if (suffix) {
                suffixes.add(suffix);
            }
        }

        if (suffixes.size > 0) {
            return [...suffixes].map((suffix) => `*.${suffix}`);
        }
    } catch {
        // Connection string could not be parsed; fall back to the safe default.
    }

    return DEFAULT_ALLOWED_HOSTS;
}

/**
 * Returns the Azure-family registrable suffix (`azure.<tld>`) for a host, or
 * `undefined` if the host is not an Azure endpoint.
 *
 * The `azure` label must be the registrable second level (immediately before the
 * top-level label) so that lookalikes such as `azure.com.evil.com` are rejected.
 */
function getAzureHostSuffix(host: string): string | undefined {
    // `hosts` entries may carry a port (e.g. `cluster.azure.com:10255`) and an
    // IPv6 literal is wrapped in brackets; neither is part of the suffix.
    const hostname = host
        .replace(/^\[.*\]/, '') // drop bracketed IPv6 literals (never Azure FQDNs)
        .split(':')[0]
        ?.trim()
        .toLowerCase();

    if (!hostname) {
        return undefined;
    }

    const labels = hostname.split('.');
    if (labels.length < 2) {
        return undefined;
    }

    const topLevel = labels[labels.length - 1];
    const secondLevel = labels[labels.length - 2];

    if (secondLevel === 'azure' && topLevel.length > 0) {
        return `azure.${topLevel}`;
    }

    return undefined;
}
