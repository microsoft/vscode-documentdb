/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMechanism, MongoAPIError, MongoParseError, MongoRuntimeError } from 'mongodb';

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
    readonly random?: () => number;
    readonly sampleSrvMaxHosts?: boolean;
}

export type SrvTxtOptionKey = 'authSource' | 'replicaSet' | 'loadBalanced';

export interface RewriteSrvUriResult {
    /** Transient connection string. Never persist or log it. */
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly targets: readonly string[];
    readonly srvTargetCount: number;
    readonly tlsAdded: boolean;
    readonly removedParams: readonly string[];
    readonly txtKeys: readonly string[];
    readonly txtApplied: readonly SrvTxtOptionKey[];
    readonly txtSkipped: readonly string[];
    readonly txtReplicaSet?: string;
    readonly txtLoadBalanced?: string;
}

export type SrvRewriteErrorKind = 'noAddresses' | 'parentDomainMismatch' | 'txtInvalid' | 'optionConflict';

const rewriteErrors = new WeakMap<Error, SrvRewriteErrorKind>();
const txtOptionKeys: readonly SrvTxtOptionKey[] = ['authSource', 'replicaSet', 'loadBalanced'];
const externalMechanisms = new Set<string>([
    AuthMechanism.MONGODB_GSSAPI,
    AuthMechanism.MONGODB_AWS,
    AuthMechanism.MONGODB_OIDC,
    AuthMechanism.MONGODB_X509,
]);

// Keep this split identical to mongodb-connection-string-url's HOSTS_REGEX. In particular,
// an unescaped @ in a query can be interpreted as userinfo by the driver's preflight.
const hostsRegex =
    /^(?<protocol>[^/]+):\/\/(?:(?<username>[^:@]*)(?::(?<password>[^@]*))?@)?(?<hosts>(?!:)[^/?@]*)(?<rest>.*)/;

interface SrvUriParts {
    readonly host: string;
    readonly userinfo: string;
    readonly username: string | undefined;
    readonly password: string | undefined;
    readonly path: string;
    readonly hash: string;
    readonly params: URLSearchParams;
}

function fail(error: Error, kind: SrvRewriteErrorKind): never {
    rewriteErrors.set(error, kind);
    throw error;
}

/** Classifies rewrite errors without modifying the driver's error object. */
export function getSrvRewriteErrorKind(error: unknown): SrvRewriteErrorKind | undefined {
    return error instanceof Error ? rewriteErrors.get(error) : undefined;
}

export function isSrvConnectionString(connectionString: string): boolean {
    return /^mongodb\+srv:\/\//i.test(connectionString);
}

function splitSrvUri(connectionString: string): SrvUriParts {
    if (!isSrvConnectionString(connectionString)) {
        fail(
            new MongoParseError(
                'Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"',
            ),
            'optionConflict',
        );
    }
    const match = hostsRegex.exec(connectionString);
    const groups = match?.groups;
    if (!match || !groups) {
        fail(new MongoParseError(`Invalid connection string "${connectionString}"`), 'optionConflict');
    }
    if (!groups.hosts) {
        fail(new MongoParseError(`Protocol and host list are required in "${connectionString}"`), 'optionConflict');
    }
    const { hosts, protocol, rest, username, password } = groups;
    const hostStart = match[0].length - rest.length - hosts.length;
    const hashStart = rest.indexOf('#');
    const beforeHash = hashStart < 0 ? rest : rest.slice(0, hashStart);
    const queryStart = beforeHash.indexOf('?');
    return {
        host: hosts,
        userinfo: connectionString.slice(protocol.length + 3, hostStart),
        username,
        password,
        path: queryStart < 0 ? beforeHash : beforeHash.slice(0, queryStart),
        hash: hashStart < 0 ? '' : rest.slice(hashStart),
        params: new URLSearchParams(queryStart < 0 ? '' : beforeHash.slice(queryStart + 1)),
    };
}

