/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as connectionStringUrl from 'mongodb-connection-string-url';

import { describeNetworkOptions, resolveNetworkOptions } from '../networkOptions.js';

import { URI_OPTIONS } from './uriOptions.js';

import { type BuiltInFindingCode } from '../findingCodes.js';
import {
    type Check,
    type CheckOutcome,
    type Finding,
    type FindingSeverity,
    type RunContext,
    type WireCompressor,
} from '../types.js';

interface Host {
    readonly host: string;
    readonly port?: number;
}

interface OptionFact {
    readonly name: string;
    readonly value?: string;
    readonly valueSupplied: true;
    readonly known: boolean;
    readonly sensitive: boolean;
}

type ParseFailure = 'invalidScheme' | 'invalidHost' | 'invalidPort' | 'other';

const optionsByName = new Map(
    Object.entries(URI_OPTIONS).map(([name, descriptor]): [string, typeof descriptor] => [
        name.toLowerCase(),
        descriptor,
    ]),
);
const aliases: Readonly<Record<string, string>> = {
    sslcertificatekeyfile: 'tlsCertificateKeyFile',
    sslcafile: 'tlsCAFile',
    sslpemkeyfile: 'tlsCertificateKeyFile',
    sslpemkeypassword: 'tlsCertificateKeyFilePassword',
    sslcert: 'tlsCertificateKeyFile',
    sslinvalidcertificates: 'tlsAllowInvalidCertificates',
    sslinvalidhostnameallowed: 'tlsAllowInvalidHostnames',
};

function finding(
    code: BuiltInFindingCode,
    severity: FindingSeverity,
    data: Readonly<Record<string, unknown>>,
    text: string,
): Finding<BuiltInFindingCode> {
    return { code, severity, data, detail: { language: 'en', text } };
}

function scanAuthority(uri: string, findings: Finding<BuiltInFindingCode>[]): string[] {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return [];
    }
    const body = uri.slice(schemeEnd + 3).split(/[?#]/, 1)[0];
    const userInfoEnd = body.lastIndexOf('@');
    if (userInfoEnd !== -1) {
        const userInfo = body.slice(0, userInfoEnd);
        // Multiple colons are ambiguous; the final separator exposes an unescaped colon in the user name.
        const separator = userInfo.lastIndexOf(':');
        const parts = {
            username: separator === -1 ? userInfo : userInfo.slice(0, separator),
            password: separator === -1 ? '' : userInfo.slice(separator + 1),
        };
        for (const part of ['username', 'password'] as const) {
            const characters = new Set<string>();
            for (let index = 0; index < parts[part].length; index++) {
                const character = parts[part][index];
                if (
                    character === '@' ||
                    character === '/' ||
                    (part === 'username' && character === ':') ||
                    (character === '%' && !/^[\da-f]{2}$/i.test(parts[part].slice(index + 1, index + 3)))
                ) {
                    characters.add(character);
                }
            }
            for (const character of characters) {
                findings.push(
                    finding(
                        'cs.unencodedReservedCharacter',
                        'error',
                        { part, character },
                        `Percent-encode the reserved character ${character} in the ${part}.`,
                    ),
                );
            }
        }
    }
    const hostList = body.slice(userInfoEnd + 1).split('/', 1)[0];
    const hosts = hostList.split(',');
    if (uri.startsWith('mongodb+srv://')) {
        if (hosts.length > 1) {
            findings.push(
                finding(
                    'cs.srvMultipleHosts',
                    'error',
                    {},
                    'An SRV connection string must contain exactly one service host.',
                ),
            );
        }
        if (hosts.some((host): boolean => (host.startsWith('[') ? host.includes(']:') : host.includes(':')))) {
            findings.push(
                finding('cs.srvWithPort', 'error', {}, 'Remove the explicit port from the SRV connection string.'),
            );
        }
    }
    return hosts;
}

function editDistance(left: string, right: string): number {
    let previous = Array.from({ length: right.length + 1 }, (_, index): number => index);
    for (let row = 1; row <= left.length; row++) {
        const current = [row];
        for (let column = 1; column <= right.length; column++) {
            current.push(
                Math.min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
                ),
            );
        }
        previous = current;
    }
    return previous[right.length];
}

