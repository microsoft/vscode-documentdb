/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    builtInFindingCodes,
    type CheckResult,
    type CheckStepResult,
    type TimeoutProfile,
    type DiagnosticsEvent,
    type DiagnosticsRun,
} from '@documentdb-js/connection-diagnostics';
import { ext } from '../extensionVariables';
import { deriveResult } from './result';
import { extensionFindingCodes, type FindingCode, type DiagnosticsEntryPoint } from './types';

export type ConnectionOutcome = 'notTested' | 'failed' | 'connected';

const knownFindingCodes: ReadonlySet<string> = new Set([...builtInFindingCodes, ...extensionFindingCodes]);
const knownErrorNames: ReadonlySet<string> = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'AbortError',
    'UserCancelledError',
    'DiagnosticsCancelledError',
    'DiagnosticsConfigurationError',
    // Connection-source and preparation failures (review R2): names only, never messages.
    'RestError',
    'ApiException',
    'HttpError',
    'FetchError',
    'AuthenticationError',
    'AuthenticationRequiredError',
    'CredentialUnavailableError',
    'NotSignedInError',
    'LocalPortInUseError',
]);

export function connectionOutcome(run: Pick<DiagnosticsRun<FindingCode>, 'results'>): ConnectionOutcome {
    return deriveResult(run.results, (): { title: string; explanation: string } => ({ title: '', explanation: '' }))
        .outcome;
}

export function safeErrorName(error: unknown): string {
    return error instanceof Error && knownErrorNames.has(error.name) ? error.name : 'unknown';
}

export class DiagnosticsOutputTrace {
    private readonly targets = new Map<string, number>();
    private ended = false;

    constructor(private readonly runId: string) {}

    public started(
        entryPoint: DiagnosticsEntryPoint,
        runTrigger: 'initial' | 'rerun',
        timeoutProfile: TimeoutProfile,
    ): void {
        this.write(`started entry=${entryPoint} trigger=${runTrigger} profile=${timeoutProfile}`);
    }

    public onEvent(event: DiagnosticsEvent<FindingCode>): void {
        if (this.ended) {
            return;
        }
        if (event.type === 'checkStarted' && event.target !== undefined) {
            this.targetIndex(event.target);
        }
        if (event.type === 'checkFinished') {
            this.writeResult(event.result, `check=${event.result.checkId}`, event.result.target);
            for (const step of event.result.steps ?? []) {
                this.writeResult(step, `step=${step.stepId}`, event.result.target);
            }
        }
    }

    public finished(outcome: ConnectionOutcome): void {
        this.terminal(`finished outcome=${outcome}`);
    }

    public cancelled(): void {
        this.terminal('cancelled');
    }

    public failed(error: unknown): void {
        this.terminal(`failed errorName=${safeErrorName(error)}`);
    }

    private writeResult(
        result: CheckResult<FindingCode> | CheckStepResult<FindingCode>,
        label: string,
        target?: string,
    ): void {
        const targetPart = target === undefined ? '' : ` target=#${this.targetIndex(target)}`;
        let skip = '';
        if (result.skippedBecause) {
            let dependency: string | undefined;
            if ('checkId' in result.skippedBecause) {
                dependency = result.skippedBecause.checkId;
            } else if ('stepId' in result.skippedBecause) {
                dependency = result.skippedBecause.stepId;
            }
            skip = ` skip=${result.skippedBecause.reason}${dependency === undefined ? '' : `:${dependency}`}`;
        }
        const codes =
            result.findings
                .map((finding): string => finding.code)
                .filter((code): boolean => knownFindingCodes.has(code))
                .join(',') || '-';
        this.write(
            `${label}${targetPart} status=${result.status}${skip} durationMs=${result.durationMs} codes=${codes}`,
        );
    }

    private targetIndex(target: string): number {
        const existing = this.targets.get(target);
        if (existing !== undefined) {
            return existing;
        }
        const index = this.targets.size + 1;
        this.targets.set(target, index);
        return index;
    }

    private terminal(message: string): void {
        if (!this.ended) {
            this.write(message);
            this.ended = true;
            this.targets.clear();
        }
    }

    private write(message: string): void {
        ext.outputChannel.info(`[Connection diagnosis] run=${this.runId} ${message}`);
    }
}
