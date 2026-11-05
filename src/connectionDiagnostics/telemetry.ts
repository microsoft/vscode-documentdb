/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    builtInFindingCodes,
    type CheckResult,
    type DiagnosticsRun,
} from '@documentdb-js/connection-diagnostics';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { entraErrorRules } from '../documentdb/auth/entraErrors/entraErrorRules';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { maskSensitiveValuesInTelemetry } from '../documentdb/utils/connectionStringHelpers';
import { deriveResult } from './result';
import { type RunConnectionDiagnosticsOptions } from './runConnectionDiagnostics';
import { extensionFindingCodes, type FindingCode } from './types';

const knownFindingCodes: ReadonlySet<string> = new Set([...builtInFindingCodes, ...extensionFindingCodes]);

export function configureDiagnosticsTelemetry(context: IActionContext): void {
    context.telemetry.maskEntireErrorMessage = true;
    context.errorHandling.suppressDisplay = true;
    context.errorHandling.rethrow = true;
}

export function maskDiagnosticsInput(context: IActionContext, connectionString: string, password?: string): void {
    context.valuesToMask.push(connectionString);
    if (password) {
        context.valuesToMask.push(password, encodeURIComponent(password));
    }
    try {
        maskSensitiveValuesInTelemetry(context, new DocumentDBConnectionString(connectionString));
    } catch {
        // A malformed URI is diagnosed by the package; never record its parser error.
    }
}

export function applyRunIdentity(
    context: IActionContext,
    options: RunConnectionDiagnosticsOptions,
    runId: string,
): void {
    Object.assign(context.telemetry.properties, {
        troubleshooterSessionId: options.troubleshooterSessionId,
        troubleshooterRunCorrelationId: runId,
        entryPoint: options.entryPoint,
        runTrigger: options.runTrigger,
        timeoutProfile: options.timeoutProfile,
    });
    context.telemetry.measurements.runIndex = options.runIndex;
}

export async function reportRunStarted(options: RunConnectionDiagnosticsOptions, runId: string): Promise<void> {
    await callWithTelemetryAndErrorHandling('connectivityTroubleshooter.runStarted', async (context): Promise<void> => {
        configureDiagnosticsTelemetry(context);
        applyRunIdentity(context, options, runId);
    });
}

export function applyCheckTelemetry(
    context: IActionContext,
    results: readonly CheckResult<FindingCode>[],
    hostCount: number,
): void {
    const properties = context.telemetry.properties;
    const measurements = context.telemetry.measurements;
    properties.firstBlockingCheck = results.find((result): boolean => result.status === 'fail')?.checkId ?? 'none';
    const codes = results.flatMap((result): string[] => [
        ...result.findings.map((finding): string => finding.code),
        ...(result.steps ?? []).flatMap((step): string[] => step.findings.map((finding): string => finding.code)),
    ]);
    properties.findingCodes = [...new Set(codes.filter((code): boolean => knownFindingCodes.has(code)))]
        .sort()
        .join(',');
    measurements.hostCount = hostCount;
    for (const status of ['pass', 'warning', 'fail', 'skipped'] as const) {
        measurements[`${status}Count`] = results.filter((result): boolean => result.status === status).length;
    }
    for (const checkId of ['dns', 'tcp', 'tls', 'hello'] as const) {
        const checks = results.filter((result): boolean => result.checkId === checkId);
        measurements[`${checkId}FailCount`] = checks.filter((result): boolean => result.status === 'fail').length;
        measurements[`${checkId}MaxDurationMs`] = Math.max(0, ...checks.map((result): number => result.durationMs));
    }
}

export function applyCompletedRunTelemetry(context: IActionContext, run: DiagnosticsRun<FindingCode>): void {
    applyCheckTelemetry(context, run.results, run.targets.length);
    const result = deriveResult(run.results, (): { title: string; explanation: string } => ({
        title: '',
        explanation: '',
    }));
    const properties = context.telemetry.properties;
    properties.connectionOutcome = result.outcome;
    properties.firstBlockingCheck =
        result.headline?.checkId ?? run.results.find((check): boolean => check.status === 'fail')?.checkId ?? 'none';
    const headlineCheck = run.results.find(
        (check): boolean => check.checkId === result.headline?.checkId && check.target === result.headline.target,
    );
    const blockingStep = headlineCheck?.steps?.find((step): boolean => step.status === 'fail');
    properties.firstBlockingPhase = blockingStep?.findings.some(
        (finding): boolean => finding.code === result.headline?.code && finding.severity === 'error',
    )
        ? blockingStep.stepId
        : 'none';
    const authenticate = run.results.find((check): boolean => check.checkId === 'authenticate');
    const findings = authenticate
        ? [
              ...authenticate.findings,
              ...(authenticate.steps ?? []).flatMap((step): typeof step.findings => step.findings),
          ]
        : [];
    const missing = findings.find((finding): boolean => finding.code === 'auth.credentialsUnavailable')?.data?.missing;
    properties.authSkipReason = 'none';
    if (authenticate?.status === 'skipped') {
        if (authenticate.skippedBecause?.reason === 'runTimeoutExceeded') {
            properties.authSkipReason = 'runTimeout';
        } else if (missing === 'method' || missing === 'password' || missing === 'entraSession') {
            properties.authSkipReason = missing;
        }
    }
    const tokenFailure = findings.find((finding): boolean => finding.code === 'auth.entraTokenFailed')?.data;
    const ruleId = tokenFailure?.ruleId;
    const aadstsCode = tokenFailure?.aadstsCode;
    properties.entraRuleId =
        typeof ruleId === 'string' &&
        (ruleId === 'unclassified' || entraErrorRules.some((rule): boolean => rule.id === ruleId))
            ? ruleId
            : 'none';
    properties.aadstsCode =
        typeof aadstsCode === 'string' &&
        entraErrorRules.some((rule): boolean => rule.aadsts?.includes(aadstsCode) === true)
            ? aadstsCode
            : 'none';
    context.telemetry.properties.coverageLimited = run.coverage.limited ? 'true' : 'false';
}
