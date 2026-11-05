/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    timeoutsForProfile,
    type CheckResult,
    type DiagnosticsRun,
} from '@documentdb-js/connection-diagnostics';
import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type initWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import type * as Troubleshooter from '../../../connectionDiagnostics/runConnectionDiagnostics';
import {
    runConnectivityTroubleshooter,
    type RunConnectivityTroubleshooterOptions,
} from '../../../connectionDiagnostics/runConnectionDiagnostics';
import { type FindingCode } from '../../../connectionDiagnostics/types';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { createCallerFactory } from '../../_integration/trpc';
import { connectivityTroubleshooterRouter, type RouterContext } from './connectionDiagnosticsRouter';
import { type RunUpdate, type TimeoutProfile } from './connectionDiagnosticsTypes';
import { TroubleshooterPanelSession } from './diagnosticsPanelSession';

const scopes = vi.hoisted(() => [] as { path: string; context: IActionContext }[]);

vi.mock('../../_integration/trpc', async () => {
    const { initWebviewTrpc: init } = await vi.importActual<{ initWebviewTrpc: typeof initWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = init();
    return {
        ...trpc,
        publicProcedureWithTelemetry: trpc.publicProcedure.use(async ({ next, path }) => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: {},
                valuesToMask: [],
            } as unknown as IActionContext;
            scopes.push({ path, context });
            return next({ ctx: { actionContext: context } });
        }),
    };
});
vi.mock('../../../connectionDiagnostics/runConnectionDiagnostics', async () => ({
    ...(await vi.importActual<typeof Troubleshooter>('../../../connectionDiagnostics/runConnectionDiagnostics')),
    runConnectivityTroubleshooter: vi.fn(),
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            extensionMode: 1,
            extension: { packageJSON: { version: '1.2.3' } },
        },
    },
}));

const host = 'private-fixture.example';
const connectionName = 'Private fixture connection';

function context(signal?: AbortSignal): RouterContext {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'connectivityTroubleshooter',
        target: {
            clusterId: 'stable-cluster',
            displayName: connectionName,
            sourceView: 'connections',
            getCredentials: vi.fn(),
        },
        entryPoint: 'contextMenu',
        session: new TroubleshooterPanelSession('session-id'),
        signal,
    };
}

function result(checkId: string, facts: Readonly<Record<string, unknown>> = {}): CheckResult<FindingCode> {
    return { checkId, status: 'pass', durationMs: 1, findings: [], facts };
}

function completedRun(runId: string, remoteKind = 'local'): DiagnosticsRun<FindingCode> {
    return {
        runId,
        startedAt: 1000,
        finishedAt: 2000,
        durationMs: 1000,
        timeoutProfile: 'default',
        timeouts: timeoutsForProfile('default'),
        targets: [{ host, port: 27017, source: 'uri' }],
        results: [
            result('environment', { platform: 'linux', arch: 'x64' }),
            result('extensionEnvironment', { remoteKind }),
            result('connectionString', { host }),
            { ...result('tcp', { host }), target: `${host}:27017` },
        ],
        coverage: {
            limited: true,
            retryWouldHelp: true,
            timedOut: [{ checkId: 'tcp', source: 'connection', timeoutMs: 5 }],
            notStartedCount: 0,
            omittedTargetCount: 0,
        },
    };
}

function emitRun(
    options: RunConnectivityTroubleshooterOptions,
    run = completedRun(options.runId ?? 'missing'),
): DiagnosticsRun<FindingCode> {
    for (const item of run.results) {
        options.onEvent?.({
            type: 'checkStarted',
            runId: run.runId,
            checkId: item.checkId,
            at: 1000,
            target: item.target,
        });
        options.onEvent?.({ type: 'checkFinished', runId: run.runId, result: item, at: 1500 });
    }
    options.onEvent?.({ type: 'runFinished', runId: run.runId, run, at: run.finishedAt });
    return run;
}

async function* iterator<T>(stream: AsyncIterable<T>): AsyncGenerator<T, void, void> {
    yield* stream;
}

async function collect(stream: AsyncIterable<RunUpdate>): Promise<RunUpdate[]> {
    const updates: RunUpdate[] = [];
    for await (const update of stream) {
        updates.push(update);
    }
    return updates;
}

const createCaller = createCallerFactory(connectivityTroubleshooterRouter);

let requestCount = 0;

function runInput(
    timeoutProfile: TimeoutProfile = 'default',
    trigger: 'initial' | 'rerun' = 'initial',
    requestId = `request-${++requestCount}`,
): { timeoutProfile: TimeoutProfile; trigger: 'initial' | 'rerun'; requestId: string } {
    return { timeoutProfile, trigger, requestId };
}

function caller(ctx: RouterContext): ReturnType<typeof createCaller> {
    return createCaller(ctx);
}