function objectOptions(options: MongoClientOptions | undefined): Map<string, unknown> {
    return new Map(
        Object.entries(options ?? {})
            .filter(([, value]): boolean => value !== undefined && value !== null)
            .map(([key, value]): [string, unknown] => [key.toLowerCase(), value]),
    );
}

function uriValue(params: URLSearchParams, name: string): string | undefined {
    for (const [key, value] of params) {
        if (key.toLowerCase() === name.toLowerCase()) {
            return value;
        }
    }
    return undefined;
}

function effectiveValue(params: URLSearchParams, options: Map<string, unknown>, name: string): unknown {
    return options.get(name.toLowerCase()) ?? uriValue(params, name);
}

/** Only rejects a non-SRV scheme or an absent host; the caller performs driver preflight. */
export function getSrvLookupTarget(connectionString: string, options?: MongoClientOptions): SrvLookupTarget {
    const parts = splitSrvUri(connectionString);
    const srvServiceName = String(effectiveValue(parts.params, objectOptions(options), 'srvServiceName') ?? 'mongodb');
    return {
        srvHost: parts.host,
        srvServiceName,
        srvQueryName: `_${srvServiceName}._tcp.${parts.host}`,
    };
}

function booleanOption(name: string, value: unknown): boolean {
    if (value === undefined) {
        return false;
    }
    if (value === true || value === 'true') {
        return true;
    }
    if (value === false || value === 'false') {
        return false;
    }
    return fail(new MongoParseError(`${name} must be either "true" or "false"`), 'optionConflict');
}

function maxHostsOption(value: unknown): number {
    if (value === undefined) {
        return 0;
    }
    const parsed = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value), 10);
    if (typeof value !== 'number' && Number.isNaN(parsed)) {
        fail(
            new MongoParseError(`Expected srvMaxHosts to be stringified int value, got: ${String(value)}`),
            'optionConflict',
        );
    }
    if (parsed < 0) {
        fail(
            new MongoParseError(`srvMaxHosts can only be a positive int value, got: ${String(value)}`),
            'optionConflict',
        );
    }
    return parsed;
}

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
        fail(
            new MongoAPIError('Server record does not have at least one more domain level than parent URI'),
            'parentDomainMismatch',
        );
    }
    if (!addressDomain.endsWith(srvHostDomain)) {
        fail(new MongoAPIError('Server record does not share hostname with parent URI'), 'parentDomainMismatch');
    }
}

function hostAddress(record: SrvRecord): string {
    const escapedHost = `${record.name}:${record.port ?? 27017}`.split(' ').join('%20');
    let url: URL;
    try {
        url = new URL(`iLoveJS://${escapedHost}`);
    } catch (cause) {
        const error = new MongoRuntimeError(`Unable to parse ${escapedHost} with URL`);
        if (cause instanceof Error) {
            error.cause = cause;
        }
        return fail(error, 'optionConflict');
    }
    const host = decodeURIComponent(url.hostname).toLowerCase();
    const port = url.port === '' ? 27017 : Number.parseInt(url.port, 10);
    if (port === 0) {
        fail(new MongoParseError('Invalid port (zero) with hostname'), 'optionConflict');
    }
    // HostAddress preserves the trailing dot; it is stripped only for the parent-domain check.
    return `${host}:${port}`;
}

function validateLoadBalancedOptions(
    count: number,
    loadBalanced: boolean,
    replicaSet: string | undefined,
    directConnection: boolean,
    srvMaxHosts: number,
): void {
    if (!loadBalanced) {
        return;
    }
    let message: string | undefined;
    if (count > 1) {
        message = 'loadBalanced option only supported with a single host in the URI';
    } else if (replicaSet) {
        message = 'loadBalanced option not supported with a replicaSet option';
    } else if (directConnection) {
        message = 'loadBalanced option not supported when directConnection is provided';
    } else if (srvMaxHosts > 0) {
        message = 'Cannot limit srv hosts with loadBalanced enabled';
    }
    if (message) {
        fail(new MongoParseError(message), 'optionConflict');
    }
}

interface AuthState {
    readonly mechanism: string;
    readonly hasCredentials: boolean;
}

