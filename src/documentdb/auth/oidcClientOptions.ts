/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions, type OIDCCallbackFunction, type OIDCResponse } from 'mongodb';
import { checkServerIdentity, type PeerCertificate } from 'tls';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import {
    EntraDestinationRejectedError,
    evaluateEntraDestination,
    isEntraDestinationHostAllowed,
} from './oidcAllowedHosts';

const TLS_BYPASS_KEYS = new Set([
    'tlsinsecure',
    'sslinsecure',
    'tlsallowinvalidcertificates',
    'sslallowinvalidcertificates',
    'tlsallowinvalidhostnames',
    'sslallowinvalidhostnames',
    'sslvalidate',
    'rejectunauthorized',
]);

const URI_TRUST_AND_PROXY_KEYS = new Set([
    'ca',
    'crl',
    'tlscafile',
    'tlscrlfile',
    'proxyhost',
    'proxyport',
    'proxyusername',
    'proxypassword',
]);

const OVERRIDDEN_KEYS = new Set([
    'auth',
    'authmechanism',
    'authmechanismproperties',
    'tls',
    'ssl',
    'checkserveridentity',
    'servername',
    'session',
    ...TLS_BYPASS_KEYS,
]);

export interface OidcDestinationPolicy {
    readonly allowedHostPatterns: readonly string[];
    assertAllowed(host?: string): void;
}

export function createOidcDestinationPolicy(
    originalConnectionString: string,
    getCustomHostnameSuffix: () => unknown,
): OidcDestinationPolicy {
    const original = evaluateEntraDestination(originalConnectionString, getCustomHostnameSuffix());
    if (!original.allowed) {
        throw new EntraDestinationRejectedError(original);
    }
    const allowedHostPatterns = Object.freeze([...original.allowedHostPatterns]);
    return {
        allowedHostPatterns,
        assertAllowed(host?: string): void {
            const current = evaluateEntraDestination(originalConnectionString, getCustomHostnameSuffix());
            if (!current.allowed) {
                throw new EntraDestinationRejectedError(current);
            }
            if (
                host !== undefined &&
                (!isEntraDestinationHostAllowed(host, allowedHostPatterns) ||
                    !isEntraDestinationHostAllowed(host, current.allowedHostPatterns))
            ) {
                throw new EntraDestinationRejectedError({ firstHost: host, hostCount: 1 });
            }
        },
    };
}

export function createEntraCheckServerIdentity(
    policy: OidcDestinationPolicy,
): (host: string, cert: PeerCertificate) => Error | undefined {
    return (host: string, cert: PeerCertificate): Error | undefined => {
        try {
            policy.assertAllowed(host);
        } catch (error) {
            return error instanceof Error
                ? error
                : new EntraDestinationRejectedError({ firstHost: host, hostCount: 1 });
        }
        return checkServerIdentity(host, cert);
    };
}

export function buildOidcClientConfiguration(input: {
    connectionString: string;
    policy: OidcDestinationPolicy;
    oidcCallback: OIDCCallbackFunction;
    baseOptions?: MongoClientOptions;
}): {
    connectionString: string;
    options: MongoClientOptions;
    ignoredTlsBypass: boolean;
} {
    input.policy.assertAllowed();
    let parsed: DocumentDBConnectionString;
    try {
        parsed = new DocumentDBConnectionString(input.connectionString);
        if (parsed.hash || parsed.hosts.length === 0) {
            throw new EntraDestinationRejectedError({ hostCount: 0 });
        }
    } catch {
        throw new EntraDestinationRejectedError({ hostCount: 0 });
    }
    for (const host of parsed.hosts) {
        input.policy.assertAllowed(host);
    }
    parsed.username = '';
    parsed.password = '';
    let ignoredTlsBypass = false;
    // Snapshot entries, not get()/getAll(): the URI wrapper folds case only for lookups,
    // so a single delete can leave other spellings (or values) in the URI.
    for (const [key, value] of [...parsed.searchParams.entries()]) {
        const lowerKey = key.toLowerCase();
        const overridesTrustOrProxy = URI_TRUST_AND_PROXY_KEYS.has(lowerKey);
        ignoredTlsBypass ||= overridesTrustOrProxy || requestsTlsBypass(lowerKey, value);
        // Only extension-controlled options may customize peer trust or proxy routing.
        if (overridesTrustOrProxy || OVERRIDDEN_KEYS.has(lowerKey)) {
            parsed.searchParams.delete(key);
        }
    }

    const baseOptions = { ...input.baseOptions };
    for (const [key, value] of Object.entries(baseOptions)) {
        const lowerKey = key.toLowerCase();
        ignoredTlsBypass ||= requestsTlsBypass(lowerKey, value);
        if (OVERRIDDEN_KEYS.has(lowerKey)) {
            delete baseOptions[key as keyof MongoClientOptions];
        }
    }

    return {
        connectionString: parsed.toString(),
        ignoredTlsBypass,
        options: {
            ...baseOptions,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                ALLOWED_HOSTS: [...input.policy.allowedHostPatterns],
                OIDC_CALLBACK: async (params): Promise<OIDCResponse> => {
                    input.policy.assertAllowed();
                    const response = await input.oidcCallback(params);
                    input.policy.assertAllowed();
                    return response;
                },
            },
            tls: true,
            rejectUnauthorized: true,
            checkServerIdentity: createEntraCheckServerIdentity(input.policy),
        },
    };
}

function requestsTlsBypass(key: string, value: unknown): boolean {
    if (key === 'tls' || key === 'ssl' || key === 'rejectunauthorized' || key === 'sslvalidate') {
        return value === false || (typeof value === 'string' && value.toLowerCase() === 'false');
    }
    return (
        TLS_BYPASS_KEYS.has(key) && (value === true || (typeof value === 'string' && value.toLowerCase() === 'true'))
    );
}
