/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult, type Finding } from '@documentdb-js/connection-diagnostics';
import { Links } from '../constants';
import { panelRowIds, type PanelRowId } from '../webviews/documentdb/connectionDiagnostics/panelTypes';
import { type FindingMessage } from './findingMessages';
import { rowForCheck } from './panelRows';
import { type FindingCode } from './types';

export interface DiagnosticsResult {
    readonly outcome: 'connected' | 'failed' | 'notTested';
    readonly stoppedAtRow?: PanelRowId;
    readonly headline?: {
        readonly checkId: string;
        readonly target?: string;
        readonly code: FindingCode;
        readonly title: string;
        readonly explanation: string;
        readonly nextStep?: string;
    };
    readonly supporting?: {
        readonly title: string;
        readonly target?: string;
        /**
         * The driver's own attempt agrees with the headline: it reached no server (`serverSelection`)
         * or did not finish in time (`timedOut`). Corroboration, not a second problem (WI-27).
         */
        readonly corroboration?: 'serverSelection' | 'timedOut';
    };
    readonly providerHint?: string;
    /** Documentation for a provider paragraph that was left out because it repeats the headline. */
    readonly learnMore?: { readonly topic: 'sovereignClouds' | 'srvDns'; readonly url: string };
    readonly firewallHint: boolean;
    readonly earlierSignInFailure: boolean;
    readonly runTimeoutBeforeAttempt: boolean;
    /** The server that answered, for the report summary. The card leaves it to the rows' Details. */
    readonly serverLine?: {
        readonly engineVersion?: string;
        readonly apiVersion?: string;
        readonly serverVersion?: string;
        readonly host?: string;
        readonly pingMs?: number;
    };
    readonly authenticated: boolean;
    /**
     * Connected with No authentication, but the server refuses to list databases until sign-in
     * (`access.signInRequired`, decision 0048). The headline is that finding.
     */
    readonly signInRequired?: true;
}

