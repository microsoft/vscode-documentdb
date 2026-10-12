/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dns from 'node:dns';
import { FALLBACK_MAX_DEADLINE_MS } from './constants';
import { FallbackDnsError, resolveSrvFallback, resolveTxtFallback } from './fallbackDnsClient';
import { getSrvLookupTarget, isSrvConnectionString, rewriteSrvUri, SrvRewriteError } from './srvUriRewrite';
import { cancellationError, noopLogger, throwIfCancelled } from './types';

import { type MongoClientOptions } from 'mongodb';
import { type SrvRecord } from 'node:dns';
import { type FallbackDnsOptions } from './fallbackDnsClient';
import { type SrvFallbackMode, type SrvResolutionPath, type SrvResolutionReport } from './report';
import { type SrvResolverLogger } from './types';

export interface ResolveSrvForDriverInput {
    readonly connectionString: string;
    readonly options?: MongoClientOptions;
    readonly fallback?: SrvFallbackMode;
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
    readonly logger?: SrvResolverLogger;
    readonly logPrefix?: string;
    readonly logContext?: string;
    readonly onReport?: (report: SrvResolutionReport) => void;
}

export interface ResolveSrvForDriverResult {
    /** Transient: never persist or log. */
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly path: SrvResolutionPath | 'notSrv';
    readonly report?: SrvResolutionReport;
}

type MutableReport = { -readonly [K in keyof SrvResolutionReport]: SrvResolutionReport[K] };

const eligibleCodes = new Set(['EBADRESP', 'EFORMERR', 'ECONNREFUSED']);

function errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        // Codes are categorical data. Never forward arbitrary driver text to trace or telemetry.
        return /^E[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
    }
    return 'unknown';
}

