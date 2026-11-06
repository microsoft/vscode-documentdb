/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatTarget } from '../runner.js';
import { REPORT_LIST_LIMIT, sanitizeValue } from './sanitize.js';

import { type CheckResult, type CheckStepResult, type DiagnosticsRun, type Finding } from '../types.js';
import { type ClockOffsetSummary, type DiagnosticsReport, type IdentifierKind, type ReportSummary } from './types.js';

// Bare keys match the last path segment. Dotted keys restrict that match to an ancestor:
// host/hosts/me/primary/srvQueryName/cnameChain/subjectAltNames -> host;
// address/osAddresses/caresAddresses/dnsServers -> address; userName -> user;
// database/authSource -> database; setName -> replicaSet. Contextual entries:
// records.name (SRV), subject.CN/O (leaf certificate only), proxy.host (environment),
// noProxy/NO_PROXY.entries (bypass hosts). Address lists contain strings or address objects.
// Named options in options/txtOptions/effectiveNetworkOptions classify their value by name:
// authSource/dbName -> database, replicaSet -> replicaSet, proxyHost -> proxyHost,
// proxyUsername -> user, servername -> host, localAddress -> address.
// hello hosts/me/primary include ports; SAN entries include DNS:/IP Address: prefixes.
// issuerChain is deliberately excluded: its public CA names are not private identifiers.
export const defaultIdentifierKeys: Readonly<Record<string, IdentifierKind>> = Object.freeze({
    host: 'host',
    hosts: 'host',
    me: 'host',
    primary: 'host',
    srvQueryName: 'host',
    'records.name': 'host',
    cnameChain: 'host',
    subjectAltNames: 'host',
    'noProxy.entries': 'host',
    'NO_PROXY.entries': 'host',
    address: 'address',
    osAddresses: 'address',
    caresAddresses: 'address',
    dnsServers: 'address',
    userName: 'user',
    database: 'database',
    authSource: 'database',
    setName: 'replicaSet',
    'subject.CN': 'certificateName',
    'subject.O': 'certificateName',
    'proxy.host': 'proxyHost',
    proxyHost: 'proxyHost',
    proxyUsername: 'user',
    dbName: 'database',
    replicaSet: 'replicaSet',
    servername: 'host',
    localAddress: 'address',
});

function copyFinding<TCode extends string>(finding: Finding<TCode>): Finding<TCode> {
    return {
        code: finding.code,
        severity: finding.severity,
        ...(finding.data === undefined
            ? {}
            : { data: sanitizeValue(finding.data) as Readonly<Record<string, unknown>> }),
        detail: { language: finding.detail.language, text: sanitizeValue(finding.detail.text) as string },
    };
}

function copyStep<TCode extends string>(step: CheckStepResult<TCode>): CheckStepResult<TCode> {
    return {
        stepId: sanitizeValue(step.stepId) as string,
        status: step.status,
        ...(step.skippedBecause === undefined
            ? {}
            : {
                  skippedBecause: {
                      reason: step.skippedBecause.reason,
                      ...(step.skippedBecause.stepId === undefined
                          ? {}
                          : { stepId: sanitizeValue(step.skippedBecause.stepId) as string }),
                  },
              }),
        durationMs: step.durationMs,
        findings: step.findings.slice(0, REPORT_LIST_LIMIT).map(copyFinding),
        ...(step.findings.length > REPORT_LIST_LIMIT
            ? { omittedFindingCount: step.findings.length - REPORT_LIST_LIMIT }
            : {}),
        facts: sanitizeValue(step.facts) as Readonly<Record<string, unknown>>,
    };
}

function copyResult<TCode extends string>(result: CheckResult<TCode>): CheckResult<TCode> {
    return {
        checkId: result.checkId,
        ...(result.target === undefined ? {} : { target: result.target }),
        status: result.status,
        ...(result.skippedBecause === undefined ? {} : { skippedBecause: { ...result.skippedBecause } }),
        durationMs: result.durationMs,
        findings: result.findings.slice(0, REPORT_LIST_LIMIT).map(copyFinding),
        ...(result.findings.length > REPORT_LIST_LIMIT
            ? { omittedFindingCount: result.findings.length - REPORT_LIST_LIMIT }
            : {}),
        facts: sanitizeValue(result.facts) as Readonly<Record<string, unknown>>,
        ...(result.steps === undefined
            ? {}
            : { steps: result.steps.slice(0, REPORT_LIST_LIMIT).map(copyStep) }),
        ...(result.steps !== undefined && result.steps.length > REPORT_LIST_LIMIT
            ? { omittedStepCount: result.steps.length - REPORT_LIST_LIMIT }
            : {}),
    };
}

function copySummary(summary: ReportSummary): ReportSummary {
    return {
        outcome: summary.outcome,
        ...(summary.headline === undefined
            ? {}
            : { headline: sanitizeValue(summary.headline) as ReportSummary['headline'] }),
        ...(summary.serverRows === undefined
            ? {}
            : {
                  serverRows: summary.serverRows.slice(0, REPORT_LIST_LIMIT).map(
                      (row): { label: string; value: string } => ({
                          label: sanitizeValue(row.label) as string,
                          value: sanitizeValue(row.value) as string,
                      }),
                  ),
              }),
        ...(summary.serverRows !== undefined && summary.serverRows.length > REPORT_LIST_LIMIT
            ? { omittedServerRowCount: summary.serverRows.length - REPORT_LIST_LIMIT }
            : {}),
        ...(summary.nextSteps === undefined ? {} : { nextSteps: sanitizeValue(summary.nextSteps) as readonly string[] }),
        ...(summary.location === undefined ? {} : { location: sanitizeValue(summary.location) as string }),
        ...(summary.notes === undefined ? {} : { notes: sanitizeValue(summary.notes) as readonly string[] }),
    };
}

function freeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) {
            freeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

export function buildReport<TCode extends string>(
    run: DiagnosticsRun<TCode>,
    options?: {
        summary?: ReportSummary;
        connectionName?: string;
        identifierKeys?: Readonly<Record<string, IdentifierKind>>;
    },
): DiagnosticsReport<TCode> {
    const results = run.results.map(copyResult);
    let clockOffset: ClockOffsetSummary | null = null;
    for (const result of results) {
        const { clockOffsetMs, clockUncertaintyMs } = result.facts;
        if (
            result.checkId === 'hello' &&
            result.target !== undefined &&
            typeof clockOffsetMs === 'number' &&
            typeof clockUncertaintyMs === 'number' &&
            (clockOffset === null || clockUncertaintyMs < clockOffset.uncertaintyMs)
        ) {
            clockOffset = { target: result.target, offsetMs: clockOffsetMs, uncertaintyMs: clockUncertaintyMs };
        }
    }
    return freeze({
        schemaVersion: 1,
        runId: run.runId,
        startedAt: new Date(run.startedAt).toISOString(),
        finishedAt: new Date(run.finishedAt).toISOString(),
        durationMs: run.durationMs,
        timeoutProfile: run.timeoutProfile,
        timeouts: { ...run.timeouts },
        coverage: {
            ...run.coverage,
            timedOut: run.coverage.timedOut.map((operation): typeof operation => ({ ...operation })),
        },
        targets: run.targets.map(formatTarget),
        results,
        ...(options?.summary === undefined ? {} : { summary: copySummary(options.summary) }),
        clockOffset,
        ...(options?.connectionName === undefined
            ? {}
            : { connectionName: sanitizeValue(options.connectionName) as string }),
        identifierKeys: { ...defaultIdentifierKeys, ...options?.identifierKeys },
    });
}