function suggestOption(name: string): string | undefined {
    const normalized = name.toLowerCase();
    if (Object.hasOwn(aliases, normalized)) {
        return aliases[normalized];
    }
    let suggestion: string | undefined;
    let closestDistance = 4;
    for (const candidate of Object.keys(URI_OPTIONS)) {
        const normalizedCandidate = candidate.toLowerCase();
        if (Math.abs(normalized.length - normalizedCandidate.length) > 3) {
            continue;
        }
        const distance = editDistance(normalized, normalizedCandidate);
        if (distance < closestDistance) {
            suggestion = candidate;
            closestDistance = distance;
        }
    }
    return suggestion;
}

function parseHosts(values: readonly string[], isSRV: boolean): Host[] | ParseFailure {
    const hosts: Host[] = [];
    for (const value of values) {
        const match = value.match(/^(?:\[([^\]]+)\]|([^:[\]]+))(?::([^:]*))?$/);
        if (!match) {
            return 'invalidHost';
        }
        const portText = match[3];
        const port = portText === undefined ? 27017 : Number(portText);
        if (portText !== undefined && (!/^\d+$/.test(portText) || port < 1 || port > 65535)) {
            return 'invalidPort';
        }
        try {
            const url = new URL(`mongodb://${value}`);
            if (!url.hostname || url.username || url.password) {
                return 'invalidHost';
            }
            const host = match[1] ?? match[2];
            hosts.push(isSRV ? { host } : { host, port });
        } catch {
            return 'invalidHost';
        }
    }
    return hosts;
}

function collectOptions(
    uri: connectionStringUrl.ConnectionString,
    findings: Finding<BuiltInFindingCode>[],
): OptionFact[] {
    const options: OptionFact[] = [];
    for (const [name, value] of uri.searchParams) {
        const descriptor = optionsByName.get(name.toLowerCase());
        const sensitive = descriptor?.sensitive ?? true;
        options.push({
            name,
            valueSupplied: true,
            known: descriptor !== undefined,
            sensitive,
            ...(descriptor && !sensitive ? { value } : {}),
        });
        if (!descriptor) {
            const suggestion = suggestOption(name);
            findings.push(
                finding(
                    'cs.unknownOption',
                    'error',
                    { option: name, ...(suggestion ? { suggestion } : {}) },
                    suggestion
                        ? `The option ${name} is not supported; consider ${suggestion}.`
                        : `The option ${name} is not supported.`,
                ),
            );
        } else if (descriptor.deprecated) {
            const replacement = descriptor.replacement;
            findings.push(
                finding(
                    'cs.optionIgnoredByDriver',
                    'warning',
                    { option: name, ...(replacement ? { replacement } : {}) },
                    replacement
                        ? `The option ${name} is deprecated by the driver; use ${replacement} instead.`
                        : `The option ${name} is deprecated by the driver.`,
                ),
            );
        }
    }
    return options;
}

