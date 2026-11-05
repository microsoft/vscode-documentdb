/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BlockList, isIP } from 'node:net';

import { nodeDns } from '../io/nodeDns.js';
import { SAFETY_LIMITS } from '../timeouts.js';

import { type BuiltInFindingCode } from '../findingCodes.js';
import {
    type Check,
    type CheckOutcome,
    type CheckStatus,
    type DnsIo,
    type Finding,
    type FindingSeverity,
    type RunContext,
} from '../types.js';

type AddressClass = 'public' | 'private' | 'loopback' | 'linkLocal';

interface Address {
    readonly address: string;
    readonly family: 4 | 6;
}

interface AddressFact extends Address {
    readonly class: AddressClass;
}

interface CaresResult {
    readonly addresses: readonly Address[];
    readonly errorCode: string | null;
}

interface CnameResult {
    readonly chain: readonly string[];
    readonly errorCode: string | null;
}

function ranges(subnets: readonly [string, number][]): BlockList {
    const list = new BlockList();
    for (const [address, prefix] of subnets) {
        list.addSubnet(address, prefix, isIP(address) === 4 ? 'ipv4' : 'ipv6');
    }
    return list;
}

const loopback = ranges([
    ['127.0.0.0', 8],
    ['::1', 128],
]);
const linkLocal = ranges([
    ['169.254.0.0', 16],
    ['fe80::', 10],
]);
const privateAddresses = ranges([
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
    ['fc00::', 7],
]);

function addressFact(address: Address): AddressFact {
    const family = address.family === 4 ? 'ipv4' : 'ipv6';
    let classification: AddressClass = 'public';
    if (loopback.check(address.address, family)) {
        classification = 'loopback';
    } else if (linkLocal.check(address.address, family)) {
        classification = 'linkLocal';
    } else if (privateAddresses.check(address.address, family)) {
        classification = 'private';
    }
    return { address: address.address, family: address.family, class: classification };
}

function finding(
    code: BuiltInFindingCode,
    severity: FindingSeverity,
    data: Readonly<Record<string, unknown>>,
    text: string,
): Finding<BuiltInFindingCode> {
    return { code, severity, data, detail: { language: 'en', text } };
}

function errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        return /^E[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
    }
    return 'unknown';
}

async function caresAddresses(io: DnsIo, host: string, signal: AbortSignal): Promise<CaresResult> {
    const results = await Promise.allSettled([io.resolve4(host, signal), io.resolve6(host, signal)]);
    const addresses: Address[] = [];
    let code: string | null = null;
    for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
            addresses.push(...result.value.map((address): Address => ({ address, family: index === 0 ? 4 : 6 })));
        } else {
            const rejectedCode = errorCode(result.reason);
            // A missing address family is normal when the other family resolves.
            if (!['ENODATA', 'ENOTFOUND'].includes(rejectedCode)) {
                code ??= rejectedCode;
            }
        }
    }
    if (addresses.length === 0 && code === null) {
        const rejected = results.find((result): boolean => result.status === 'rejected');
        if (rejected?.status === 'rejected') {
            code = errorCode(rejected.reason);
        }
    }
    return { addresses, errorCode: code };
}

async function cnameChain(io: DnsIo, host: string, signal: AbortSignal): Promise<CnameResult> {
    const chain: string[] = [];
    const seen = new Set([host.toLowerCase().replace(/\.$/, '')]);
    let current = host;
    for (let hop = 0; hop < 8; hop++) {
        signal.throwIfAborted();
        let names: string[];
        try {
            names = await io.resolveCname(current, signal);
        } catch (error) {
            const code = errorCode(error);
            return { chain, errorCode: ['ENODATA', 'ENOTFOUND'].includes(code) ? null : code };
        }
        const next = names[0];
        if (next === undefined) {
            break;
        }
        const normalized = next.toLowerCase().replace(/\.$/, '');
        if (seen.has(normalized)) {
            break;
        }
        chain.push(next);
        seen.add(normalized);
        current = next;
    }
    return { chain, errorCode: null };
}

function addressKey(address: Address): string {
    return address.family === 6 ? new URL(`http://[${address.address}]`).hostname : address.address;
}

function sameAddresses(os: readonly Address[], cares: readonly Address[]): boolean {
    const osSet = new Set(os.map(addressKey));
    const caresSet = new Set(cares.map(addressKey));
    return osSet.size === caresSet.size && [...osSet].every((address): boolean => caresSet.has(address));
}