function authState(parts: SrvUriParts, options: Map<string, unknown>): AuthState {
    const rawMechanism = effectiveValue(parts.params, options, 'authMechanism');
    const mechanism =
        rawMechanism === undefined
            ? AuthMechanism.MONGODB_DEFAULT
            : (Object.values(AuthMechanism).find((value): boolean =>
                  new RegExp(String.raw`\b${String(rawMechanism)}\b`, 'i').test(value),
              ) ?? String(rawMechanism));
    const auth = options.get('auth');
    const username = auth && typeof auth === 'object' && 'username' in auth ? auth.username : parts.username;
    const password = auth && typeof auth === 'object' && 'password' in auth ? auth.password : parts.password;
    const properties = options.get('authmechanismproperties');
    const hasObjectProperties =
        properties !== undefined &&
        properties !== null &&
        typeof properties === 'object' &&
        Object.keys(properties).length > 0;
    const hasUriProperties = Boolean(uriValue(parts.params, 'authMechanismProperties'));
    // parseOptions removes empty DEFAULT credentials, even if authSource was supplied.
    return {
        mechanism,
        hasCredentials:
            Boolean(username || password || hasObjectProperties || hasUriProperties) ||
            mechanism !== AuthMechanism.MONGODB_DEFAULT,
    };
}

function setUriValue(params: URLSearchParams, name: string, value: string): void {
    const existingKey = [...params.keys()].find((key): boolean => key.toLowerCase() === name.toLowerCase());
    params.set(existingKey ?? name, value);
}

function sampleTargets(targets: readonly string[], limit: number, random: () => number): string[] {
    const selected = [...targets];
    if (limit === 0 || limit >= selected.length) {
        return selected;
    }
    // Match the driver's partial Fisher-Yates shuffle (utils.shuffle, topology constructor).
    let remaining = selected.length;
    const lowerBound = selected.length - limit;
    while (remaining > lowerBound) {
        const randomIndex = Math.floor(random() * remaining);
        remaining -= 1;
        [selected[remaining], selected[randomIndex]] = [selected[randomIndex], selected[remaining]];
    }
    return selected.slice(lowerBound);
}

