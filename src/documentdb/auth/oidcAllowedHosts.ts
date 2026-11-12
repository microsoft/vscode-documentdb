/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { isIP } from 'net';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { type DocumentDBEntraCloud } from './entraScopes';

export const BUILT_IN_ENTRA_DESTINATION_SUFFIXES = [
    'mongocluster.cosmos.azure.com',
    'mongocluster.cosmos.azure.us',
    'mongocluster.cosmos.azure.cn',
] as const;

const CUSTOMER_HOSTING_SUFFIXES = [
    'cloudapp.azure.com',
    'cloudapp.usgovcloudapi.net',
    'cloudapp.chinacloudapi.cn',
] as const;

export type EntraDestinationClass = 'documentdbService' | 'customSuffix' | 'otherAzure' | 'other';

export interface EntraDestinationDecision {
    allowed: boolean;
    destinationClass: EntraDestinationClass;
    allowedHostPatterns: readonly string[];
    customSuffixUsed?: string;
    rejection?: { microsoftCloudDomain: boolean; serviceLabel: boolean };
    firstHost?: string;
    hostCount: number;
}

export class EntraDestinationRejectedError extends Error {
    public readonly firstHost: string;
    public readonly additionalHostCount: number;

    constructor(decision: Pick<EntraDestinationDecision, 'firstHost' | 'hostCount'>) {
        super(l10n.t("Microsoft Entra ID isn't allowed for this server."));
        this.name = 'EntraDestinationRejectedError';
        this.firstHost = getHostname(decision.firstHost ?? '') ?? '';
        this.additionalHostCount = Math.max(0, decision.hostCount - 1);
    }
}

export function isEntraDestinationRejectedError(error: unknown): error is EntraDestinationRejectedError {
    return error instanceof EntraDestinationRejectedError;
}

// The registrable `azure.<tld>` suffixes owned by Microsoft for the public and
// sovereign clouds. This is a closed list on purpose: `azure` under any other
// top-level domain (for example a ccTLD with open registration) is not ours.
const KNOWN_AZURE_TOP_LEVEL_DOMAINS: ReadonlySet<string> = new Set(['com', 'us', 'cn']);

/** Recognizes DocumentDB service hosts without trusting lookalikes or arbitrary Azure services. */
export function hasDocumentDBHost(hosts: readonly string[], customHostnameSuffix?: string): boolean {
    const customSuffix = normalizeCustomHostnameSuffix(customHostnameSuffix);
    const patterns = BUILT_IN_ENTRA_DESTINATION_SUFFIXES.map((suffix) => `*.${suffix}`);
    if (customSuffix) {
        patterns.push(`*.${customSuffix}`);
    }
    return hosts.some((host) => isEntraDestinationHostAllowed(host, patterns));
}

/**
 * Legacy recognition API. Rejected destinations return no patterns; callers that acquire
 * tokens must use evaluateEntraDestination and reject before acquisition.
 */
export function getOidcAllowedHosts(connectionString: string, customHostnameSuffix?: string): string[] {
    return [...evaluateEntraDestination(connectionString, customHostnameSuffix).allowedHostPatterns];
}

export function isEntraDestinationHostAllowed(host: string, patterns: readonly string[]): boolean {
    const hostname = getHostname(host);
    if (!hostname || !isDnsName(hostname)) {
        return false;
    }
    return patterns.some((pattern) => {
        if (!pattern.startsWith('*.')) {
            return false;
        }
        const suffix = pattern.slice(2);
        return isDnsName(suffix) && hostname.endsWith(`.${suffix.toLowerCase()}`);
    });
}

