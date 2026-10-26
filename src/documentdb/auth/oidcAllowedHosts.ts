/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { type DocumentDBEntraCloud } from './entraScopes';

// Safe default when we cannot positively identify an Azure endpoint. This is the
// historical behavior and covers the public cloud (including private endpoints,
// which still resolve under *.azure.com).
const DEFAULT_ALLOWED_HOSTS = ['*.azure.com'];

// The registrable `azure.<tld>` suffixes owned by Microsoft for the public and
// sovereign clouds. This is a closed list on purpose: `azure` under any other
// top-level domain (for example a ccTLD with open registration) is not ours.
const KNOWN_AZURE_TOP_LEVEL_DOMAINS: ReadonlySet<string> = new Set(['com', 'us', 'cn']);

/** Recognizes DocumentDB service hosts without trusting lookalikes or arbitrary Azure services. */
export function hasDocumentDBHost(hosts: readonly string[], customHostnameSuffix?: string): boolean {
    const customSuffix = normalizeCustomHostnameSuffix(customHostnameSuffix);
    return hosts.some((host) => {
        const hostname = getHostname(host);
        const azureSuffix = getAzureHostSuffix(host);
        return (
            !!hostname &&
            ((!!azureSuffix && hostname.endsWith(`.mongocluster.cosmos.${azureSuffix}`)) ||
                (!!customSuffix && hostname.endsWith(`.${customSuffix}`)))
        );
    });
}

/**
 * Resolve the OIDC ALLOWED_HOSTS list from a connection string.
 *
 * ALLOWED_HOSTS is a security control: the driver only sends the OIDC token to a
 * server whose hostname matches one of these patterns. It must therefore stay a
 * curated allowlist. We intentionally do NOT echo the raw connection-string host
 * back into the allowlist: doing so would let an attacker-supplied host (e.g.
 * `evil.com`) widen its own allowlist to `*.evil.com`, defeating the control.
 *
 * Instead we recognize the known Azure cloud suffixes (`azure.com`, `azure.us`,
 * `azure.cn`) and allow only `*.<suffix>`. This keeps the public-cloud posture
 * identical to the previous hardcoded `*.azure.com` while extending it to the
 * sovereign clouds. Anything we cannot positively classify as one of these
 * clouds falls back to the safe public-cloud default.
 *
 * A custom cloud's DocumentDB host suffix (`documentDB.customEnvironment.mongoClusterHostnameSuffix`)
 * is trusted only when the user configured it explicitly and the host actually ends with it.
 *
 * The token audience for each cloud is chosen separately, in `documentdbTokenResource.ts`.
 */
export function getOidcAllowedHosts(connectionString: string, customHostnameSuffix?: string): string[] {
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        const customSuffix = normalizeCustomHostnameSuffix(customHostnameSuffix);

        // Deduplicate so a replica-set connection string with several hosts in
        // the same cloud yields a single `*.azure.<tld>` entry.
        const suffixes = new Set<string>();
        for (const host of parsed.hosts ?? []) {
            const suffix = getAzureHostSuffix(host);
            if (suffix) {
                suffixes.add(suffix);
                continue;
            }

            const hostname = getHostname(host);
            if (customSuffix && hostname?.endsWith(`.${customSuffix}`)) {
                suffixes.add(customSuffix);
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
 * Returns the built-in Azure cloud a connection string's hosts belong to, when every host agrees.
 *
 * `azure.com` is the public cloud, `azure.us` Azure US Government, and `azure.cn` Azure China. Hosts
 * outside these domains (private DNS names, IP addresses) return `undefined`.
 */
export function getAzureCloudFromHosts(connectionString: string): DocumentDBEntraCloud | undefined {
    let hosts: string[];
    try {
        hosts = new DocumentDBConnectionString(connectionString).hosts ?? [];
    } catch {
        return undefined;
    }

    const clouds = new Set<DocumentDBEntraCloud | undefined>(
        hosts.map((host) => {
            switch (getAzureHostSuffix(host)) {
                case 'azure.com':
                    return 'AzureCloud';
                case 'azure.us':
                    return 'AzureUSGovernment';
                case 'azure.cn':
                    return 'AzureChinaCloud';
                default:
                    return undefined;
            }
        }),
    );

    if (clouds.size !== 1) {
        return undefined;
    }
    return [...clouds][0];
}

/**
 * Validates `documentDB.customEnvironment.mongoClusterHostnameSuffix` and returns it without the
 * leading dot. Bare TLDs and common two-label public suffixes can never be trusted.
 */
export function normalizeCustomHostnameSuffix(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const suffix = value.trim().toLowerCase().replace(/^\./, '');
    const labels = suffix.split('.');
    if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
        return undefined;
    }
    if (/^(?:com|co|net|org|gov)\.[a-z]{2}$/.test(suffix)) {
        return undefined;
    }

    return suffix;
}

function getHostname(host: string): string | undefined {
    // `hosts` entries may carry a port (e.g. `cluster.azure.com:10255`) and an
    // IPv6 literal is wrapped in brackets; neither is part of the suffix.
    return (
        host
            .replace(/^\[.*\]/, '') // drop bracketed IPv6 literals (never Azure FQDNs)
            .split(':')[0]
            ?.trim()
            .toLowerCase() || undefined
    );
}

/**
 * Returns the Azure cloud suffix (`azure.<tld>`) for a host, or `undefined` if
 * the host is not an endpoint in a known Azure cloud.
 *
 * The `azure` label must be the registrable second level (immediately before the
 * top-level label) so that lookalikes such as `azure.com.evil.com` are rejected,
 * and the top-level label must be one of {@link KNOWN_AZURE_TOP_LEVEL_DOMAINS}.
 */
export function getAzureHostSuffix(host: string): string | undefined {
    const hostname = getHostname(host);

    if (!hostname) {
        return undefined;
    }

    const labels = hostname.split('.');
    if (labels.length < 2) {
        return undefined;
    }

    const topLevel = labels[labels.length - 1];
    const secondLevel = labels[labels.length - 2];

    if (secondLevel === 'azure' && KNOWN_AZURE_TOP_LEVEL_DOMAINS.has(topLevel)) {
        return `azure.${topLevel}`;
    }

    return undefined;
}
