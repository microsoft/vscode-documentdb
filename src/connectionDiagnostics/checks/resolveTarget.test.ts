/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult, type RunContext } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it, vi } from 'vitest';
import { type AuthMethodId } from '../../documentdb/auth/AuthMethod';
import {
    ConnectionEndpointUnavailableError,
    ConnectionInputCancelledError,
    ConnectionSourceUnavailableError,
} from '../../tree/documentdb/diagnosticCredentialRead';
import { formatEvidence } from '../../webviews/documentdb/connectionDiagnostics/formatEvidence';
import { describeFinding } from '../findingMessages';
import { checkResult, fixtureRun, outputs } from '../test/fixtures';
import { type DiagnosticsTarget, type FindingCode } from '../types';
import { classifyResolutionFailure, createResolveTargetCheck } from './resolveTarget';

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index): string => result.replace(`{${index}}`, String(value)), message),
}));

function target(getCredentials: DiagnosticsTarget['getCredentials']): DiagnosticsTarget {
    return { clusterId: 'stable-id', displayName: 'Fixture', sourceView: 'connections', getCredentials };
}

function withStatus(error: Error, fields: Record<string, unknown>): Error {
    return Object.assign(error, fields);
}

/** A run whose target could not be read: everything after `resolveTarget` is skipped. */
function unresolvedRun(failure: CheckResult<FindingCode>['findings'][number]): CheckResult<FindingCode>[] {
    const skipped = (checkId: string, origin: string): CheckResult<FindingCode> =>
        checkResult(checkId, {
            status: 'skipped',
            durationMs: 0,
            skippedBecause: {
                reason: origin === 'resolveTarget' ? 'dependencyFailed' : 'dependencySkipped',
                checkId: origin,
            },
        });
    return [
        checkResult('environment', { facts: { platform: 'linux', release: '6.8', arch: 'x64' } }),
        checkResult('extensionEnvironment'),
        checkResult('resolveTarget', { status: 'fail', findings: [failure], facts: { ...failure.data } }),
        skipped('connectionString', 'resolveTarget'),
        skipped('credentials', 'resolveTarget'),
        skipped('prepare', 'resolveTarget'),
        skipped('srv', 'resolveTarget'),
        skipped('dns', 'resolveTarget'),
        skipped('tcp', 'resolveTarget'),
        skipped('tls', 'resolveTarget'),
        skipped('hello', 'resolveTarget'),
        skipped('authenticate', 'resolveTarget'),
        skipped('connectionAccess', 'resolveTarget'),
        skipped('serverFacts', 'resolveTarget'),
    ];
}

