/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isIP } from 'node:net';

import { addressFact, type Address, type AddressClass } from '../addressClass.js';
import { nodeNet } from '../io/nodeNet.js';
import { resolveNetworkOptions } from '../networkOptions.js';

import { type Socket } from 'node:net';
import { type BuiltInFindingCode } from '../findingCodes.js';
import { type Check, type CheckOutcome, type Finding, type FindingSeverity, type RunContext } from '../types.js';

interface Attempt extends Address {
    readonly outcome: 'connected' | 'failed';
    readonly errorCode?: string;
    readonly latencyMs: number;
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
        return /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
    }
    return 'unknown';
}

function addresses(context: RunContext): Address[] {
    const dns = context.getResult('dns', context.target);
    if (dns?.skippedBecause?.reason === 'notApplicable' && context.target) {
        const family = isIP(context.target.host);
        return family === 4 || family === 6 ? [{ address: context.target.host, family }] : [];
    }
    const resolved = dns?.facts.osAddresses;
    if ((dns?.status !== 'pass' && dns?.status !== 'warning') || !Array.isArray(resolved)) {
        return [];
    }
    return (resolved as unknown[]).flatMap((entry): Address[] => {
        if (
            entry &&
            typeof entry === 'object' &&
            'address' in entry &&
            'family' in entry &&
            typeof entry.address === 'string' &&
            (entry.family === 4 || entry.family === 6)
        ) {
            return [{ address: entry.address, family: entry.family }];
        }
        return [];
    });
}

export function createTcpCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'tcp',
        scope: 'host',
        dependsOn: ['dns'],
        timeout: 'probe',
        run: async (context, signal): Promise<CheckOutcome<BuiltInFindingCode>> => {
            const options = resolveNetworkOptions(context).values;
            if (options.proxyHost) {
                return {
                    status: 'skipped',
                    skippedBecause: { reason: 'inputUnavailable' },
                    findings: [],
                    facts: { reason: 'proxyConfigured' },
                };
            }
            if (!context.target) {
                return { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' }, findings: [], facts: {} };
            }
            const io = context.io.net ?? nodeNet;
            const clock = context.io.clock;
            const attempts: Attempt[] = [];
            let connectedAddress: Address | null = null;
            let connectionTimeoutExpired = false;
            for (const address of addresses(context)) {
                signal.throwIfAborted();
                const startedAt = clock.now();
                const probeTimeout = context.effectiveTimeout('probe').timeoutMs;
                const timeoutMs = options.connectTimeoutMS;
                const useConnectionTimeout =
                    timeoutMs !== undefined && (probeTimeout === null || timeoutMs < probeTimeout);
                const controller = useConnectionTimeout ? new AbortController() : undefined;
                const attemptSignal = controller?.signal ?? signal;
                const onAbort = (): void => controller?.abort(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
                let timer: unknown;
                let socket: Socket | undefined;
                try {
                    const connect = io.connect({
                        host: address.address,
                        port: context.target.port,
                        family: address.family,
                        signal: attemptSignal,
                    });
                    // Late completion from injected I/O must not leave a socket behind after an abort.
                    void connect.then(
                        (lateSocket): void => {
                            if (attemptSignal.aborted) {
                                lateSocket.destroy();
                            }
                        },
                        (): void => {},
                    );
                    if (useConnectionTimeout) {
                        const expired = new Promise<never>((_, reject): void => {
                            timer = clock.setTimeout((): void => {
                                connectionTimeoutExpired = true;
                                const error = Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' });
                                reject(error);
                                controller?.abort(error);
                            }, timeoutMs);
                        });
                        socket = await Promise.race([connect, expired]);
                    } else {
                        socket = await connect;
                    }
                    signal.throwIfAborted();
                    connectedAddress = { address: address.address, family: address.family };
                    attempts.push({
                        ...connectedAddress,
                        outcome: 'connected',
                        latencyMs: Math.max(0, clock.now() - startedAt),
                    });
                    break;
                } catch (error) {
                    signal.throwIfAborted();
                    attempts.push({
                        address: address.address,
                        family: address.family,
                        outcome: 'failed',
                        errorCode: errorCode(error),
                        latencyMs: Math.max(0, clock.now() - startedAt),
                    });
                } finally {
                    socket?.destroy();
                    if (timer !== undefined) {
                        clock.clearTimeout(timer);
                    }
                    signal.removeEventListener('abort', onAbort);
                }
            }
            const findings: Finding<BuiltInFindingCode>[] = [];
            if (!connectedAddress) {
                const classes = attempts.map((attempt): AddressClass | undefined => addressFact(attempt).class);
                const addressClass =
                    classes.length > 0 && classes.every((value): boolean => value === classes[0])
                        ? classes[0]
                        : undefined;
                for (const code of new Set(attempts.map((attempt): string | undefined => attempt.errorCode))) {
                    const data = {
                        errorCode: code,
                        ...(addressClass === undefined ? {} : { addressClass }),
                        ...(code === 'ETIMEDOUT' && connectionTimeoutExpired ? { source: 'connection' } : {}),
                    };
                    switch (code) {
                        case 'ECONNREFUSED':
                            findings.push(
                                finding(
                                    'tcp.refused',
                                    'error',
                                    data,
                                    addressClass === 'loopback'
                                        ? 'Nothing accepted the connection on this port on this computer; start the local database, container or tunnel that should listen there.'
                                        : 'The connection was refused; check the port, that the service is running, and the local firewall.',
                                ),
                            );
                            break;
                        case 'ETIMEDOUT':
                            findings.push(
                                finding(
                                    'tcp.timeout',
                                    'error',
                                    data,
                                    addressClass === 'loopback'
                                        ? 'The connection on this computer timed out; check the local database, container or tunnel.'
                                        : 'The connection timed out. A firewall or IP allowlist may be blocking it.',
                                ),
                            );
                            break;
                        case 'EHOSTUNREACH':
                        case 'ENETUNREACH':
                            findings.push(
                                finding(
                                    'tcp.unreachable',
                                    'error',
                                    data,
                                    addressClass === 'loopback'
                                        ? 'The local address could not be reached; check the local database, container or tunnel.'
                                        : 'The network route is unavailable; check routing and the VPN connection.',
                                ),
                            );
                            break;
                        case 'ECONNRESET':
                            findings.push(
                                finding(
                                    'tcp.reset',
                                    'error',
                                    data,
                                    addressClass === 'loopback'
                                        ? 'The connection on this computer was reset; check the local database, container or tunnel.'
                                        : 'The server reset the connection.',
                                ),
                            );
                            break;
                    }
                }
            }
            return { status: connectedAddress ? 'pass' : 'fail', findings, facts: { attempts, connectedAddress } };
        },
    };
}