async function probeSrv(name: string, signal: AbortSignal | undefined): Promise<SrvRecord[]> {
    const resolver = new dns.promises.Resolver();
    const onAbort = (): void => resolver.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return await resolver.resolveSrv(name);
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * Probes SRV with Node's resolver. If Node rejects the DNS reply itself, resolves SRV and TXT with
 * our own client against the same DNS servers and returns an equivalent `mongodb://` string.
 * Otherwise returns the original string, so the driver keeps its own SRV handling and errors.
 */
export async function resolveSrvForDriver(input: ResolveSrvForDriverInput): Promise<ResolveSrvForDriverResult> {
    const options = input.options ?? {};
    if (!isSrvConnectionString(input.connectionString)) {
        return { connectionString: input.connectionString, options, path: 'notSrv' };
    }
    const { signal } = input;
    const mode = input.fallback ?? 'auto';
    const logger = input.logger ?? noopLogger;
    const logPrefix = input.logPrefix ?? '[SrvResolution]';
    const trace = (line: string): void => logger.trace(`${logPrefix} ${line}`);
    const report: MutableReport = {
        srvHost: '',
        path: 'node',
        outcome: 'failed',
        nodeErrorCode: 'none',
        fallbackOutcome: 'notAttempted',
        dnsServers: [],
        forcedFallback: mode === 'force',
        aresVersion: process.versions.ares ?? 'unknown',
        nodeRuntimeVersion: process.versions.node,
    };
    let probeError: unknown;
    let fallbackStartedAt: number | undefined;
    try {
        throwIfCancelled(signal);
        const target = getSrvLookupTarget(input.connectionString, options);
        report.srvHost = target.srvHost;
        report.dnsServers = dns.getServers();
        trace(
            `start ${input.logContext ?? ''} srvHost=${target.srvHost} service=${target.srvServiceName} ares=${report.aresVersion} node=${report.nodeRuntimeVersion} dnsServers=[${report.dnsServers.join(',')}] forced=${report.forcedFallback}`,
        );

        const probeStartedAt = Date.now();
        try {
            report.srvTargetCount = (await probeSrv(target.srvQueryName, signal)).length;
        } catch (error) {
            throwIfCancelled(signal);
            probeError = error;
            report.path = 'nodeErrorPassthrough';
            report.nodeErrorCode = errorCode(error);
        }
        report.nodeProbeDurationMs = Date.now() - probeStartedAt;
        const eligible = eligibleCodes.has(report.nodeErrorCode);
        const runFallback = mode === 'force' || (mode === 'auto' && eligible);
        const next = runFallback ? 'running fallback' : 'original +srv handed to driver';
        trace(
            probeError === undefined
                ? `node probe ok targets=${report.srvTargetCount} durationMs=${report.nodeProbeDurationMs} → ${next}`
                : `node probe failed code=${report.nodeErrorCode} durationMs=${report.nodeProbeDurationMs} ${eligible ? '(fallback-eligible)' : '(not fallback-eligible)'} → ${next}`,
        );
        if (!runFallback) {
            if (mode === 'off' && eligible) {
                report.fallbackOutcome = 'disabled';
                trace('fallback disabled by DOCUMENTDB_DISABLE_SRV_FALLBACK');
            }
            report.outcome = 'succeeded';
            return { connectionString: input.connectionString, options, path: report.path, report };
        }

        fallbackStartedAt = Date.now();
        report.path = 'fallback';
        report.fallbackOutcome = 'failed';
        const dnsOptions: FallbackDnsOptions = {
            deadlineAt:
                fallbackStartedAt + Math.min(input.deadlineMs ?? FALLBACK_MAX_DEADLINE_MS, FALLBACK_MAX_DEADLINE_MS),
            signal,
            servers: report.dnsServers,
            logger,
            logPrefix,
        };
        const [srv, txt] = await Promise.allSettled([
            resolveSrvFallback(target.srvQueryName, dnsOptions),
            resolveTxtFallback(target.srvHost, dnsOptions),
        ]);
        throwIfCancelled(signal);
        if (srv.status === 'rejected') {
            throw srv.reason;
        }
        report.fallbackTransport = srv.value.transport;
        report.fallbackServersTried = srv.value.serversTried;
        report.srvTargetCount = srv.value.records.length;
        let txtRecords: string[][] | undefined;
        if (txt.status === 'fulfilled') {
            txtRecords = txt.value.records;
            report.txtSource = 'fallback';
        } else if (['ENODATA', 'ENOTFOUND'].includes(errorCode(txt.reason))) {
            report.txtSource = 'none';
        } else {
            throw txt.reason;
        }

        const rewritten = rewriteSrvUri({
            connectionString: input.connectionString,
            options,
            srvRecords: srv.value.records,
            txtRecords,
        });
        report.outcome = 'succeeded';
        report.fallbackOutcome = 'succeeded';
        report.fallbackDurationMs = Date.now() - fallbackStartedAt;
        trace(
            `rewrite targets=[${rewritten.targets.join(',')}] tlsAdded=${rewritten.tlsAdded} txtSource=${report.txtSource} txtApplied=[${rewritten.txtApplied.join(',')}]`,
        );
        trace(
            probeError === undefined
                ? `forced fallback applied for ${target.srvHost}; resolved ${srv.value.records.length} SRV targets via ${srv.value.server} (${srv.value.transport}). See issue #993.`
                : `DNS reply for ${target.srvHost} was rejected by Node.js (${report.nodeErrorCode}, c-ares ${report.aresVersion}); resolved ${srv.value.records.length} SRV targets via ${srv.value.server} (${srv.value.transport}) instead. See issue #993.`,
        );
        return { connectionString: rewritten.connectionString, options: rewritten.options, path: 'fallback', report };
    } catch (error) {
        if (signal?.aborted) {
            report.outcome = 'cancelled';
            throw cancellationError(signal);
        }
        if (fallbackStartedAt === undefined) {
            throw error;
        }
        report.fallbackErrorCode =
            error instanceof SrvRewriteError
                ? error.kind
                : error instanceof FallbackDnsError
                  ? `${error.syscall === 'queryTxt' ? 'txt:' : ''}${error.code}`
                  : errorCode(error);
        if (error instanceof FallbackDnsError) {
            report.fallbackServersTried = error.serversTried;
        }
        report.fallbackDurationMs = Date.now() - fallbackStartedAt;
        // A rewrite rejection explains itself; a DNS failure is better explained by the original error.
        const reportOriginal = probeError !== undefined && !(error instanceof SrvRewriteError);
        trace(
            `SRV fallback failed code=${report.fallbackErrorCode} serversTried=${report.fallbackServersTried ?? 0} durationMs=${report.fallbackDurationMs}; the ${reportOriginal ? 'original' : 'fallback'} error is reported`,
        );
        throw reportOriginal ? probeError : error;
    } finally {
        try {
            input.onReport?.(report);
        } catch {
            // Observability must never change the driver's result or the original error.
        }
    }
}
