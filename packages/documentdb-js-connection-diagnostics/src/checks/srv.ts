/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getSrvLookupTarget,
    isSrvConnectionString,
    rewriteSrvUri,
    SRV_FALLBACK_ELIGIBLE_ERROR_CODES,
    SrvRewriteError,
} from '@documentdb-js/srv-resolver';

import { nodeDns } from '../io/nodeDns.js';

import { type FallbackDnsOptions, type SrvFallbackOutcome } from '@documentdb-js/srv-resolver';
import { type SrvRecord } from 'node:dns';
import { type BuiltInFindingCode } from '../findingCodes.js';
import {
    type Check,
    type CheckOutcome,
    type Finding,
    type FindingSeverity,
    type ProbeTarget,
    type RunContext,
} from '../types.js';

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

function parseTarget(target: string): ProbeTarget {
    const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(target);
    if (!match) {
        throw new SrvRewriteError('invalidUri', 'Invalid rewritten target');
    }
    return { host: match[1] ?? match[2], port: Number(match[3]), source: 'srv' };
}

export function createSrvCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'srv',
        scope: 'run',
        dependsOn: ['connectionString'],
        timeout: 'srv',
        run: async (context, signal): Promise<CheckOutcome<BuiltInFindingCode>> => {
            if (!isSrvConnectionString(context.input.connectionString)) {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, findings: [], facts: {} };
            }
            const io = context.io.dns ?? nodeDns;
            const mode = context.input.srvFallbackMode ?? 'auto';
            const timeoutMs = context.effectiveTimeout('srv').timeoutMs;
            const deadlineAt = timeoutMs === null ? Infinity : context.io.clock.now() + timeoutMs;
            const findings: Finding<BuiltInFindingCode>[] = [];
            const facts: Record<string, unknown> = {
                srvQueryName: null,
                resolutionPath: 'node',
                nodeErrorCode: null,
                fallbackOutcome: 'notAttempted',
                dnsServers: [],
                omittedDnsServerCount: 0,
                records: [],
                omittedRecordCount: 0,
                txtOptions: [],
                txtApplied: [],
                tlsImplied: false,
            };
            let nodeErrorCode: string | null = null;
            let fallbackOutcome: SrvFallbackOutcome = 'notAttempted';
            let failed = false;
            try {
                signal.throwIfAborted();
                const target = getSrvLookupTarget(context.input.connectionString);
                facts.srvQueryName = target.srvQueryName;
                const servers = io.getServers();
                facts.dnsServers = servers.slice(0, 32);
                facts.omittedDnsServerCount = Math.max(0, servers.length - 32);
                const [nodeSrv, nodeTxt] = await Promise.allSettled([
                    io.resolveSrv(target.srvQueryName, signal),
                    io.resolveTxt(target.srvHost, signal),
                ]);
                signal.throwIfAborted();
                if (nodeSrv.status === 'rejected') {
                    nodeErrorCode = errorCode(nodeSrv.reason);
                    facts.nodeErrorCode = nodeErrorCode;
                }
                const eligible = nodeErrorCode !== null && SRV_FALLBACK_ELIGIBLE_ERROR_CODES.has(nodeErrorCode);
                const useFallback = mode === 'force' || (mode === 'auto' && eligible);
                let records: SrvRecord[];
                let txtRecords: string[][] | undefined;
                if (useFallback) {
                    facts.resolutionPath = 'fallback';
                    fallbackOutcome = 'failed';
                    const options: FallbackDnsOptions = { servers, signal, deadlineAt };
                    const [srv, txt] = await Promise.allSettled([
                        io.resolveSrvFallback(target.srvQueryName, options),
                        io.resolveTxtFallback(target.srvHost, options),
                    ]);
                    signal.throwIfAborted();
                    if (srv.status === 'rejected') {
                        facts.fallbackErrorCode = errorCode(srv.reason);
                        throw srv.reason;
                    }
                    records = srv.value.records;
                    facts.fallbackTransport = srv.value.transport;
                    if (txt.status === 'fulfilled') {
                        txtRecords = txt.value.records;
                    } else if (!['ENODATA', 'ENOTFOUND'].includes(errorCode(txt.reason))) {
                        facts.fallbackErrorCode = errorCode(txt.reason);
                        throw txt.reason;
                    }
                } else {
                    if (eligible && mode === 'off') {
                        fallbackOutcome = 'disabled';
                    }
                    if (nodeSrv.status === 'rejected') {
                        throw nodeSrv.reason;
                    }
                    records = nodeSrv.value;
                    if (nodeTxt.status === 'fulfilled') {
                        txtRecords = nodeTxt.value;
                    } else if (!['ENODATA', 'ENOTFOUND'].includes(errorCode(nodeTxt.reason))) {
                        throw nodeTxt.reason;
                    }
                }
                facts.records = records
                    .slice(0, 32)
                    .map(({ name, port, priority, weight }): SrvRecord => ({ name, port, priority, weight }));
                facts.omittedRecordCount = Math.max(0, records.length - 32);
                const rewritten = rewriteSrvUri({
                    connectionString: context.input.connectionString,
                    srvRecords: records,
                    txtRecords,
                });
                facts.txtOptions = (txtRecords ?? []).flatMap((chunks): { name: string; value: string }[] =>
                    [...new URLSearchParams(chunks.join(''))]
                        .filter(([name]): boolean => ['authSource', 'replicaSet', 'loadBalanced'].includes(name))
                        .map(([name, value]): { name: string; value: string } => ({ name, value })),
                );
                facts.txtApplied = rewritten.txtApplied;
                facts.tlsImplied = rewritten.tlsAdded;
                signal.throwIfAborted();
                context.setTargets(rewritten.targets.map(parseTarget));
                if (useFallback) {
                    fallbackOutcome = 'succeeded';
                }
            } catch (error) {
                signal.throwIfAborted();
                failed = true;
                if (error instanceof SrvRewriteError) {
                    switch (error.kind) {
                        case 'noAddresses':
                            findings.push(
                                finding('srv.notFound', 'error', {}, 'No SRV targets were found for this service.'),
                            );
                            break;
                        case 'parentDomainMismatch':
                            findings.push(
                                finding(
                                    'srv.targetOutsideDomain',
                                    'error',
                                    {},
                                    'An SRV target is outside the service host’s parent domain.',
                                ),
                            );
                            break;
                        case 'txtInvalid':
                            findings.push(
                                finding(
                                    'srv.txtUnsupportedOption',
                                    'error',
                                    {},
                                    'The DNS TXT records contain unsupported or invalid connection options.',
                                ),
                            );
                            break;
                        case 'invalidUri':
                            facts.rewriteError = 'invalidUri';
                            break;
                    }
                } else if (['ENOTFOUND', 'ENODATA'].includes(errorCode(error))) {
                    findings.push(finding('srv.notFound', 'error', {}, 'No SRV targets were found for this service.'));
                }
            }
            facts.fallbackOutcome = fallbackOutcome;
            if (nodeErrorCode !== null && SRV_FALLBACK_ELIGIBLE_ERROR_CODES.has(nodeErrorCode)) {
                findings.push(
                    finding(
                        'srv.compressedReplyRejected',
                        fallbackOutcome === 'succeeded' ? 'info' : 'error',
                        { nodeErrorCode, fallbackOutcome },
                        fallbackOutcome === 'succeeded'
                            ? 'Node.js rejected the SRV reply; the fallback resolver resolved the service.'
                            : 'Node.js rejected the SRV reply and the fallback resolver did not resolve the service.',
                    ),
                );
            }
            return {
                status: failed || findings.some((entry): boolean => entry.severity === 'error') ? 'fail' : 'pass',
                findings,
                facts,
            };
        },
    };
}