interface Evidence {
    readonly result: CheckResult<FindingCode>;
    readonly finding: Finding<FindingCode>;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function host(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(value);
    return match ? (match[1] ?? match[2]) : value;
}

function errorFinding(result: CheckResult<FindingCode>): Finding<FindingCode> | undefined {
    const blockingStep = result.steps?.find((step): boolean => step.status === 'fail');
    return (
        blockingStep?.findings.find((finding): boolean => finding.severity === 'error') ??
        result.findings.find((finding): boolean => finding.severity === 'error')
    );
}

function firstError(results: readonly CheckResult<FindingCode>[]): Evidence | undefined {
    for (const result of results) {
        const finding = errorFinding(result);
        if (finding) {
            return { result, finding };
        }
    }
    return undefined;
}

/** The checks that probe the network path before the driver's attempt. */
const networkChecks: ReadonlySet<string> = new Set(['srv', 'dns', 'tcp', 'tls', 'hello']);

/**
 * The driver's attempt failed only because it reached no server in time: it never presented
 * credentials, so it repeats, rather than explains, a failed network probe (decision 0047).
 */
function isDriverTransportFailure(evidence: Evidence | undefined): boolean {
    return (
        evidence?.result.checkId === 'authenticate' &&
        (evidence.finding.code === 'auth.serverSelectionTimeout' || evidence.finding.code === 'check.timeout')
    );
}

function isTransport(evidence: Evidence | undefined): boolean {
    if (!evidence) {
        return false;
    }
    switch (evidence.finding.code) {
        case 'tcp.refused':
        case 'tcp.timeout':
        case 'tcp.unreachable':
        case 'tcp.reset':
        case 'hello.noReply':
        case 'tls.handshakeRejectedByServer':
        case 'auth.serverSelectionTimeout':
            return true;
        case 'check.timeout':
            return ['dns', 'tcp', 'tls', 'hello', 'authenticate'].includes(evidence.result.checkId);
        default:
            return false;
    }
}

/** A completed run's answer, based only on stable codes, statuses and structured evidence. */
export function deriveResult(
    results: readonly CheckResult<FindingCode>[],
    describe: (finding: Finding<FindingCode>) => FindingMessage,
): DiagnosticsResult {
    const authenticate = results.find((result): boolean => result.checkId === 'authenticate');
    const access = results.find((result): boolean => result.checkId === 'connectionAccess');
    const earlier = results
        .filter((result): boolean => {
            const row = rowForCheck(result.checkId);
            return row !== undefined && panelRowIds.indexOf(row) < panelRowIds.indexOf('authentication');
        })
        .sort(
            (a, b): number =>
                panelRowIds.indexOf(rowForCheck(a.checkId) ?? 'setup') -
                panelRowIds.indexOf(rowForCheck(b.checkId) ?? 'setup'),
        );
    let outcome: DiagnosticsResult['outcome'] = 'notTested';
    let stoppedAtRow: PanelRowId | undefined;
    let headline: Evidence | undefined;
    let supporting: Evidence | undefined;
    let corroborates = false;
    let signInRequired = false;
    let runTimeoutBeforeAttempt = false;

    if (authenticate?.status === 'pass' || authenticate?.status === 'warning') {
        outcome = 'connected';
        if (access?.status === 'fail' && access.facts.command === 'ping') {
            for (const result of results.filter((item): boolean => item.checkId === 'hello')) {
                const finding = result.findings.find((item): boolean => item.code === 'hello.compressorUnavailable');
                if (finding) {
                    outcome = 'failed';
                    headline = { result, finding };
                    stoppedAtRow = 'databaseAccess';
                    break;
                }
            }
        }
        const signIn = access?.findings.find((item): boolean => item.code === 'access.signInRequired');
        if (outcome === 'connected' && access && signIn) {
            headline = { result: access, finding: signIn };
            signInRequired = true;
        }
    } else if (authenticate?.status === 'skipped' && authenticate.skippedBecause?.reason === 'inputUnavailable') {
        const finding = authenticate.findings.find((item): boolean => item.code === 'auth.credentialsUnavailable');
        if (finding) {
            headline = { result: authenticate, finding };
        }
    } else if (authenticate?.status === 'skipped' && authenticate.skippedBecause?.reason === 'runTimeoutExceeded') {
        runTimeoutBeforeAttempt = true;
    } else if (authenticate?.status === 'fail') {
        outcome = 'failed';
        const own = firstError([authenticate]);
        const network = firstError(earlier.filter((result): boolean => networkChecks.has(result.checkId)));
        stoppedAtRow = 'authentication';
        if (isDriverTransportFailure(own) && network) {
            // The root cause is the earliest failed probe; the driver's timeout only agrees with it.
            headline = network;
            supporting = own;
            corroborates = true;
        } else {
            // The generic fallback explains the attempt only when no earlier step observed something specific.
            headline =
                own?.finding.code === 'auth.connectFailed'
                    ? (firstError(earlier) ?? own)
                    : (own ?? firstError(earlier));
            const anotherHostAnswered = results.some(
                (result): boolean =>
                    result.checkId === 'hello' && (result.status === 'pass' || result.status === 'warning'),
            );
            if (!(headline?.finding.code === 'auth.failed' && anotherHostAnswered)) {
                supporting = firstError(earlier);
                if (supporting?.finding === headline?.finding) {
                    supporting = undefined;
                }
            }
        }
    } else if (
        authenticate?.status === 'skipped' &&
        (authenticate.skippedBecause?.reason === 'dependencyFailed' ||
            authenticate.skippedBecause?.reason === 'dependencySkipped')
    ) {
        outcome = 'failed';
        let origin = authenticate;
        const visited = new Set<string>();
        while (origin.skippedBecause?.checkId && !visited.has(origin.checkId)) {
            visited.add(origin.checkId);
            const dependency = results.find(
                (result): boolean =>
                    result.checkId === origin.skippedBecause?.checkId &&
                    (origin.target === undefined || result.target === origin.target || result.target === undefined),
            );
            if (!dependency) {
                break;
            }
            origin = dependency;
        }
        headline = firstError([origin]);
        stoppedAtRow = rowForCheck(origin.checkId);
    } else {
        const invalid = results.find(
            (result): boolean => result.checkId === 'connectionString' && result.status === 'fail',
        );
        if (invalid) {
            outcome = 'failed';
            headline = firstError([invalid]);
            stoppedAtRow = 'connectionSettings';
        }
    }
    if (headline && outcome !== 'connected' && stoppedAtRow !== 'databaseAccess') {
        stoppedAtRow = rowForCheck(headline.result.checkId);
    }
    // A dismissed port prompt means nothing was tested, not that the connection failed.
    if (headline?.finding.code === 'target.inputCancelled') {
        outcome = 'notTested';
        stoppedAtRow = undefined;
    }

    const hints = results.find((result): boolean => result.checkId === 'contextHints')?.facts;
    const providerId = text(hints?.providerId);
    const headlineCode = headline?.finding.code;
    const suppressed =
        (providerId === 'entra-sign-in' && headlineCode === 'auth.entraTokenFailed') ||
        (providerId === 'srv-dns' && headlineCode?.startsWith('srv.'));
    const providerHint =
        [suppressed ? undefined : text(hints?.explanation), text(hints?.privateAccessHint)]
            .filter((part): part is string => part !== undefined)
            .join(' ') || undefined;
    let learnMore: DiagnosticsResult['learnMore'];
    if (suppressed) {
        learnMore =
            providerId === 'entra-sign-in'
                ? { topic: 'sovereignClouds', url: Links.SovereignClouds }
                : { topic: 'srvDns', url: Links.SrvDnsTroubleshooting };
    }

    const server = results.find((result): boolean => result.checkId === 'serverFacts')?.facts ?? {};
    const versions = record(server.versions);
    const pingMs =
        typeof access?.facts.pingMs === 'number' && Number.isFinite(access.facts.pingMs)
            ? access.facts.pingMs
            : undefined;
    return {
        outcome,
        ...(stoppedAtRow ? { stoppedAtRow } : {}),
        ...(headline
            ? {
                  headline: {
                      checkId: headline.result.checkId,
                      target: headline.result.target,
                      code: headline.finding.code,
                      ...describe(headline.finding),
                  },
              }
            : {}),
        ...(supporting
            ? {
                  supporting: {
                      title: describe(supporting.finding).title,
                      target: supporting.result.target,
                      ...(corroborates
                          ? {
                                corroboration:
                                    supporting.finding.code === 'auth.serverSelectionTimeout'
                                        ? ('serverSelection' as const)
                                        : ('timedOut' as const),
                            }
                          : {}),
                  },
              }
            : {}),
        providerHint,
        learnMore,
        firewallHint: outcome === 'failed' && (isTransport(headline) || isTransport(supporting)),
        earlierSignInFailure:
            authenticate?.facts.earlierInSession !== undefined && authenticate.facts.earlierInSession !== null,
        runTimeoutBeforeAttempt,
        ...(outcome === 'connected'
            ? {
                  serverLine: {
                      engineVersion: text(versions.engine),
                      apiVersion: text(versions.api),
                      serverVersion: text(versions.server),
                      // Only the server the driver reported; a seed is never presented as the one that answered.
                      host: host(text(server.answeredBy)),
                      pingMs,
                  },
              }
            : {}),
        authenticated: authenticate?.facts.authenticated === true,
        ...(signInRequired ? { signInRequired: true as const } : {}),
    };
}