export function evaluateEntraDestination(
    connectionString: string,
    customHostnameSuffix?: unknown,
): EntraDestinationDecision {
    let hosts: string[];
    try {
        const parsed = new DocumentDBConnectionString(connectionString);
        if (parsed.hash) {
            throw new Error('Invalid connection string fragment');
        }
        hosts = parsed.hosts;
    } catch {
        hosts = [];
    }

    const customSuffix = normalizeCustomHostnameSuffix(customHostnameSuffix);
    const patterns = new Set<string>();
    let customSuffixUsed: string | undefined;
    let rejected = hosts.length === 0;
    let microsoftCloudDomain = false;
    let serviceLabel = false;
    for (const host of hosts) {
        const builtin = BUILT_IN_ENTRA_DESTINATION_SUFFIXES.find((suffix) =>
            isEntraDestinationHostAllowed(host, [`*.${suffix}`]),
        );
        if (builtin) {
            patterns.add(`*.${builtin}`);
        } else if (customSuffix && isEntraDestinationHostAllowed(host, [`*.${customSuffix}`])) {
            patterns.add(`*.${customSuffix}`);
            customSuffixUsed = customSuffix;
        } else {
            rejected = true;
            const hostname = getHostname(host);
            microsoftCloudDomain ||=
                !!getAzureHostSuffix(host) ||
                !!hostname?.endsWith('.usgovcloudapi.net') ||
                !!hostname?.endsWith('.chinacloudapi.cn') ||
                hostname === 'windows.net' ||
                !!hostname?.endsWith('.windows.net');
            serviceLabel ||= !!hostname?.split('.').some((label) => label === 'mongocluster' || label === 'documentdb');
        }
    }

    let destinationClass: EntraDestinationClass = 'documentdbService';
    if (rejected) {
        destinationClass = microsoftCloudDomain ? 'otherAzure' : 'other';
    } else if (customSuffixUsed) {
        destinationClass = 'customSuffix';
    }

    return {
        allowed: !rejected,
        destinationClass,
        allowedHostPatterns: rejected ? [] : [...patterns],
        ...(rejected ? { rejection: { microsoftCloudDomain, serviceLabel } } : { customSuffixUsed }),
        firstHost: getHostname(hosts[0] ?? ''),
        hostCount: hosts.length,
    };
}

export interface AzureHostCloud {
    /**
     * The one built-in cloud of the recognized hosts, `'conflicting'` when they span more than one
     * cloud, or `undefined` when no host is recognized.
     */
    readonly cloud: DocumentDBEntraCloud | 'conflicting' | undefined;
    /** Whether any host is outside the built-in Azure domains, such as a private DNS name or an IP address. */
    readonly hasOtherHosts: boolean;
}

/**
 * Returns the built-in Azure cloud of a connection string's hosts.
 *
 * `azure.com` is the public cloud, `azure.us` Azure US Government, and `azure.cn` Azure China. Hosts
 * outside these domains (private DNS names, IP addresses) carry no cloud evidence, so they are ignored
 * rather than discarding the evidence of the recognized hosts.
 */
export function getAzureCloudFromHosts(connectionString: string): AzureHostCloud {
    let hosts: string[];
    try {
        hosts = new DocumentDBConnectionString(connectionString).hosts ?? [];
    } catch {
        return { cloud: undefined, hasOtherHosts: false };
    }

    const clouds = new Set<DocumentDBEntraCloud>();
    let hasOtherHosts = false;
    for (const host of hosts) {
        switch (getAzureHostSuffix(host)) {
            case 'azure.com':
                clouds.add('AzureCloud');
                break;
            case 'azure.us':
                clouds.add('AzureUSGovernment');
                break;
            case 'azure.cn':
                clouds.add('AzureChinaCloud');
                break;
            default:
                hasOtherHosts = true;
        }
    }

    const cloud = clouds.size > 1 ? 'conflicting' : [...clouds][0];
    return { cloud, hasOtherHosts };
}

/**
 * Validates `documentDB.customEnvironment.hostnameSuffix` and returns it without the
 * leading dot. Public suffixes and parents of service/customer-hosting namespaces
 * cannot be used to restore cloud-wide token delivery.
 */
export function normalizeCustomHostnameSuffix(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim().replace(/^\./, '');
    if (!isDnsName(trimmed)) {
        return undefined;
    }
    const suffix = trimmed.toLowerCase();
    const labels = suffix.split('.');
    if (labels.length < 2 || labels.includes('cloudapp')) {
        return undefined;
    }
    if (/^(?:com|co|net|org|gov)\.[a-z]{2}$/.test(suffix)) {
        return undefined;
    }
    if (
        [...BUILT_IN_ENTRA_DESTINATION_SUFFIXES, ...CUSTOMER_HOSTING_SUFFIXES].some(
            (protectedSuffix) => protectedSuffix === suffix || protectedSuffix.endsWith(`.${suffix}`),
        )
    ) {
        return undefined;
    }

    return suffix;
}

function isDnsName(hostname: string): boolean {
    return (
        hostname.length > 0 &&
        hostname.length <= 253 &&
        !/[^A-Za-z0-9.-]/.test(hostname) &&
        !isIP(hostname) &&
        hostname.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
    );
}

function getHostname(host: string): string | undefined {
    const match = /^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/.exec(host);
    if (!match || match[0] !== host) {
        return undefined;
    }
    if (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535)) {
        return undefined;
    }
    const hostname = match[1];
    // IPs and trailing dots are safe to display, but never pass isDnsName for authorization.
    const displayName = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
    const address = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return isDnsName(displayName) || isIP(address) ? hostname.toLowerCase() : undefined;
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