export function createDnsCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'dns',
        scope: 'host',
        timeout: 'probe',
        run: async (context, signal): Promise<CheckOutcome<BuiltInFindingCode>> => {
            if (!context.target) {
                return { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' }, findings: [], facts: {} };
            }
            const host = context.target.host;
            if (isIP(host)) {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, findings: [], facts: {} };
            }
            signal.throwIfAborted();
            const io = context.io.dns ?? nodeDns;
            const [os, cares, cnames] = await Promise.allSettled([
                io.lookup(host),
                caresAddresses(io, host, signal),
                cnameChain(io, host, signal),
            ]);
            signal.throwIfAborted();
            const osAddresses = os.status === 'fulfilled' ? os.value.map(addressFact) : [];
            const resolvedCares = cares.status === 'fulfilled' ? cares.value.addresses.map(addressFact) : [];
            const chain = cnames.status === 'fulfilled' ? cnames.value.chain : [];
            const osErrorCode = os.status === 'rejected' ? errorCode(os.reason) : null;
            let caresErrorCode = cares.status === 'fulfilled' ? cares.value.errorCode : errorCode(cares.reason);
            caresErrorCode ??= cnames.status === 'fulfilled' ? cnames.value.errorCode : errorCode(cnames.reason);
            const findings: Finding<BuiltInFindingCode>[] = [];
            if (osErrorCode === 'ENOTFOUND') {
                findings.push(finding('dns.notFound', 'error', {}, 'The operating system could not find this host.'));
            } else if (osErrorCode === 'EAI_AGAIN') {
                findings.push(
                    finding(
                        'dns.temporaryFailure',
                        'error',
                        {},
                        'The operating system reported a temporary DNS resolution failure.',
                    ),
                );
            }
            if (os.status === 'fulfilled') {
                if (caresErrorCode !== null || !sameAddresses(osAddresses, resolvedCares)) {
                    findings.push(
                        finding(
                            'dns.resolversDisagree',
                            'warning',
                            {
                                osAddressCount: new Set(osAddresses.map(addressKey)).size,
                                caresAddressCount: new Set(resolvedCares.map(addressKey)).size,
                                ...(caresErrorCode === null ? {} : { caresErrorCode }),
                            },
                            'The operating system and c-ares resolvers returned different results; the connection uses the operating system resolver.',
                        ),
                    );
                }
                if (osAddresses.some((address): boolean => address.class === 'loopback')) {
                    findings.push(
                        finding(
                            'dns.loopback',
                            'info',
                            {},
                            'This host resolves to a loopback address on this computer.',
                        ),
                    );
                }
                const privateEndpoint = chain.some((name): boolean =>
                    name.toLowerCase().split('.').includes('privatelink'),
                );
                if (privateEndpoint && osAddresses.some((address): boolean => address.class === 'private')) {
                    findings.push(
                        finding(
                            'dns.privateEndpoint',
                            'info',
                            {},
                            'The host name has an Azure private-link alias that resolves to a private address.',
                        ),
                    );
                } else if (
                    privateEndpoint &&
                    osAddresses.length > 0 &&
                    osAddresses.every((address): boolean => address.class === 'public')
                ) {
                    findings.push(
                        finding(
                            'dns.privateEndpointPublicAddress',
                            'info',
                            {},
                            "The host name has an Azure private-link alias that resolves to public addresses; this is the normal answer outside the resource's private network.",
                        ),
                    );
                }
            }
            let status: CheckStatus = 'pass';
            if (os.status === 'rejected' || findings.some((entry): boolean => entry.severity === 'error')) {
                status = 'fail';
            } else if (findings.some((entry): boolean => entry.severity === 'warning')) {
                status = 'warning';
            }
            return {
                status,
                findings,
                facts: {
                    osAddresses: osAddresses.slice(0, SAFETY_LIMITS.maxAddressesPerHost),
                    caresAddresses: resolvedCares.slice(0, SAFETY_LIMITS.maxAddressesPerHost),
                    omittedAddressCount: {
                        os: Math.max(0, osAddresses.length - SAFETY_LIMITS.maxAddressesPerHost),
                        cares: Math.max(0, resolvedCares.length - SAFETY_LIMITS.maxAddressesPerHost),
                    },
                    cnameChain: chain,
                    osErrorCode,
                    caresErrorCode,
                },
            };
        },
    };
}
