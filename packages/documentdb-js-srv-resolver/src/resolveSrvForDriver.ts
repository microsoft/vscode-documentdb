/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import * as dns from 'node:dns';
import { FALLBACK_MAX_DEADLINE_MS } from './constants';
import { FallbackDnsError, resolveSrvFallback, resolveTxtFallback } from './fallbackDnsClient';
import { getSrvLookupTarget, getSrvRewriteErrorKind, isSrvConnectionString, rewriteSrvUri } from './srvUriRewrite';
import { cancellationError, noopLogger, SrvResolutionCancelledError, throwIfCancelled } from './types';

import { type MongoClientOptions } from 'mongodb';
import { type SrvRecord } from 'node:dns';
import { type FallbackSrvResult } from './fallbackDnsClient';
import { type SrvFallbackMode, type SrvResolutionPath, type SrvResolutionReport } from './report';
import { type SrvResolverLogger } from './types';

export interface SrvProbeResolver {
    resolveSrv(hostname: string): Promise<SrvRecord[]>;
    cancel(): void;
}

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
    /** Internal test seams; production callers should use the defaults. */
    readonly createProbeResolver?: () => SrvProbeResolver;
    readonly fallbackDns?: {
        readonly resolveSrv: typeof resolveSrvFallback;
        readonly resolveTxt: typeof resolveTxtFallback;
    };
    readonly getServers?: () => string[];
    readonly createPreflightClient?: (connectionString: string, options: MongoClientOptions) => unknown;
}

export interface ResolveSrvForDriverResult {
    /** Transient: never persist or log. */
    readonly connectionString: string;
    readonly options: MongoClientOptions;
    readonly path: SrvResolutionPath | 'notSrv';
    readonly report?: SrvResolutionReport;
}

const eligibleCodes = new Set(['EBADRESP', 'EFORMERR', 'ECONNREFUSED']);

function errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
        // Codes are categorical data. Never forward arbitrary driver text to trace or telemetry.
        return /^E[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
    }
    return 'unknown';
}

function isCancellation(error: unknown): boolean {
    return (
        error instanceof SrvResolutionCancelledError ||
        (typeof error === 'object' &&
            error !== null &&
            '_isUserCancelledError' in error &&
            error._isUserCancelledError === true)
    );
}

