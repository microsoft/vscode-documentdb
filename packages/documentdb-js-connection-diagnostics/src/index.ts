/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnectionStringCheck } from './checks/connectionString.js';
import { createDnsCheck } from './checks/dns.js';
import { createEnvironmentCheck } from './checks/environment.js';
import { createHelloCheck } from './checks/hello.js';
import { createSrvCheck } from './checks/srv.js';
import { createTcpCheck } from './checks/tcp.js';
import { createTlsCheck } from './checks/tls.js';

import { type BuiltInFindingCode } from './findingCodes.js';
import { type Check, type RunContext } from './types.js';

export { createConnectionStringCheck } from './checks/connectionString.js';
export { createDnsCheck } from './checks/dns.js';
export { createEnvironmentCheck } from './checks/environment.js';
export { createHelloCheck } from './checks/hello.js';
export { createSrvCheck } from './checks/srv.js';
export { createTcpCheck } from './checks/tcp.js';
export { createTlsCheck } from './checks/tls.js';
export { DiagnosticsCancelledError, DiagnosticsConfigurationError } from './errors.js';
export { builtInFindingCodes, isBuiltInFindingCode, skipReasons } from './findingCodes.js';
export type { BuiltInFindingCode } from './findingCodes.js';
export { describeNetworkOptions, resolveNetworkOptions } from './networkOptions.js';
export type { EffectiveNetworkOptions } from './networkOptions.js';
export { buildReport } from './report/buildReport.js';
export { redactReport } from './report/redact.js';
export { renderJson } from './report/renderJson.js';
export { renderMarkdown } from './report/renderMarkdown.js';
export { englishReportText } from './report/text.js';
export type { FindingText, RenderOptions, ReportLabelKey, ReportSectionId, ReportText } from './report/text.js';
export type {
    ClockOffsetSummary,
    DiagnosticsReport,
    IdentifierKind,
    ReportOutcome,
    ReportSummary,
} from './report/types.js';
export { createTimeoutFinding, formatTarget, runDiagnostics } from './runner.js';
export { DEFAULT_TIMEOUTS, resolveTimeouts, SAFETY_LIMITS, timeoutsForProfile } from './timeouts.js';
export type { EffectiveTimeout, TimeoutKind, TimeoutProfile, TimeoutSource } from './timeouts.js';
export type {
    Check,
    CheckOutcome,
    CheckResult,
    CheckStatus,
    CheckStepResult,
    DiagnosticsClock,
    DiagnosticsEvent,
    DiagnosticsInput,
    DiagnosticsIo,
    DiagnosticsRun,
    DiagnosticsTimeouts,
    DnsIo,
    EnvironmentSource,
    Finding,
    FindingDetail,
    FindingSeverity,
    NetIo,
    NetworkOptionLayer,
    NetworkOptionOrigin,
    NetworkOptions,
    ProbeTarget,
    RunContext,
    SkipReason,
    TimedOutOperation,
    WireCompressor,
} from './types.js';

export function createBuiltInChecks(): Check<RunContext, BuiltInFindingCode>[] {
    return [
        createEnvironmentCheck(),
        createConnectionStringCheck(),
        createSrvCheck(),
        createDnsCheck(),
        createTcpCheck(),
        createTlsCheck(),
        createHelloCheck(),
    ];
}
