/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClientOptions } from 'mongodb';
import { type SrvRecord } from 'node:dns';

export interface SrvLookupTarget {
    readonly srvHost: string;
    readonly srvServiceName: string;
    readonly srvQueryName: string;
}

export interface RewriteSrvUriInput {
    readonly connectionString: string;
    readonly options?: MongoClientOptions;
    readonly srvRecords: readonly SrvRecord[];
    readonly txtRecords: readonly (readonly string[])[] | undefined;
}

export type SrvTxtOptionKey = 'authSource' | 'replicaSet' | 'loadBalanced';

export interface RewriteSrvUriResult {
    /** Transient connection string. Never persist or log it. */
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly targets: readonly string[];
    readonly tlsAdded: boolean;
    readonly txtApplied: readonly SrvTxtOptionKey[];
}

export type SrvRewriteErrorKind = 'invalidUri' | 'noAddresses' | 'parentDomainMismatch' | 'txtInvalid';

/** A rejection the driver's own SRV resolution would also make; messages match the driver's. */
export class SrvRewriteError extends Error {
    constructor(
        public readonly kind: SrvRewriteErrorKind,
        message: string,
    ) {
        super(message);
        this.name = 'SrvRewriteError';
    }
}

const txtOptionKeys: readonly string[] = ['authSource', 'replicaSet', 'loadBalanced'];
const externalMechanisms = new Set(['MONGODB-OIDC', 'MONGODB-X509', 'MONGODB-AWS', 'GSSAPI']);

// Same host split as mongodb-connection-string-url, so userinfo bytes are kept verbatim.
const hostsRegex = /^(?<protocol>[^/]+):\/\/(?:(?<userinfo>[^@]*)@)?(?<hosts>(?!:)[^/?@]*)(?<rest>.*)/;

interface SrvUriParts {
    readonly host: string;
    readonly userinfo: string;
    readonly path: string;
    readonly params: URLSearchParams;
    readonly hash: string;
}

export function isSrvConnectionString(connectionString: string): boolean {
    return /^mongodb\+srv:\/\//i.test(connectionString);
}

function splitSrvUri(connectionString: string): SrvUriParts {
    const groups = isSrvConnectionString(connectionString) ? hostsRegex.exec(connectionString)?.groups : undefined;
    if (!groups?.hosts) {
        throw new SrvRewriteError('invalidUri', 'Invalid mongodb+srv:// connection string');
    }
    const { userinfo, hosts, rest } = groups;
    const hashStart = rest.indexOf('#');
    const beforeHash = hashStart < 0 ? rest : rest.slice(0, hashStart);
    const queryStart = beforeHash.indexOf('?');
    return {
        host: hosts,
        userinfo: userinfo === undefined ? '' : `${userinfo}@`,
        path: queryStart < 0 ? beforeHash : beforeHash.slice(0, queryStart),
        params: new URLSearchParams(queryStart < 0 ? '' : beforeHash.slice(queryStart + 1)),
        hash: hashStart < 0 ? '' : rest.slice(hashStart),
    };
}

function getParam(params: URLSearchParams, name: string): string | undefined {
    for (const [key, value] of params) {
        if (key.toLowerCase() === name.toLowerCase()) {
            return value;
        }
    }
    return undefined;
}

function setParam(params: URLSearchParams, name: string, value: string): void {
    deleteParam(params, name);
    params.set(name, value);
}

function deleteParam(params: URLSearchParams, name: string): void {
    for (const key of [...params.keys()]) {
        if (key.toLowerCase() === name.toLowerCase()) {
            params.delete(key);
        }
    }
}

export function getSrvLookupTarget(connectionString: string, options?: MongoClientOptions): SrvLookupTarget {
    const parts = splitSrvUri(connectionString);
    const srvServiceName = options?.srvServiceName ?? getParam(parts.params, 'srvServiceName') ?? 'mongodb';
    return {
        srvHost: parts.host,
        srvServiceName,
        srvQueryName: `_${srvServiceName}._tcp.${parts.host}`,
    };
}