/** Reject immediately on abort, even when an injected resolver never settles after cancel(). */
async function cancellable<T>(operation: () => Promise<T>, signal?: AbortSignal, cancel?: () => void): Promise<T> {
    throwIfCancelled(signal);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject): void => {
        if (signal) {
            onAbort = (): void => {
                reject(cancellationError(signal));
                cancel?.();
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
    try {
        const result = await Promise.race([
            Promise.resolve().then((): Promise<T> => {
                throwIfCancelled(signal);
                return operation();
            }),
            aborted,
        ]);
        throwIfCancelled(signal);
        return result;
    } catch (error) {
        throwIfCancelled(signal);
        throw error;
    } finally {
        if (onAbort) {
            signal?.removeEventListener('abort', onAbort);
        }
    }
}

function preflightOptions(connectionString: string, options: MongoClientOptions): MongoClientOptions {
    const copy = { ...options };
    const params = new URLSearchParams(connectionString.slice(connectionString.indexOf('?') + 1));
    const uriOption = (name: string): string | undefined => {
        for (const [key, value] of params) {
            if (key.toLowerCase() === name.toLowerCase()) {
                return value;
            }
        }
        return undefined;
    };
    const mechanism = options.authMechanism ?? uriOption('authMechanism');
    if (mechanism !== 'MONGODB-OIDC') {
        return copy;
    }
    const properties = options.authMechanismProperties;
    const uriProperties = uriOption('authMechanismProperties') ?? '';
    const hasOidcProvider = ['OIDC_CALLBACK', 'OIDC_HUMAN_CALLBACK', 'ENVIRONMENT'].some(
        (key): boolean =>
            (properties?.[key] !== undefined && properties?.[key] !== null) ||
            uriProperties.split(',').some((property): boolean => property.split(':')[0] === key),
    );
    if (!hasOidcProvider) {
        copy.authMechanismProperties = {
            ...properties,
            OIDC_CALLBACK: async (): Promise<never> => {
                throw new Error('SRV preflight must never invoke an OIDC callback');
            },
        };
    }
    return copy;
}

export async function resolveSrvForDriver(input: ResolveSrvForDriverInput): Promise<ResolveSrvForDriverResult> {
    const options = input.options ?? {};
    if (!isSrvConnectionString(input.connectionString)) {
        return { connectionString: input.connectionString, options, path: 'notSrv' };
    }
    const mode = input.fallback ?? 'auto';
    const logger = input.logger ?? noopLogger;
    const trace = (line: string): void => logger.trace(`${input.logPrefix ?? '[SrvResolution]'} ${line}`);
    let report: SrvResolutionReport = {
        srvHost: '',
        srvServiceName: 'mongodb',
        path: 'node',
        outcome: 'failed',
        nodeErrorCode: 'none',
        fallbackOutcome: 'notAttempted',
        txtOptionsApplied: [],
        dnsServers: [],
        forcedFallback: mode === 'force',
        aresVersion: process.versions.ares ?? 'unknown',
        nodeRuntimeVersion: process.versions.node,
    };
    let fallbackStartedAt: number | undefined;
    let stage: 'preflight' | 'dns' | 'rewrite' = 'preflight';
    let probeFailure: { error: unknown } | undefined;
    let txtFailure: { error: unknown } | undefined;
    try {
        throwIfCancelled(input.signal);
        const target = getSrvLookupTarget(input.connectionString, options);
        const servers = (input.getServers ?? dns.getServers)();
        report = { ...report, srvHost: target.srvHost, srvServiceName: target.srvServiceName, dnsServers: servers };
        trace(
            `start ${input.logContext ?? ''} srvHost=${target.srvHost} service=${target.srvServiceName} ares=${report.aresVersion} node=${report.nodeRuntimeVersion} dnsServers=[${servers.join(',')}] forced=${report.forcedFallback}`,
        );
        throwIfCancelled(input.signal);
        const probeStartedAt = Date.now();
        try {
            const resolver = (input.createProbeResolver ?? ((): SrvProbeResolver => new dns.promises.Resolver()))();
            const records = await cancellable(
                (): Promise<SrvRecord[]> => resolver.resolveSrv(target.srvQueryName),
                input.signal,
                (): void => resolver.cancel(),
            );
            report = { ...report, srvTargetCount: records.length };
        } catch (error) {
            throwIfCancelled(input.signal);
            if (isCancellation(error)) {
                throw error;
            }
            probeFailure = { error };
            report = { ...report, path: 'nodeErrorPassthrough', nodeErrorCode: errorCode(error) };
        } finally {
            report = { ...report, nodeProbeDurationMs: Date.now() - probeStartedAt };
        }
        throwIfCancelled(input.signal);
        const eligible = eligibleCodes.has(report.nodeErrorCode);
        const shouldFallback = eligible || mode === 'force';
        if (probeFailure) {
            const next = shouldFallback && mode !== 'off' ? 'running fallback' : `path=${report.path}`;
            trace(
                `node probe failed code=${report.nodeErrorCode} durationMs=${report.nodeProbeDurationMs} ${eligible ? '(fallback-eligible)' : '(not fallback-eligible)'} → ${next}`,
            );
        } else {
            trace(
                `node probe ok targets=${report.srvTargetCount} durationMs=${report.nodeProbeDurationMs} → ${mode === 'force' ? 'running forced fallback' : 'path=node'}`,
            );
        }
        if (mode === 'off' || !shouldFallback) {
            if (mode === 'off' && shouldFallback) {
                report = { ...report, fallbackOutcome: 'disabled' };
                trace(
                    `fallback eligible (${report.nodeErrorCode}) but disabled by DOCUMENTDB_DISABLE_SRV_FALLBACK → original +srv handed to driver`,
                );
            }
            throwIfCancelled(input.signal);
            report = { ...report, outcome: 'succeeded' };
            return { connectionString: input.connectionString, options, path: report.path, report };
        }

        fallbackStartedAt = Date.now();
        report = { ...report, path: 'fallback', fallbackOutcome: 'failed' };
        throwIfCancelled(input.signal);
        const createClient =
            input.createPreflightClient ??
            ((uri: string, clientOptions: MongoClientOptions): MongoClient => new MongoClient(uri, clientOptions));
        createClient(input.connectionString, preflightOptions(input.connectionString, options));
        throwIfCancelled(input.signal);
        stage = 'dns';
        const fallback = input.fallbackDns ?? { resolveSrv: resolveSrvFallback, resolveTxt: resolveTxtFallback };
        const dnsOptions = {
            deadlineAt:
                fallbackStartedAt + Math.min(input.deadlineMs ?? FALLBACK_MAX_DEADLINE_MS, FALLBACK_MAX_DEADLINE_MS),
            signal: input.signal,
            servers,
            logger,
            logPrefix: input.logPrefix,
        };
        const [srv, txt] = await cancellable(async (): Promise<[FallbackSrvResult, string[][] | undefined]> => {
            const srvPromise = (async (): Promise<FallbackSrvResult> => {
                const result = await fallback.resolveSrv(target.srvQueryName, dnsOptions);
                throwIfCancelled(input.signal);
                report = {
                    ...report,
                    fallbackTransport: result.transport,
                    targetCompressed: result.targetCompressed,
                    fallbackServersTried: result.serversTried,
                    srvTargetCount: result.records.length,
                };
                return result;
            })();
            const txtPromise = (async (): Promise<string[][] | undefined> => {
                try {
                    const result = await fallback.resolveTxt(target.srvHost, dnsOptions);
                    throwIfCancelled(input.signal);
                    report = { ...report, txtSource: 'fallback' };
                    return result.records;
                } catch (error) {
                    throwIfCancelled(input.signal);
                    const code = errorCode(error);
                    if (code === 'ENODATA' || code === 'ENOTFOUND') {
                        report = { ...report, txtSource: 'none' };
                        return undefined;
                    }
                    txtFailure = { error };
                    throw error;
                }
            })();
            return Promise.all([srvPromise, txtPromise]);
        }, input.signal);
        throwIfCancelled(input.signal);
        stage = 'rewrite';
        const rewritten = rewriteSrvUri({
            connectionString: input.connectionString,
            options,
            srvRecords: srv.records,
            txtRecords: txt,
        });
        throwIfCancelled(input.signal);
        report = {
            ...report,
            outcome: 'succeeded',
            fallbackOutcome: 'succeeded',
            txtOptionsApplied: rewritten.txtApplied,
            tlsAdded: rewritten.tlsAdded,
            fallbackDurationMs: Date.now() - fallbackStartedAt,
        };
        trace(
            `TXT source=${report.txtSource} keys=[${rewritten.txtKeys.join(',')}]${rewritten.txtReplicaSet === undefined ? '' : ` replicaSet=${rewritten.txtReplicaSet}`}${rewritten.txtLoadBalanced === undefined ? '' : ` loadBalanced=${rewritten.txtLoadBalanced}`}${rewritten.txtKeys.includes('authSource') ? ' authSource=<set>' : ''}`,
        );
        trace(
            `rewrite targets=[${rewritten.targets.join(',')}] tlsAdded=${rewritten.tlsAdded} removedParams=[${rewritten.removedParams.join(',')}] txtApplied=[${rewritten.txtApplied.join(',')}] txtSkipped=[${rewritten.txtSkipped.join(',')}]`,
        );
        if (probeFailure) {
            trace(
                `DNS reply for ${target.srvHost} was rejected by Node.js (${report.nodeErrorCode}, c-ares ${report.aresVersion}); resolved ${srv.records.length} SRV targets via ${srv.server} (${srv.transport}) instead. See issue #993.`,
            );
        } else {
            trace(
                `forced fallback applied for ${target.srvHost}; resolved ${srv.records.length} SRV targets via ${srv.server} (${srv.transport}). See issue #993.`,
            );
        }
        throwIfCancelled(input.signal);
        return { connectionString: rewritten.connectionString, options: rewritten.options, path: 'fallback', report };
    } catch (error) {
        if (input.signal?.aborted || isCancellation(error)) {
            report = { ...report, outcome: 'cancelled' };
            throwIfCancelled(input.signal);
            throw error;
        }
        report = { ...report, outcome: 'failed' };
        if (fallbackStartedAt !== undefined) {
            let code: string;
            if (stage === 'preflight') {
                code = 'preflight';
            } else if (stage === 'rewrite') {
                code = getSrvRewriteErrorKind(error) ?? 'unknown';
            } else {
                code = `${txtFailure && txtFailure.error === error ? 'txt:' : ''}${errorCode(error)}`;
            }
            report = {
                ...report,
                fallbackOutcome: 'failed',
                fallbackErrorCode: code,
                fallbackServersTried:
                    error instanceof FallbackDnsError ? error.serversTried : report.fallbackServersTried,
                fallbackDurationMs: Date.now() - fallbackStartedAt,
            };
            const useOriginal = stage === 'dns' && probeFailure !== undefined;
            trace(
                `SRV fallback failed code=${code} serversTried=${report.fallbackServersTried ?? 0} durationMs=${report.fallbackDurationMs}; ${useOriginal ? 'the original error is reported' : 'the fallback error is reported'}`,
            );
            throwIfCancelled(input.signal);
            if (useOriginal && probeFailure) {
                throw probeFailure.error;
            }
        }
        throw error;
    } finally {
        if (fallbackStartedAt !== undefined && report.outcome !== 'succeeded') {
            report = { ...report, fallbackDurationMs: Date.now() - fallbackStartedAt };
        }
        try {
            input.onReport?.(report);
        } catch {
            // Observability must never change the driver's result or the original error.
        }
    }
}