function inspectSettings(
    uri: connectionStringUrl.ConnectionString,
    compressors: readonly string[],
    available: readonly WireCompressor[],
    findings: Finding<BuiltInFindingCode>[],
): void {
    const options = uri.searchParams;
    const ssl = options.get('ssl');
    const tls = options.get('tls');
    if (ssl !== null && tls !== null && ssl !== tls) {
        findings.push(
            finding(
                'cs.conflictingTlsOptions',
                'error',
                {},
                'The ssl and tls options disagree; use one consistent TLS setting.',
            ),
        );
    }
    const disabled = ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames'].filter(
        (name): boolean => options.get(name) === 'true',
    );
    if (disabled.length > 0) {
        findings.push(
            finding(
                'cs.tlsVerificationDisabled',
                'warning',
                { options: disabled },
                `TLS verification is disabled by ${disabled.join(', ')}; enable certificate and host name verification.`,
            ),
        );
    }
    if (options.get('directConnection') === 'true' && uri.hosts.length > 1) {
        findings.push(
            finding(
                'cs.directConnectionWithMultipleHosts',
                'error',
                {},
                'A direct connection must specify only one host.',
            ),
        );
    }
    const authSource = options.get('authSource');
    if (authSource !== null && authSource !== 'admin' && authSource !== '$external') {
        findings.push(
            finding(
                'cs.authSourceUnusual',
                'info',
                { authSource },
                'The authentication source is neither admin nor $external; confirm it is intended.',
            ),
        );
    }
    for (const compressor of compressors) {
        if (!available.some((name): boolean => name === compressor)) {
            findings.push(
                finding(
                    'cs.compressorUnavailable',
                    'warning',
                    { compressor, available },
                    `The compressor ${compressor} is unavailable; remove it from compressors or put zlib first.`,
                ),
            );
        }
    }
}

export function createConnectionStringCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'connectionString',
        scope: 'run',
        run: async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
            const findings: Finding<BuiltInFindingCode>[] = [];
            const input = context.input.connectionString;
            const availableCompressors: readonly WireCompressor[] = context.input.availableCompressors ?? ['zlib'];
            const rawHosts = scanAuthority(input, findings);
            if (findings.some((entry): boolean => entry.code === 'cs.unencodedReservedCharacter')) {
                // An ambiguous authority can make the parser expose password fragments as other URI fields.
                return { status: 'fail', findings, facts: { availableCompressors } };
            }
            let facts: Readonly<Record<string, unknown>> = { availableCompressors };
            let failure: ParseFailure | undefined;
            try {
                const uri = new connectionStringUrl.ConnectionString(input);
                const hosts = parseHosts(uri.hosts, uri.isSRV);
                if (typeof hosts === 'string') {
                    failure = hosts;
                } else {
                    const database = uri.pathname.length > 1 ? decodeURIComponent(uri.pathname.slice(1)) : null;
                    const userName = uri.username ? decodeURIComponent(uri.username) : null;
                    const options = collectOptions(uri, findings);
                    const compressors = uri.searchParams
                        .getAll('compressors')
                        .flatMap((value): string[] => value.split(','))
                        .filter((value): boolean => value !== '');
                    inspectSettings(uri, compressors, availableCompressors, findings);
                    facts = {
                        scheme: uri.isSRV ? 'mongodb+srv' : 'mongodb',
                        hosts,
                        database,
                        userName,
                        passwordPresent: uri.password !== '',
                        options,
                        compressors,
                        availableCompressors,
                    };
                    if (!uri.isSRV) {
                        context.setTargets(
                            hosts.map((host): { host: string; port: number; source: 'uri' } => ({
                                host: host.host,
                                port: host.port ?? 27017,
                                source: 'uri',
                            })),
                        );
                    }
                }
            } catch {
                if (!input.startsWith('mongodb://') && !input.startsWith('mongodb+srv://')) {
                    failure = 'invalidScheme';
                } else if (rawHosts.length === 0 || rawHosts.some((host): boolean => host === '')) {
                    failure = 'invalidHost';
                } else {
                    failure = 'other';
                }
            }
            if (failure && !findings.some((entry): boolean => entry.severity === 'error')) {
                findings.push(
                    finding(
                        'cs.unparseable',
                        'error',
                        { reason: failure },
                        'The connection string could not be parsed; check its URI syntax.',
                    ),
                );
            }
            let status: 'pass' | 'warning' | 'fail' = 'pass';
            if (findings.some((entry): boolean => entry.severity === 'error')) {
                status = 'fail';
            } else if (findings.some((entry): boolean => entry.severity === 'warning')) {
                status = 'warning';
            }
            return {
                status,
                findings,
                facts: { ...facts, effectiveNetworkOptions: describeNetworkOptions(resolveNetworkOptions(context)) },
            };
        },
    };
}