/** Mirrors the driver's parent-domain check, which stops DNS from redirecting to other domains. */
function checkParentDomainMatch(address: string, srvHost: string): void {
    const normalizedAddress = address.endsWith('.') ? address.slice(0, -1) : address;
    const normalizedSrvHost = srvHost.endsWith('.') ? srvHost.slice(0, -1) : srvHost;
    const lessThanThreeParts = normalizedSrvHost.split('.').length < 3;
    const addressDomain = `.${normalizedAddress.replace(/^.*?\./, '')}`;
    let srvHostDomain = lessThanThreeParts ? normalizedSrvHost : `.${normalizedSrvHost.replace(/^.*?\./, '')}`;
    if (!srvHostDomain.startsWith('.')) {
        srvHostDomain = `.${srvHostDomain}`;
    }
    if (lessThanThreeParts && normalizedAddress.split('.').length <= normalizedSrvHost.split('.').length) {
        throw new SrvRewriteError(
            'parentDomainMismatch',
            'Server record does not have at least one more domain level than parent URI',
        );
    }
    if (!addressDomain.endsWith(srvHostDomain)) {
        throw new SrvRewriteError('parentDomainMismatch', 'Server record does not share hostname with parent URI');
    }
}

/**
 * Turns a `mongodb+srv://` string into the equivalent `mongodb://` string, as the driver would after
 * its own SRV and TXT lookups. Option conflicts are left to the driver when it parses the result.
 */
export function rewriteSrvUri(input: RewriteSrvUriInput): RewriteSrvUriResult {
    const parts = splitSrvUri(input.connectionString);
    const value = (name: keyof MongoClientOptions): unknown => input.options?.[name] ?? getParam(parts.params, name);

    if (input.srvRecords.length === 0) {
        throw new SrvRewriteError('noAddresses', 'No addresses found at host');
    }
    for (const record of input.srvRecords) {
        checkParentDomainMatch(record.name, parts.host);
    }
    let targets = input.srvRecords.map((record): string => `${record.name.toLowerCase()}:${record.port}`);
    const srvMaxHosts = Number(value('srvMaxHosts') ?? 0);
    if (srvMaxHosts > 0) {
        targets = targets.slice(0, srvMaxHosts);
    }

    const txtApplied: SrvTxtOptionKey[] = [];
    if (input.txtRecords?.length) {
        if (input.txtRecords.length > 1) {
            throw new SrvRewriteError('txtInvalid', 'Multiple text records not allowed');
        }
        const txt = new URLSearchParams(input.txtRecords[0].join(''));
        for (const [key, txtValue] of txt) {
            if (!txtOptionKeys.includes(key)) {
                throw new SrvRewriteError('txtInvalid', `Text record may only set any of: ${txtOptionKeys.join(', ')}`);
            }
            if (txtValue === '') {
                throw new SrvRewriteError('txtInvalid', 'Cannot have empty URI params in DNS TXT Record');
            }
        }
        const authSource = txt.get('authSource');
        const mechanism = String(value('authMechanism') ?? '').toUpperCase();
        if (authSource && value('authSource') === undefined && !externalMechanisms.has(mechanism)) {
            setParam(parts.params, 'authSource', authSource);
            txtApplied.push('authSource');
        }
        const replicaSet = txt.get('replicaSet');
        if (replicaSet && value('replicaSet') === undefined) {
            setParam(parts.params, 'replicaSet', replicaSet);
            txtApplied.push('replicaSet');
        }
        if (txt.get('loadBalanced') === 'true') {
            setParam(parts.params, 'loadBalanced', 'true');
            txtApplied.push('loadBalanced');
        }
    }

    deleteParam(parts.params, 'srvMaxHosts');
    deleteParam(parts.params, 'srvServiceName');
    const options = { ...input.options };
    delete options.srvMaxHosts;
    delete options.srvServiceName;

    const tlsAdded = value('tls') === undefined && value('ssl') === undefined;
    if (tlsAdded) {
        parts.params.set('tls', 'true');
    }
    const query = parts.params.toString();
    return {
        connectionString: `mongodb://${parts.userinfo}${targets.join(',')}${parts.path}${query ? `?${query}` : ''}${parts.hash}`,
        options,
        targets,
        tlsAdded,
        txtApplied,
    };
}
