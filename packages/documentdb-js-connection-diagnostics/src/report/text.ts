/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TimeoutProfile } from '../timeouts.js';
import { type CheckResult, type CheckStatus, type Finding, type SkipReason } from '../types.js';
import { type DiagnosticsReport, type ReportOutcome } from './types.js';

export type ReportSectionId =
    | 'summary'
    | 'nextSteps'
    | 'coverage'
    | 'environment'
    | 'connectionConfiguration'
    | 'preparation'
    | 'nameResolution'
    | 'transport'
    | 'wireProtocol'
    | 'authentication'
    | 'serverAndAccess'
    | 'additionalChecks'
    | 'findings'
    | 'timings'
    | 'trace';

export type ReportLabelKey =
    | 'check'
    | 'target'
    | 'status'
    | 'duration'
    | 'reason'
    | 'code'
    | 'severity'
    | 'title'
    | 'field'
    | 'value'
    | 'runId'
    | 'startedAt'
    | 'finishedAt'
    | 'location'
    | 'timeoutProfile'
    | 'timeout'
    | 'configuredTimeout'
    | 'source'
    | 'omittedTargets'
    | 'notStarted'
    | 'timedOut'
    | 'explanation'
    | 'nextStep'
    | 'clockOffset'
    | 'uncertainty'
    | 'none'
    | 'milliseconds'
    | 'runTimeoutMs'
    | 'preparationTimeoutMs'
    | 'srvTimeoutMs'
    | 'probeTimeoutMs'
    | 'authenticationTimeoutMs'
    | 'postConnectTimeoutMs'
    | 'info'
    | 'warning'
    | 'error'
    | 'checkTimeoutSource'
    | 'runTimeoutSource'
    | 'connectionTimeoutSource';

export interface FindingText {
    readonly title: string;
    readonly explanation?: string;
    readonly nextStep?: string;
}

export type ReportOmissionKind = 'steps' | 'findings' | 'serverRows';

export interface ReportText<TCode extends string> {
    readonly title: string;
    readonly formatTimestamp: (timestamp: number | Date) => string;
    readonly sectionTitle: (section: ReportSectionId) => string;
    readonly checkLabel: (checkId: string) => string;
    readonly statusLabel: (status: CheckStatus) => string;
    readonly skipReasonLabel: (reason: SkipReason) => string;
    readonly outcomeLabel: (outcome: ReportOutcome) => string;
    readonly timeoutProfileLabel: (profile: TimeoutProfile) => string;
    readonly describeFinding: (finding: Finding<TCode>, result: CheckResult<TCode>) => FindingText;
    readonly label: (key: ReportLabelKey) => string;
    readonly omitted: (count: number) => string;
    readonly omittedEntries: (kind: ReportOmissionKind, count: number) => string;
    readonly retryAdvice: (coverage: DiagnosticsReport<TCode>['coverage']) => string | undefined;
    readonly traceNote: (runId: string) => string;
}

export interface RenderOptions<TCode extends string> {
    readonly text: ReportText<TCode>;
    readonly redact: boolean;
    readonly sectionOf?: (checkId: string) => ReportSectionId | undefined;
}

const sectionTitles: Readonly<Record<ReportSectionId, string>> = {
    summary: 'Summary',
    nextSteps: 'Next steps',
    coverage: 'Coverage and limits',
    environment: 'Environment',
    connectionConfiguration: 'Connection configuration',
    preparation: 'Preparation',
    nameResolution: 'Name resolution',
    transport: 'Transport',
    wireProtocol: 'Wire protocol',
    authentication: 'Authentication',
    serverAndAccess: 'Server and access',
    additionalChecks: 'Additional checks',
    findings: 'Findings',
    timings: 'Timings',
    trace: 'Trace',
};