/** Pure rewrite of a preflighted SRV URI. No client construction, DNS, environment access or logging. */
export function rewriteSrvUri(input: RewriteSrvUriInput): RewriteSrvUriResult {
    const parts = splitSrvUri(input.connectionString);
    const suppliedOptions = objectOptions(input.options);
    if (suppliedOptions.has('loadbalanced')) {
        fail(new MongoParseError('loadBalanced is only a valid option in the URI'), 'optionConflict');
    }
    const value = (name: string): unknown => effectiveValue(parts.params, suppliedOptions, name);
    const userSet = (name: string): boolean =>
        suppliedOptions.has(name.toLowerCase()) || uriValue(parts.params, name) !== undefined;
    const directConnection = booleanOption('directConnection', value('directConnection'));
    let loadBalanced = booleanOption('loadBalanced', value('loadBalanced'));
    let replicaSet = value('replicaSet') === undefined ? undefined : String(value('replicaSet'));
    const srvMaxHosts = maxHostsOption(value('srvMaxHosts'));

    // Repeat SRV-specific preflight conflicts, before resolveSRVRecord's validation.
    validateLoadBalancedOptions(1, loadBalanced, replicaSet, directConnection, srvMaxHosts);
    if (directConnection) {
        fail(new MongoAPIError('SRV URI does not support directConnection'), 'optionConflict');
    }
    if (srvMaxHosts > 0 && typeof replicaSet === 'string') {
        fail(new MongoParseError('Cannot use srvMaxHosts option with replicaSet'), 'optionConflict');
    }
    if (input.srvRecords.length === 0) {
        fail(new MongoAPIError('No addresses found at host'), 'noAddresses');
    }
    for (const record of input.srvRecords) {
        checkParentDomainMatch(record.name, parts.host);
    }
    const allTargets = input.srvRecords.map(hostAddress);
    validateLoadBalancedOptions(allTargets.length, loadBalanced, replicaSet, directConnection, srvMaxHosts);

    const txtApplied: SrvTxtOptionKey[] = [];
    const txtSkipped: string[] = [];
    let txtKeys: string[] = [];
    let txtReplicaSet: string | undefined;
    let txtLoadBalanced: string | undefined;
    if (input.txtRecords !== undefined) {
        if (input.txtRecords.length > 1) {
            fail(new MongoParseError('Multiple text records not allowed'), 'txtInvalid');
        }
        let txt: URLSearchParams;
        try {
            txt = new URLSearchParams(input.txtRecords[0].join(''));
        } catch (error) {
            if (error instanceof Error) {
                fail(error, 'txtInvalid');
            }
            throw error;
        }
        txtKeys = [...txt.keys()];
        if (txtKeys.some((key): boolean => !txtOptionKeys.includes(key as SrvTxtOptionKey))) {
            fail(new MongoParseError(`Text record may only set any of: ${txtOptionKeys.join(', ')}`), 'txtInvalid');
        }
        if (txtOptionKeys.some((key): boolean => txt.get(key) === '')) {
            fail(new MongoParseError('Cannot have empty URI params in DNS TXT Record'), 'txtInvalid');
        }
        const source = txt.get('authSource');
        txtReplicaSet = txt.get('replicaSet') ?? undefined;
        txtLoadBalanced = txt.get('loadBalanced') ?? undefined;
        if (source) {
            const auth = authState(parts, suppliedOptions);
            if (userSet('authSource')) {
                txtSkipped.push('authSource:userSet');
            } else if (externalMechanisms.has(auth.mechanism)) {
                txtSkipped.push('authSource:$external');
            } else if (!auth.hasCredentials) {
                txtSkipped.push('authSource:noCredentials');
            } else {
                setUriValue(parts.params, 'authSource', source);
                txtApplied.push('authSource');
            }
        }
        if (txtReplicaSet) {
            if (userSet('replicaSet')) {
                txtSkipped.push('replicaSet:userSet');
            } else {
                replicaSet = txtReplicaSet;
                setUriValue(parts.params, 'replicaSet', txtReplicaSet);
                txtApplied.push('replicaSet');
            }
        }
        if (txtLoadBalanced === 'true') {
            loadBalanced = true;
            setUriValue(parts.params, 'loadBalanced', 'true');
            txtApplied.push('loadBalanced');
        }
        if (replicaSet && srvMaxHosts > 0) {
            fail(new MongoParseError('Cannot combine replicaSet option with srvMaxHosts'), 'optionConflict');
        }
        validateLoadBalancedOptions(allTargets.length, loadBalanced, replicaSet, directConnection, srvMaxHosts);
    }

    const removedParams = ['srvMaxHosts', 'srvServiceName'].filter(userSet);
    const options = { ...input.options };
    for (const key of Object.keys(options)) {
        if (key.toLowerCase() === 'srvmaxhosts' || key.toLowerCase() === 'srvservicename') {
            Reflect.deleteProperty(options, key);
        }
    }
    for (const key of [...parts.params.keys()]) {
        if (key.toLowerCase() === 'srvmaxhosts' || key.toLowerCase() === 'srvservicename') {
            parts.params.delete(key);
        }
    }
    const tlsAdded = !userSet('tls') && !userSet('ssl');
    if (tlsAdded) {
        parts.params.set('tls', 'true');
    }
    const targets =
        input.sampleSrvMaxHosts === false
            ? allTargets
            : sampleTargets(allTargets, srvMaxHosts, input.random ?? Math.random);
    const query = parts.params.toString();
    return {
        connectionString: `mongodb://${parts.userinfo}${targets.join(',')}${parts.path}${query ? `?${query}` : ''}${parts.hash}`,
        options,
        targets,
        srvTargetCount: allTargets.length,
        tlsAdded,
        removedParams,
        txtKeys,
        txtApplied: txtApplied.sort(),
        txtSkipped,
        txtReplicaSet,
        txtLoadBalanced,
    };
}
