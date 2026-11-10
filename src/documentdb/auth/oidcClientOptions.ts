/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions, type OIDCCallbackFunction } from 'mongodb';
import { checkServerIdentity, type PeerCertificate } from 'tls';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import {
    EntraDestinationRejectedError,
    evaluateEntraDestination,
    isEntraDestinationHostAllowed,
    type EntraDestinationDecision,
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

export function createEntraCheckServerIdentity(
    patterns: readonly string[],
): (host: string, cert: PeerCertificate) => Error | undefined {
    const allowedPatterns = [...patterns];
    return (host: string, cert: PeerCertificate): Error | undefined => {
        if (!isEntraDestinationHostAllowed(host, allowedPatterns)) {
            return new EntraDestinationRejectedError({ firstHost: host, hostCount: 1 });
        }
        return checkServerIdentity(host, cert);
    };
}

export function buildOidcClientConfiguration(input: {
    connectionString: string;
    customHostnameSuffix?: unknown;
    oidcCallback: OIDCCallbackFunction;
    baseOptions?: MongoClientOptions;
}): {
    connectionString: string;
    options: MongoClientOptions;
    decision: EntraDestinationDecision;
    ignoredTlsBypass: boolean;
} {
    const decision = evaluateEntraDestination(input.connectionString, input.customHostnameSuffix);
    if (!decision.allowed) {
        throw new EntraDestinationRejectedError(decision);
    }

    const parsed = new DocumentDBConnectionString(input.connectionString);
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
        decision,
        ignoredTlsBypass,
        options: {
            ...baseOptions,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                ALLOWED_HOSTS: [...decision.allowedHostPatterns],
                OIDC_CALLBACK: input.oidcCallback,
            },
            tls: true,
            rejectUnauthorized: true,
            checkServerIdentity: createEntraCheckServerIdentity(decision.allowedHostPatterns),
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