async function finish(ctx: RouterContext): Promise<string> {
    const updates = await collect(await caller(ctx).run(runInput('default', 'initial')));
    expect(updates.at(-1)?.type).toBe('finished');
    return updates[0].runId;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise): void => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function latestOptions(): RunConnectivityTroubleshooterOptions {
    const call = vi.mocked(runConnectivityTroubleshooter).mock.calls.at(-1);
    if (!call) {
        throw new Error('Expected a run');
    }
    return call[0];
}

function latestTelemetry(): IActionContext['telemetry'] {
    const scope = scopes.at(-1);
    if (!scope) {
        throw new Error('Expected telemetry');
    }
    expect(scope.context.telemetry.maskEntireErrorMessage).toBe(true);
    return scope.context.telemetry;
}

describe('connectivityTroubleshooterRouter', (): void => {
    beforeEach((): void => {
        vi.clearAllMocks();
        scopes.length = 0;
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => emitRun(options),
        );
        vi.spyOn(readOnlyJsonDocumentProvider, 'openMarkdownDocument').mockResolvedValue(
            vscode.Uri.parse('documentdb-readonly-json:/report.md'),
        );
        Object.defineProperty(vscode.env, 'clipboard', {
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
            configurable: true,
        });
        vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);
        vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
    });
    afterEach((): void => {
        vi.restoreAllMocks();
    });

    it('starts with eight pending rows and a caller-generated run ID, projects updates and finishes with coverage', async (): Promise<void> => {
        const ctx = context();
        const updates = await collect(await caller(ctx).run(runInput('longer', 'rerun')));
        const first = updates[0];
        expect(first).toMatchObject({ type: 'started', startedAt: expect.any(Number), runId: expect.any(String) });
        if (first.type !== 'started') {
            throw new Error('Expected started');
        }
        expect(first.rows).toHaveLength(8);
        expect(first.rows.every((row): boolean => row.status === 'pending')).toBe(true);
        expect(updates.some((update): boolean => update.type === 'rows')).toBe(true);
        expect(updates.every((update): boolean => update.runId === first.runId)).toBe(true);
        expect(updates.at(-1)).toMatchObject({
            type: 'finished',
            outcome: 'notTested',
            result: { outcome: 'notTested', firewallHint: false },
            finishedAt: 2000,
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: true },
        });
        expect(ctx.session.completedRun?.runId).toBe(first.runId);
        expect(latestOptions()).toMatchObject({
            runId: first.runId,
            timeoutProfile: 'longer',
            runTrigger: 'rerun',
            runIndex: 1,
            troubleshooterSessionId: 'session-id',
        });
    });

    it.each<TimeoutProfile>(['default', 'longer', 'noDiagnosticTimeouts'])(
        'passes the %s retry profile without changing it',
        async (timeoutProfile): Promise<void> => {
            await collect(await caller(context()).run(runInput(timeoutProfile, 'rerun')));
            expect(latestOptions().timeoutProfile).toBe(timeoutProfile);
        },
    );

    it('cancels during preparation with the started run ID before any check event, without waiting for the runner', async (): Promise<void> => {
        const pending = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValue(pending.promise);
        const ctx = context();
        const stream = iterator(await caller(ctx).run(runInput('default', 'initial', 'request-1')));
        const first = (await stream.next()).value;
        if (!first || first.type !== 'started') {
            throw new Error('Expected started');
        }
        await caller(ctx).cancel({ requestId: 'request-1' });
        expect(latestOptions().signal.aborted).toBe(true);
        expect(latestOptions().cancelReason?.()).toBe('cancelButton');
        expect((await stream.next()).value).toMatchObject({
            type: 'cancelled',
            runId: first?.runId,
            rows: first?.rows,
        });
        expect((await stream.next()).done).toBe(true);
        expect(ctx.session.completedRun).toBeUndefined();
        expect(latestTelemetry().properties).toMatchObject({
            troubleshooterSessionId: 'session-id',
            troubleshooterRunCorrelationId: first?.runId,
        });
        pending.reject(new UserCancelledError());
    });

    it('ignores a delayed Cancel from a replaced run instead of cancelling the replacement', async (): Promise<void> => {
        const oldRun = deferred<DiagnosticsRun<FindingCode>>();
        const newRun = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter)
            .mockReturnValueOnce(oldRun.promise)
            .mockReturnValueOnce(newRun.promise);
        const ctx = context();
        const first = iterator(await caller(ctx).run(runInput('default', 'initial', 'request-a')));
        await first.next();
        const second = iterator(await caller(ctx).run(runInput('default', 'rerun', 'request-b')));
        const secondStarted = (await second.next()).value;
        const replacement = latestOptions();

        await caller(ctx).cancel({ requestId: 'request-a' });

        expect(replacement.signal.aborted).toBe(false);
        expect(ctx.session.currentRun?.runId).toBe(secondStarted?.runId);
        expect(latestTelemetry().properties.troubleshooterRunCorrelationId).toBeUndefined();

        await caller(ctx).cancel({ requestId: 'request-b' });
        expect(replacement.signal.aborted).toBe(true);
        expect(replacement.cancelReason?.()).toBe('cancelButton');
        expect((await second.next()).value).toMatchObject({ type: 'cancelled', runId: secondStarted?.runId });
        oldRun.reject(new UserCancelledError());
        newRun.reject(new UserCancelledError());
    });

    it('cancels a run whose Cancel arrives before its subscription starts', async (): Promise<void> => {
        const pending = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValue(pending.promise);
        const ctx = context();

        await caller(ctx).cancel({ requestId: 'request-early' });
        const stream = iterator(await caller(ctx).run(runInput('default', 'initial', 'request-early')));
        const first = (await stream.next()).value;

        expect(first?.type).toBe('started');
        expect(latestOptions().signal.aborted).toBe(true);
        expect(latestOptions().cancelReason?.()).toBe('cancelButton');
        expect((await stream.next()).value).toMatchObject({ type: 'cancelled', runId: first?.runId });
        expect((await stream.next()).done).toBe(true);
        pending.reject(new UserCancelledError());
    });

    it('a second run aborts the first as rerun and drops late events and snapshots', async (): Promise<void> => {
        const old = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValueOnce(old.promise);
        const ctx = context();
        const first = iterator(await caller(ctx).run(runInput('default', 'initial')));
        const firstStarted = (await first.next()).value;
        const oldOptions = latestOptions();
        const waiting = first.next();
        const second = await collect(await caller(ctx).run(runInput('longer', 'rerun')));
        expect(oldOptions.signal.aborted).toBe(true);
        expect(oldOptions.cancelReason?.()).toBe('rerun');
        expect(second[0].runId).not.toBe(firstStarted?.runId);
        expect(latestOptions().runIndex).toBe(2);
        expect((await waiting).done).toBe(true);
        old.resolve(emitRun(oldOptions));
        await Promise.resolve();
        expect(ctx.session.completedRun?.runId).toBe(second[0].runId);
        expect((await first.next()).done).toBe(true);
    });

    it('closing the subscription aborts as subscriptionClosed and stops the stream', async (): Promise<void> => {
        const pending = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValue(pending.promise);
        const subscription = new AbortController();
        const stream = iterator(await caller(context(subscription.signal)).run(runInput('default', 'initial')));
        const first = (await stream.next()).value;
        const waiting = stream.next();
        subscription.abort();
        expect((await waiting).value).toMatchObject({ type: 'cancelled', runId: first?.runId });
        expect(latestOptions().cancelReason?.()).toBe('subscriptionClosed');
        expect((await stream.next()).done).toBe(true);
        pending.resolve(emitRun(latestOptions()));
    });

    it('returning the subscription iterator aborts its runner', async (): Promise<void> => {
        const pending = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValue(pending.promise);
        const stream = iterator(await caller(context()).run(runInput('default', 'initial')));
        await stream.next();
        await stream.return();
        expect(latestOptions().signal.aborted).toBe(true);
        expect(latestOptions().cancelReason?.()).toBe('subscriptionClosed');
        pending.reject(new UserCancelledError());
    });

    it('reports a bounded failure with the run ID, never the original message', async (): Promise<void> => {
        // An unreadable target is a finished run with a typed finding (review R2), never a failed run.
        const error = new Error('secret original error');
        vi.mocked(runConnectivityTroubleshooter).mockRejectedValue(error);
        const updates = await collect(await caller(context()).run(runInput('default', 'initial')));
        expect(updates).toHaveLength(2);
        expect(updates[1]).toEqual({ type: 'failed', runId: updates[0].runId, reason: 'unexpected' });
        expect(JSON.stringify(updates)).not.toContain(error.message);
    });

    it('streams re-run offers and ends panelEvents on subscription abort', async (): Promise<void> => {
        const subscription = new AbortController();
        const ctx = context(subscription.signal);
        const stream = iterator(await caller(ctx).panelEvents());
        const waiting = stream.next();
        ctx.session.offerRerun();
        expect((await waiting).value).toEqual({ type: 'offerRerun' });
        const done = stream.next();
        subscription.abort();
        expect((await done).done).toBe(true);
    });

    it('requires the current completed run for all report actions and invalidates it on a new run', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        for (const action of [actions.showDiagnostics, actions.copyReport, actions.saveReport]) {
            await expect(action({ runId: 'wrong', hideIdentifiers: false })).rejects.toThrow(
                'This report is no longer available. Run the check again.',
            );
        }
        const pending = deferred<DiagnosticsRun<FindingCode>>();
        vi.mocked(runConnectivityTroubleshooter).mockReturnValue(pending.promise);
        const stream = iterator(await actions.run(runInput('default', 'rerun', 'request-2')));
        await stream.next();
        await expect(actions.copyReport({ runId, hideIdentifiers: false })).rejects.toThrow(
            'This report is no longer available.',
        );
        await actions.cancel({ requestId: 'request-2' });
        await collect(stream);
        pending.reject(new UserCancelledError());
    });

    it('finishes with derived result-card data and a connected report with server rows', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => {
                const run = completedRun(options.runId ?? 'missing');
                return emitRun(options, {
                    ...run,
                    results: [
                        ...run.results,
                        result('authenticate', { authMethod: 'MicrosoftEntraID', authenticated: true }),
                        result('connectionAccess', { pingMs: 12, databaseCount: 5 }),
                        result('serverFacts', {
                            versions: { engine: '0.107.0', api: '7.0.12' },
                            topology: 'documentdbGateway',
                            answeredBy: `${host}:27017`,
                            seedHosts: [`${host}:27017`],
                        }),
                    ],
                });
            },
        );
        const ctx = context();
        const updates = await collect(await caller(ctx).run(runInput('default', 'initial')));
        expect(updates.at(-1)).toMatchObject({
            type: 'finished',
            outcome: 'connected',
            result: {
                outcome: 'connected',
                authenticated: true,
                serverLine: { engineVersion: '0.107.0', apiVersion: '7.0.12', host, pingMs: 12 },
            },
        });
        await caller(ctx).copyReport({ runId: updates[0].runId, hideIdentifiers: false });
        const markdown = String(vi.mocked(vscode.env.clipboard.writeText).mock.calls.at(-1)?.[0]).replaceAll('\\', '');
        for (const text of [
            '## Summary',
            '**Connection successful**',
            'DocumentDB engine',
            '0.107.0',
            'API version',
            '7.0.12',
            'Topology',
            'DocumentDB gateway',
            'Ping round trip',
            '12 ms',
            'Authentication method',
            'Microsoft Entra ID · Azure',
        ]) {
            expect(markdown).toContain(text);
        }
        await caller(ctx).copyReport({ runId: updates[0].runId, hideIdentifiers: true });
        expect(vi.mocked(vscode.env.clipboard.writeText).mock.calls.at(-1)?.[0]).not.toContain(host);
    });

    it('reports the resolved managed-identity cloud, not the unrelated interactive sign-in setting', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => {
                const run = completedRun(options.runId ?? 'missing');
                return emitRun(options, {
                    ...run,
                    results: [
                        ...run.results,
                        {
                            ...result('authenticate', { authMethod: 'ManagedIdentity', authenticated: true }),
                            steps: [
                                {
                                    stepId: 'auth.signInConfiguration',
                                    status: 'pass',
                                    durationMs: 1,
                                    facts: {
                                        configuredCloud: 'AzureCloud',
                                        tokenResource: 'AzureUSGovernment',
                                        cloudCategory: 'usgov',
                                    },
                                    findings: [],
                                },
                            ],
                        },
                    ],
                });
            },
        );
        const ctx = context();
        await finish(ctx);
        expect(ctx.session.completedRun?.report.summary?.serverRows).toContainEqual({
            label: 'Authentication method',
            value: 'Managed identity · Azure US Government',
        });
    });

    it('reports the real failure, provider and firewall next steps without sending codes in result-card data', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => {
                const run = completedRun(options.runId ?? 'missing', 'ssh');
                return emitRun(options, {
                    ...run,
                    results: [
                        ...run.results,
                        {
                            ...result('authenticate'),
                            status: 'fail',
                            findings: [
                                {
                                    code: 'auth.serverSelectionTimeout',
                                    severity: 'error',
                                    data: {},
                                    detail: { language: 'en', text: 'Not visible detail.' },
                                },
                            ],
                        },
                        result('contextHints', { explanation: 'Start the stopped instance.' }),
                    ],
                });
            },
        );
        const ctx = context();
        const updates = await collect(await caller(ctx).run(runInput('default', 'initial')));
        const terminal = updates.at(-1);
        expect(terminal).toMatchObject({
            type: 'finished',
            outcome: 'failed',
            result: {
                outcome: 'failed',
                stoppedAtRow: 'authentication',
                firewallHint: true,
                headline: { title: 'No server selected' },
                providerHint: 'Start the stopped instance.',
            },
        });
        if (terminal?.type !== 'finished') {
            throw new Error('Expected finished');
        }
        expect(terminal.result.headline).not.toHaveProperty('code');
        expect(terminal.result.headline).not.toHaveProperty('checkId');
        await caller(ctx).copyReport({ runId: updates[0].runId, hideIdentifiers: false });
        const markdown = String(vi.mocked(vscode.env.clipboard.writeText).mock.calls.at(-1)?.[0]).replaceAll('\\', '');
        expect(markdown).toContain('## Summary');
        expect(markdown).toContain('Connection failed');
        expect(markdown).toContain('## Next steps');
        expect(markdown).toContain('Start the stopped instance.');
        const firewall =
            'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.';
        expect(markdown).toContain(firewall);
        const summary = ctx.session.completedRun?.report.summary;
        expect(summary?.nextSteps?.join(' ').split(firewall)).toHaveLength(2);
        expect(markdown).toContain('Checks ran on the remote host (ssh), not this computer.');
        expect(markdown).toContain(
            'When contacting support, share this report (use Hide identifiers in the report to replace host and identity details).',
        );
    });

    it.each([
        ['AzureCloud', 'public', 'Microsoft Authentication'],
        ['AzureUSGovernment', 'usgov', 'Microsoft Sovereign Cloud Authentication'],
        ['AzureChinaCloud', 'china', 'Microsoft Sovereign Cloud Authentication'],
        ['custom', 'custom', 'Microsoft Sovereign Cloud Authentication'],
    ] as const)(
        'reports earlier-in-session and silent-lookup notes for %s without changing not tested',
        async (configuredCloud, cloudCategory, log): Promise<void> => {
            vi.mocked(runConnectivityTroubleshooter).mockImplementation(
                async (options): Promise<DiagnosticsRun<FindingCode>> => {
                    const run = completedRun(options.runId ?? 'missing');
                    return emitRun(options, {
                        ...run,
                        results: [
                            ...run.results,
                            {
                                ...result('authenticate', {
                                    authMethod: 'MicrosoftEntraID',
                                    signInLimitation: 'silentLookupCannotDistinguishConsent',
                                    earlierInSession: { ruleId: 'firstPartyPreauthorization', ageSeconds: 120 },
                                }),
                                status: 'skipped',
                                skippedBecause: { reason: 'inputUnavailable' },
                                findings: [
                                    {
                                        code: 'auth.credentialsUnavailable',
                                        severity: 'info',
                                        data: { missing: 'entraSession' },
                                        detail: { language: 'en', text: 'Not visible detail.' },
                                    },
                                ],
                                steps: [
                                    {
                                        stepId: 'auth.signInConfiguration',
                                        status: 'pass',
                                        durationMs: 1,
                                        facts: { configuredCloud, cloudCategory },
                                        findings: [],
                                    },
                                ],
                            },
                        ],
                    });
                },
            );
            const ctx = context();
            const updates = await collect(await caller(ctx).run(runInput('default', 'initial')));
            expect(updates.at(-1)).toMatchObject({
                type: 'finished',
                outcome: 'notTested',
                result: { earlierSignInFailure: true, headline: { title: 'Sign-in needed' }, firewallHint: false },
            });
            await caller(ctx).copyReport({ runId: updates[0].runId, hideIdentifiers: false });
            const markdown = String(vi.mocked(vscode.env.clipboard.writeText).mock.calls.at(-1)?.[0]).replaceAll(
                '\\',
                '',
            );
            expect(markdown).toContain(
                'Earlier in this session: a sign-in for this connection failed (rule firstPartyPreauthorization, 2 minutes ago).',
            );
            expect(markdown).toContain('Developer: Show Logs… → ' + log);
            expect(markdown).toContain(
                'cannot distinguish not being signed in from a consent or preauthorization failure',
            );
            expect(markdown).toContain(
                "Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the check again.",
            );
        },
    );

    it('reports a whole-run timeout before an attempt without claiming an unreachable server', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => {
                const run = completedRun(options.runId ?? 'missing');
                return emitRun(options, {
                    ...run,
                    results: [
                        ...run.results,
                        {
                            ...result('authenticate'),
                            status: 'skipped',
                            skippedBecause: { reason: 'runTimeoutExceeded' },
                        },
                    ],
                });
            },
        );
        const ctx = context();
        const runId = await finish(ctx);
        const summary = ctx.session.completedRun?.report.summary;
        expect(summary?.outcome).toBe('notTested');
        expect(summary?.headline).toBeUndefined();
        expect(summary?.nextSteps?.join(' ')).toContain('expired before the connection was attempted');
        expect(summary?.nextSteps?.join(' ')).not.toMatch(/unreachable|firewall/);
        await caller(ctx).copyReport({ runId, hideIdentifiers: false });
    });

    it('Show opens localized Markdown and Copy writes the same snapshot without running checks', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        await actions.showDiagnostics({ runId, hideIdentifiers: false });
        const shown = vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls[0];
        expect(shown[0]).toMatch(/^Connection diagnostics(?: \(\d+\))?$/);
        expect(shown[0]).not.toContain(connectionName);
        expect(shown[1]).toContain('## Summary');
        expect(shown[1]).toContain('## Environment');
        expect(shown[1]).toContain('## Connection configuration');
        expect(shown[1].replaceAll('\\', '')).toContain('Checks ran on this computer.');
        expect(shown[1].replaceAll('\\', '')).toContain(host);
        expect(vscode.l10n.t).toHaveBeenCalledWith('Summary');
        await actions.copyReport({ runId, hideIdentifiers: false });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(shown[1]);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('The report was copied to the clipboard.');
        expect(runConnectivityTroubleshooter).toHaveBeenCalledTimes(1);
        expect(latestTelemetry().properties).toEqual({
            troubleshooterSessionId: 'session-id',
            troubleshooterRunCorrelationId: runId,
            reportFormat: 'markdown',
            reportRedacted: 'false',
            shareWarning: 'notShown',
        });
    });

    it.each([false, true])(
        'ends shown, copied and saved reports with the same attribution (hideIdentifiers=%s)',
        async (hideIdentifiers): Promise<void> => {
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers });
            await actions.copyReport({ runId, hideIdentifiers });
            vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/private/report.md'));
            await actions.saveReport({ runId, hideIdentifiers });
            const markdown = vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls[0][1];
            expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(markdown);
            expect(Buffer.from(vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0][1]).toString('utf8')).toBe(
                markdown,
            );
            expect(markdown.lastIndexOf('## ')).toBe(markdown.indexOf('## About this report'));
            const footer = markdown.slice(markdown.lastIndexOf('## About this report')).replaceAll('\\', '');
            expect(footer).toContain(
                'This report was generated using the DocumentDB extension for Visual Studio Code.',
            );
            expect(footer).toContain(
                '[Get the extension on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)',
            );
            expect(footer).toContain('Extension version: 1.2.3');
            expect(footer).toContain(`VS Code version: ${vscode.version}`);
            expect(footer).toContain(`Node.js: ${process.version}`);
            expect(footer).toContain('OS: ');
        },
    );

    it('includes version attribution when environment checks were skipped', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> => {
                const run = completedRun(options.runId ?? 'missing');
                return emitRun(options, {
                    ...run,
                    results: run.results.map((check): CheckResult<FindingCode> =>
                        ['environment', 'extensionEnvironment'].includes(check.checkId)
                            ? {
                                  ...check,
                                  status: 'skipped',
                                  facts: {},
                                  skippedBecause: { reason: 'runTimeoutExceeded' },
                              }
                            : check,
                    ),
                });
            },
        );
        const ctx = context();
        const runId = await finish(ctx);
        await caller(ctx).copyReport({ runId, hideIdentifiers: true });
        const markdown = vi.mocked(vscode.env.clipboard.writeText).mock.calls[0][0].replaceAll('\\', '');
        expect(markdown).toContain('Extension version: 1.2.3');
        expect(markdown).toContain(`VS Code version: ${vscode.version}`);
    });

    it('records a continued share warning on Copy and Save and shares as usual (0040)', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        await actions.copyReport({ runId, hideIdentifiers: false, shareWarningOutcome: 'continued' });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);
        expect(latestTelemetry().properties).toMatchObject({ shareWarning: 'shown', shareWarningOutcome: 'continued' });
        expect(latestTelemetry().properties.result).toBeUndefined();

        vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/private/report.md'));
        await actions.saveReport({ runId, hideIdentifiers: false, shareWarningOutcome: 'continued' });
        expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
        expect(latestTelemetry().properties).toMatchObject({ shareWarning: 'shown', shareWarningOutcome: 'continued' });
    });

    it('a cancelled share warning shares nothing and is recorded as cancelled, not failed (0040)', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        await expect(
            actions.copyReport({ runId, hideIdentifiers: false, shareWarningOutcome: 'cancelled' }),
        ).resolves.toBeUndefined();
        expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(latestTelemetry().properties).toMatchObject({
            shareWarning: 'shown',
            shareWarningOutcome: 'cancelled',
            result: 'Canceled',
        });

        await expect(
            actions.saveReport({ runId, hideIdentifiers: false, shareWarningOutcome: 'cancelled' }),
        ).resolves.toBeUndefined();
        expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
        expect(latestTelemetry().properties).toMatchObject({ shareWarningOutcome: 'cancelled', result: 'Canceled' });
    });

    it('hides connection and host identifiers in both the Markdown and document title', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        await actions.showDiagnostics({ runId, hideIdentifiers: true });
        const shown = vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls[0];
        expect(shown[0]).toMatch(/^Connection diagnostics(?: \(\d+\))?$/);
        expect(shown[0]).not.toContain(connectionName);
        expect(shown[1]).not.toContain(connectionName);
        expect(shown[1].replaceAll('\\', '')).not.toContain(host);
        await actions.copyReport({ runId, hideIdentifiers: true });
        expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(shown[1]);
        expect(latestTelemetry().properties.reportRedacted).toBe('true');
        expect(runConnectivityTroubleshooter).toHaveBeenCalledTimes(1);
    });

    describe('live report preview (WI-24)', () => {
        beforeEach(() => {
            vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mockRestore();
            vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
            readOnlyJsonDocumentProvider.dispose();
        });

        function previewUri(ctx: RouterContext): vscode.Uri {
            const uri = ctx.session.reportPreview?.uri;
            if (!uri) throw new Error('Expected a report URI');
            return uri;
        }

        function content(ctx: RouterContext): string {
            return readOnlyJsonDocumentProvider.provideTextDocumentContent(previewUri(ctx)).replaceAll('\\', '');
        }

        it('updates full and redacted content immediately without taking focus from the panel', async () => {
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            await expect(actions.showDiagnostics({ runId, hideIdentifiers: false })).resolves.toBe(true);
            expect(content(ctx)).toContain(host);
            await expect(actions.setReportIdentifiers({ runId, hideIdentifiers: true })).resolves.toBe(true);
            expect(content(ctx)).not.toContain(host);
            expect(content(ctx)).not.toContain(connectionName);
            expect(latestTelemetry().properties).toMatchObject({ reportRedacted: 'true', reportLiveRefresh: 'true' });
            await expect(actions.setReportIdentifiers({ runId, hideIdentifiers: false })).resolves.toBe(true);
            expect(content(ctx)).toContain(host);
            expect(content(ctx)).toContain(connectionName);
            // Only Show report opens the preview; toggles update it in place.
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
            expect(vscode.commands.executeCommand).toHaveBeenCalledWith('markdown.showPreview', previewUri(ctx));
        });

        it('does nothing with no open report, and rejects stale run IDs', async () => {
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            await expect(actions.setReportIdentifiers({ runId, hideIdentifiers: true })).resolves.toBe(false);
            expect(ctx.session.reportPreview).toBeUndefined();
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(latestTelemetry().properties.reportLiveRefresh).toBe('false');
            await expect(actions.setReportIdentifiers({ runId: 'stale', hideIdentifiers: true })).rejects.toThrow(
                'no longer available',
            );
        });

        it('reuses and reveals the document on repeated Show, with neutral distinct titles in both modes', async () => {
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers: false });
            const uri = previewUri(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers: true });
            expect(previewUri(ctx)).toBe(uri);
            expect(content(ctx)).not.toContain(host);
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, 'markdown.showPreview', uri);
            const other = context();
            const otherRunId = await finish(other);
            await caller(other).showDiagnostics({ runId: otherRunId, hideIdentifiers: true });
            for (const document of [uri, previewUri(other)]) {
                expect(document.path).toMatch(/^\/Connection diagnostics(?: \(\d+\))?\.md$/);
                expect(document.path).not.toContain(connectionName);
            }
            expect(previewUri(other).path).not.toBe(uri.path);
        });

        it('reopens after the last preview tab closes, without a toggle resurrecting the released document', async () => {
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers: false });
            const uri = previewUri(ctx);
            readOnlyJsonDocumentProvider.releaseUnshownMarkdownDocuments([
                {
                    label: `Preview ${uri.path.slice(1)}`,
                    input: { viewType: 'mainThreadWebview-markdown.preview' },
                } as vscode.Tab,
            ]);
            readOnlyJsonDocumentProvider.releaseDocument(uri);
            expect(content(ctx)).toContain(host);
            readOnlyJsonDocumentProvider.releaseUnshownMarkdownDocuments([]);
            await actions.setReportIdentifiers({ runId, hideIdentifiers: true });
            expect(readOnlyJsonDocumentProvider.provideTextDocumentContent(uri)).toBe('');
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
            await actions.showDiagnostics({ runId, hideIdentifiers: true });
            expect(previewUri(ctx).toString()).not.toBe(uri.toString());
            expect(previewUri(ctx).path).toBe(uri.path);
            expect(content(ctx)).not.toContain(host);
            expect(content(ctx)).toContain('## Summary');
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
        });

        it('keeps the previous report during a re-run, applies toggles, and switches in place on completion', async () => {
            const ctx = context();
            const actions = caller(ctx);
            const runId = await finish(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers: false });
            const uri = previewUri(ctx);
            const next = deferred<DiagnosticsRun<FindingCode>>();
            vi.mocked(runConnectivityTroubleshooter).mockImplementationOnce(() => next.promise);
            const stream = iterator(await actions.run(runInput('default', 'rerun')));
            const started = (await stream.next()).value;
            if (!started) throw new Error('Expected started');
            expect(content(ctx)).toContain(runId);
            await actions.setReportIdentifiers({ runId: started.runId, hideIdentifiers: true });
            expect(content(ctx)).not.toContain(host);
            expect(content(ctx)).toContain(runId);
            const finished = stream.next();
            next.resolve(completedRun(started.runId));
            await finished;
            await stream.next();
            expect(previewUri(ctx)).toBe(uri);
            expect(content(ctx)).toContain(started.runId);
            expect(content(ctx)).not.toContain(runId);
            expect(content(ctx)).not.toContain(host);
            // Only the initial Show report opened the preview; the toggle and completion update it in place.
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
            await expect(actions.showDiagnostics({ runId, hideIdentifiers: false })).rejects.toThrow(
                'no longer available',
            );
        });

        it('keeps the previous report after a cancelled re-run and still applies the current toggle', async () => {
            const ctx = context();
            const actions = caller(ctx);
            const runId = await finish(ctx);
            await actions.showDiagnostics({ runId, hideIdentifiers: false });
            const uri = previewUri(ctx);
            const pending = deferred<DiagnosticsRun<FindingCode>>();
            vi.mocked(runConnectivityTroubleshooter).mockReturnValueOnce(pending.promise);
            const input = runInput('default', 'rerun');
            const stream = iterator(await actions.run(input));
            const started = (await stream.next()).value;
            if (!started) throw new Error('Expected started');
            await actions.cancel({ requestId: input.requestId });
            await collect(stream);
            pending.resolve(completedRun(started.runId));
            await actions.setReportIdentifiers({ runId: started.runId, hideIdentifiers: true });
            expect(previewUri(ctx)).toBe(uri);
            expect(content(ctx)).toContain(runId);
            expect(content(ctx)).not.toContain(started.runId);
            expect(content(ctx)).not.toContain(host);
            expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('markdown.showPreview', uri);
        });

        it('keeps one document when Show is clicked again while the first preview is opening', async () => {
            const opening = deferred<undefined>();
            vi.mocked(vscode.commands.executeCommand).mockImplementationOnce(() => opening.promise);
            const ctx = context();
            const runId = await finish(ctx);
            const actions = caller(ctx);
            const first = actions.showDiagnostics({ runId, hideIdentifiers: false });
            const second = actions.showDiagnostics({ runId, hideIdentifiers: true });
            opening.resolve(undefined);
            await Promise.all([first, second]);
            const uris = vi.mocked(vscode.commands.executeCommand).mock.calls.map((call): string => String(call[1]));
            expect(new Set(uris).size).toBe(1);
            expect(content(ctx)).not.toContain(host);
        });
    });

    it('derives the report execution location from the completed extensionEnvironment result', async (): Promise<void> => {
        vi.mocked(runConnectivityTroubleshooter).mockImplementation(
            async (options): Promise<DiagnosticsRun<FindingCode>> =>
                emitRun(options, completedRun(options.runId ?? 'missing', 'ssh')),
        );
        const ctx = context();
        const runId = await finish(ctx);
        await caller(ctx).showDiagnostics({ runId, hideIdentifiers: false });
        expect(
            vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls[0][1].replaceAll('\\', ''),
        ).toContain('Checks ran on the remote host (ssh), not this computer.');
    });

    it('Save JSON writes a redacted snapshot and telemetry contains neither the path nor the content', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const uri = vscode.Uri.file('/private/save-location/report.json');
        vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(uri);
        await caller(ctx).saveReport({ runId, hideIdentifiers: true });
        const [destination, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
        expect(destination).toBe(uri);
        const content = Buffer.from(bytes).toString('utf8');
        expect(content).toContain('"redacted"');
        expect(content).not.toContain(host);
        expect(content).not.toContain(connectionName);
        expect(JSON.parse(content)).toMatchObject({
            generatedBy: {
                description: 'This report was generated using the DocumentDB extension for Visual Studio Code.',
                marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb',
                extensionVersion: '1.2.3',
                extensionChannel: 'stable',
                vscodeVersion: vscode.version,
                nodeVersion: process.version,
                osInfo: expect.any(String),
            },
        });
        expect(content.indexOf('"generatedBy"')).toBeGreaterThan(content.indexOf('"redacted"'));
        const telemetry = latestTelemetry();
        expect(telemetry.properties).toEqual({
            troubleshooterSessionId: 'session-id',
            troubleshooterRunCorrelationId: runId,
            reportFormat: 'json',
            reportRedacted: 'true',
            shareWarning: 'notShown',
        });
        expect(JSON.stringify(telemetry)).not.toContain(uri.path);
        expect(JSON.stringify(telemetry)).not.toContain(content);
        expect(runConnectivityTroubleshooter).toHaveBeenCalledTimes(1);
        const dialog = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
        expect(Object.keys(dialog?.filters ?? {})).toEqual(['Markdown', 'JSON']);
        expect(dialog?.defaultUri?.path).toMatch(/connection-diagnostics-\d{8}-\d{4}\.md$/);
    });

    it('Save defaults to Markdown and uses the same content as Show', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        const actions = caller(ctx);
        await actions.showDiagnostics({ runId, hideIdentifiers: false });
        vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/private/report.md'));
        await actions.saveReport({ runId, hideIdentifiers: false });
        const bytes = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0][1];
        expect(Buffer.from(bytes).toString('utf8')).toBe(
            vi.mocked(readOnlyJsonDocumentProvider.openMarkdownDocument).mock.calls[0][1],
        );
        expect(latestTelemetry().properties.reportFormat).toBe('markdown');
        expect(runConnectivityTroubleshooter).toHaveBeenCalledTimes(1);
    });

    it('a dismissed Save throws UserCancelledError and writes nothing', async (): Promise<void> => {
        const ctx = context();
        const runId = await finish(ctx);
        await expect(caller(ctx).saveReport({ runId, hideIdentifiers: false })).rejects.toMatchObject({
            cause: expect.any(UserCancelledError),
        });
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
        expect(runConnectivityTroubleshooter).toHaveBeenCalledTimes(1);
        expect(latestTelemetry().properties.reportFormat).toBe('markdown');
    });
});
