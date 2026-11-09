/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult } from '@documentdb-js/connection-diagnostics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ext } from '../extensionVariables';
import { ConnectionPreparationError } from '../services/connectionReachabilityService';
import { connectionOutcome, DiagnosticsOutputTrace, safeErrorName } from './outputTrace';
import { type FindingCode } from './types';

vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { info: vi.fn() } } }));

describe('DiagnosticsOutputTrace', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
    });
    it('writes one safe line per check and step, with stable numeric targets and dependency reasons', (): void => {
        const trace = new DiagnosticsOutputTrace('run-id');
        trace.started('errorNode', 'initial', 'default');
        const result: CheckResult<FindingCode> = {
            checkId: 'hello',
            target: 'private.example:27017',
            status: 'skipped',
            skippedBecause: { reason: 'dependencyFailed', checkId: 'tcp' },
            durationMs: 2,
            findings: [
                {
                    code: 'hello.inconclusive',
                    severity: 'info',
                    data: { password: 'secret-password' },
                    detail: { language: 'en', text: 'secret-user' },
                },
            ],
            facts: { secret: 'secret-password', host: 'private.example' },
            steps: [
                {
                    stepId: 'hello.reply',
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencySkipped', stepId: 'hello.connect' },
                    durationMs: 1,
                    findings: [],
                    facts: { user: 'secret-user' },
                },
            ],
        };
        trace.onEvent({ type: 'checkFinished', runId: 'run-id', at: 0, result });
        trace.onEvent({
            type: 'checkFinished',
            runId: 'run-id',
            at: 0,
            result: { ...result, checkId: 'tcp', target: 'other-private.example:27017', steps: undefined },
        });
        trace.finished('notTested');
        const lines = vi.mocked(ext.outputChannel.info).mock.calls.map((call): string => String(call[0]));
        expect(lines).toEqual([
            '[Connection diagnosis] run=run-id started entry=errorNode trigger=initial profile=default',
            '[Connection diagnosis] run=run-id check=hello target=#1 status=skipped skip=dependencyFailed:tcp durationMs=2 codes=hello.inconclusive',
            '[Connection diagnosis] run=run-id step=hello.reply target=#1 status=skipped skip=dependencySkipped:hello.connect durationMs=1 codes=-',
            '[Connection diagnosis] run=run-id check=tcp target=#2 status=skipped skip=dependencyFailed:tcp durationMs=2 codes=hello.inconclusive',
            '[Connection diagnosis] run=run-id finished outcome=notTested',
        ]);
        expect(lines.join('\n')).not.toMatch(/private.example|secret-password|secret-user/);
        trace.cancelled();
        trace.onEvent({ type: 'checkFinished', runId: 'run-id', at: 0, result });
        expect(ext.outputChannel.info).toHaveBeenCalledTimes(5);
    });

    it('never writes error text or an arbitrary error name', (): void => {
        const trace = new DiagnosticsOutputTrace('run-id');
        const error = new Error('secret-password');
        error.name = 'secret-user';
        trace.failed(error);
        expect(ext.outputChannel.info).toHaveBeenCalledWith(
            '[Connection diagnosis] run=run-id failed errorName=unknown',
        );
    });

    it('traces the preparation finding and safe wrapper classification, never source evidence', (): void => {
        const error = new ConnectionPreparationError('noReadyBackend', new Error('private-service private-namespace'));
        const trace = new DiagnosticsOutputTrace('run-id');
        trace.onEvent({
            type: 'checkFinished',
            runId: 'run-id',
            at: 0,
            result: {
                checkId: 'prepare',
                status: 'fail',
                durationMs: 2,
                facts: { errorName: safeErrorName(error) },
                findings: [
                    {
                        code: 'prepare.failed',
                        severity: 'error',
                        data: { source: error.sourceError },
                        detail: { language: 'en', text: 'private-service private-namespace' },
                    },
                ],
            },
        });
        trace.failed(error);
        const lines = vi.mocked(ext.outputChannel.info).mock.calls.map((call): string => String(call[0]));
        expect(lines).toEqual([
            '[Connection diagnosis] run=run-id check=prepare status=fail durationMs=2 codes=prepare.failed',
            '[Connection diagnosis] run=run-id failed errorName=ConnectionPreparationError',
        ]);
        expect(lines.join('\n')).not.toMatch(/private-service|private-namespace|sourceError/);
    });
});

describe('derived Output outcome', (): void => {
    it.each(['pass', 'warning', 'fail', 'skipped'] as const)(
        'finishes using the owned connection %s result without identifiers or error text',
        (status): void => {
            const result: CheckResult<FindingCode> = {
                checkId: 'authenticate',
                status,
                durationMs: 1,
                ...(status === 'skipped' ? { skippedBecause: { reason: 'inputUnavailable' } as const } : {}),
                facts: { host: 'private.example', user: 'private-user' },
                findings: [
                    { code: 'auth.failed', severity: 'error', detail: { language: 'en', text: 'private-message' } },
                ],
            };
            let outcome = 'connected';
            if (status === 'fail') {
                outcome = 'failed';
            }
            if (status === 'skipped') {
                outcome = 'notTested';
            }
            const trace = new DiagnosticsOutputTrace('derived-run');
            trace.finished(connectionOutcome({ results: [result] }));
            expect(ext.outputChannel.info).toHaveBeenLastCalledWith(
                `[Connection diagnosis] run=derived-run finished outcome=${outcome}`,
            );
            const line = String(vi.mocked(ext.outputChannel.info).mock.calls.at(-1)?.[0]);
            expect(line).not.toMatch(/private.example|private-user|private-message/);
        },
    );
});