const labels: Readonly<Record<ReportLabelKey, string>> = {
    check: 'Check',
    target: 'Target',
    status: 'Status',
    duration: 'Duration',
    reason: 'Reason',
    code: 'Code',
    severity: 'Severity',
    title: 'Title',
    field: 'Field',
    value: 'Value',
    runId: 'Run ID',
    startedAt: 'Started at',
    finishedAt: 'Finished at',
    location: 'Location',
    timeoutProfile: 'Timeout profile',
    timeout: 'Timeout',
    configuredTimeout: 'Configured timeout',
    source: 'Source',
    omittedTargets: 'Omitted targets',
    notStarted: 'Not started',
    timedOut: 'Timed-out operations',
    explanation: 'Explanation',
    nextStep: 'Next step',
    clockOffset: 'Clock offset',
    uncertainty: 'Uncertainty',
    none: 'None',
    milliseconds: 'ms',
    runTimeoutMs: 'Whole run',
    preparationTimeoutMs: 'Preparation',
    srvTimeoutMs: 'SRV/TXT resolution',
    probeTimeoutMs: 'Each network probe',
    authenticationTimeoutMs: 'Authentication',
    postConnectTimeoutMs: 'Each post-connect command',
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    checkTimeoutSource: 'Check',
    runTimeoutSource: 'Whole run',
    connectionTimeoutSource: 'Connection',
};

const checkLabels: Readonly<Record<string, string>> = {
    environment: 'Environment',
    connectionString: 'Connection string',
    srv: 'SRV/TXT',
    dns: 'DNS',
    tcp: 'TCP',
    tls: 'TLS',
    hello: 'Wire protocol',
};

export const englishReportText: ReportText<string> = {
    title: 'Connection diagnostics',
    formatTimestamp: (timestamp): string => (timestamp instanceof Date ? timestamp : new Date(timestamp)).toISOString(),
    sectionTitle: (section): string => sectionTitles[section],
    checkLabel: (checkId): string => (Object.hasOwn(checkLabels, checkId) ? checkLabels[checkId] : checkId),
    statusLabel: (status): string => ({ pass: 'Pass', warning: 'Warning', fail: 'Fail', skipped: 'Skipped' })[status],
    skipReasonLabel: (reason): string =>
        ({
            notApplicable: 'Not applicable',
            inputUnavailable: 'Input unavailable',
            dependencyFailed: 'Dependency failed',
            dependencySkipped: 'Dependency skipped',
            runTimeoutExceeded: 'Whole-run timeout exceeded',
        })[reason],
    outcomeLabel: (outcome): string => ({ connected: 'Connected', failed: 'Failed', notTested: 'Not tested' })[outcome],
    timeoutProfileLabel: (profile): string =>
        ({
            default: 'Default',
            longer: 'Longer timeouts',
            noDiagnosticTimeouts: 'No diagnostic timeouts',
        })[profile],
    describeFinding: (finding): FindingText => ({ title: finding.code, explanation: finding.detail.text }),
    label: (key): string => labels[key],
    omitted: (count): string => `${count} more omitted`,
    omittedEntries: (kind, count): string =>
        ({
            steps: `${count} more steps not shown`,
            findings: `${count} more findings not shown`,
            serverRows: `${count} more server rows not shown`,
        })[kind],
    retryAdvice: (coverage): string | undefined => {
        if (coverage.retryWouldHelp) {
            return (
                'Retry with longer timeouts or without diagnostic timeouts as a fresh run; no retry happens automatically. ' +
                'Without diagnostic timeouts, cancellation may be needed. Connection-configured timeouts and safety limits still apply.' +
                (coverage.timedOut.some((operation): boolean => operation.source === 'connection')
                    ? ' Change the connection timeout setting for operations it limited.'
                    : '')
            );
        }
        if (coverage.timedOut.some((operation): boolean => operation.source === 'connection')) {
            return 'A connection-configured timeout ended an operation; change that connection setting before a longer retry can help.';
        }
        return undefined;
    },
    traceNote: (runId): string => `Trace lines for this run carry run ID ${runId}.`,
};