describe('resolveTarget check (review R2, option A)', (): void => {
    it.each([
        ['missing connection', undefined, 'target.notFound', { source: 'savedConnection' }],
        [
            'empty connection string',
            { connectionString: ' ', availableAuthMethods: [] as AuthMethodId[] },
            'target.endpointMissing',
            { source: 'other', reason: 'notProvided' },
        ],
    ] as const)('reports a %s as a typed finding', async (_name, credentials, code, data): Promise<void> => {
        const onResolved = vi.fn();
        const check = createResolveTargetCheck(
            target(async () => credentials),
            onResolved,
            vi.fn(),
        );
        expect(check).toMatchObject({ id: 'resolveTarget', scope: 'run' });
        expect(check.timeout).toBeUndefined();
        await expect(check.run({} as RunContext, new AbortController().signal)).resolves.toEqual({
            status: 'fail',
            facts: data,
            findings: [expect.objectContaining({ code, severity: 'error', data })],
        });
        expect(onResolved).not.toHaveBeenCalled();
    });

    it('hands resolved credentials to the run and passes', async (): Promise<void> => {
        const credentials = { connectionString: 'mongodb://private.example/', availableAuthMethods: [] };
        const onResolved = vi.fn();
        const read = vi.fn(async () => credentials);
        const signal = new AbortController().signal;
        await expect(
            createResolveTargetCheck(target(read), onResolved, vi.fn()).run({} as RunContext, signal),
        ).resolves.toEqual({ status: 'pass', facts: {}, findings: [] });
        expect(read).toHaveBeenCalledExactlyOnceWith({ signal });
        expect(onResolved).toHaveBeenCalledExactlyOnceWith(credentials);
    });

    it('passes Secret-read metadata to setup without putting it into resolution facts', async (): Promise<void> => {
        const credentials = {
            connectionString: 'mongodb://private.example/',
            availableAuthMethods: [],
            credentialReadIssue: { source: 'kubernetes', reason: 'accessDenied' } as const,
        };
        const onResolved = vi.fn();
        const result = await createResolveTargetCheck(
            target(async () => credentials),
            onResolved,
            vi.fn(),
        ).run({} as RunContext, new AbortController().signal);
        expect(result).toEqual({ status: 'pass', facts: {}, findings: [] });
        expect(onResolved).toHaveBeenCalledExactlyOnceWith(credentials);
    });

    it('performs nothing when the read settles after the run signal aborted', async (): Promise<void> => {
        const controller = new AbortController();
        const onResolved = vi.fn();
        const onFailed = vi.fn();
        const check = createResolveTargetCheck(
            target(async () => {
                controller.abort();
                return { connectionString: 'mongodb://late.example/', availableAuthMethods: [] };
            }),
            onResolved,
            onFailed,
        );
        await expect(check.run({} as RunContext, controller.signal)).rejects.toThrow();
        expect(onResolved).not.toHaveBeenCalled();
        expect(onFailed).not.toHaveBeenCalled();
    });

    it.each([
        [new ConnectionInputCancelledError('port'), 'target.inputCancelled', { input: 'port' }],
        [
            new ConnectionEndpointUnavailableError('azure', 'notProvided'),
            'target.endpointMissing',
            { source: 'azure', reason: 'notProvided' },
        ],
        [
            new ConnectionSourceUnavailableError('atlas', undefined, 'notConnectable'),
            'target.sourceInaccessible',
            { source: 'atlas', reason: 'notConnectable' },
        ],
        [
            new ConnectionSourceUnavailableError(
                'azure',
                withStatus(new Error('/subscriptions/secret-sub denied'), { name: 'RestError', statusCode: 403 }),
            ),
            'target.sourceInaccessible',
            { source: 'azure', reason: 'accessDenied', errorName: 'RestError', statusCode: 403 },
        ],
        [
            new ConnectionSourceUnavailableError(
                'azure',
                withStatus(new Error('expired'), { name: 'NotSignedInError' }),
            ),
            'target.sourceInaccessible',
            { source: 'azure', reason: 'signInRequired', errorName: 'NotSignedInError' },
        ],
        [
            new ConnectionSourceUnavailableError(
                'kubernetes',
                withStatus(new Error('connect ECONNREFUSED 10.1.2.3:6443'), { code: 'ECONNREFUSED' }),
            ),
            'target.sourceInaccessible',
            { source: 'kubernetes', reason: 'unreachable', errorName: 'Error' },
        ],
        [
            new ConnectionSourceUnavailableError(
                'kubernetes',
                withStatus(new Error('services "secret-svc" not found'), { name: 'ApiException', code: 404 }),
            ),
            'target.notFound',
            { source: 'kubernetes', errorName: 'ApiException', statusCode: 404 },
        ],
        [
            withStatus(new Error('custom secret'), { name: 'secret-name' }),
            'target.sourceInaccessible',
            { source: 'other', reason: 'other', errorName: 'unknown' },
        ],
    ] as const)('classifies %s as %s with bounded data only', (error, code, data): void => {
        const found = classifyResolutionFailure(error);
        expect(found).toMatchObject({ code, severity: 'error', data });
        expect(found.data).toEqual(data);
        expect(JSON.stringify(found)).not.toMatch(/secret|10\.1\.2\.3/);
    });

    it.each([
        ['target.notFound', { source: 'savedConnection' }, 'failed', 'Connection not found'],
        ['target.notFound', { source: 'azure' }, 'failed', 'Azure resource not found'],
        ['target.inputCancelled', { input: 'port' }, 'notTested', 'Port not provided'],
        ['target.sourceInaccessible', { source: 'azure', reason: 'signInRequired' }, 'failed', 'Azure sign-in needed'],
        ['target.sourceInaccessible', { source: 'azure', reason: 'accessDenied' }, 'failed', 'Azure access denied'],
        ['target.sourceInaccessible', { source: 'azure', reason: 'unreachable' }, 'failed', 'Azure unreachable'],
        [
            'target.sourceInaccessible',
            { source: 'kubernetes', reason: 'unreachable' },
            'failed',
            'Kubernetes API unreachable',
        ],
        [
            'target.sourceInaccessible',
            { source: 'atlas', reason: 'notConnectable' },
            'failed',
            'Atlas cluster not available',
        ],
        ['target.endpointMissing', { source: 'kubernetes', reason: 'pending' }, 'failed', 'Service address pending'],
        [
            'target.endpointMissing',
            { source: 'azure', reason: 'notProvided' },
            'failed',
            'Connection string unavailable',
        ],
    ] as const)(
        'maps %s %j to a %s card titled "%s" on the Connection settings row',
        (code, data, outcome, title): void => {
            const failure = { code, severity: 'error', data, detail: { language: 'en', text: 'detail' } } as const;
            const view = outputs(fixtureRun(unresolvedRun(failure)));
            expect(view.result.outcome).toBe(outcome);
            expect(view.result.headline).toMatchObject({ checkId: 'resolveTarget', code, title });
            expect(view.result.stoppedAtRow).toBe(outcome === 'failed' ? 'connectionSettings' : undefined);
            expect(view.result.firewallHint).toBe(false);
            const row = view.projector.rows().find((item): boolean => item.id === 'connectionSettings');
            expect(row?.status).toBe('error');
            expect(formatEvidence(row?.segments ?? [])).toContain(title);
            const message = describeFinding(failure);
            expect(message.nextStep).toBeTruthy();
            expect(`${message.title} ${message.explanation} ${message.nextStep}`).not.toMatch(
                /target\.|\/subscriptions|https?:|\d+\s*ms\b/,
            );
        },
    );
});
