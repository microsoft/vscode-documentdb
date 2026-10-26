/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';

import { UserCancelledError, type IActionContext, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import * as path from 'path';
import * as vscode from 'vscode';
import * as workerThreads from 'worker_threads';
import { Worker } from 'worker_threads';
import { ext } from '../../extensionVariables';
import { traceAuthFlow, type AuthTraceContext } from '../../utils/authTrace';
import { AuthMethodId } from '../auth/AuthMethod';
import { CredentialCache } from '../CredentialCache';
import { ShellSessionManager } from '../shell/ShellSessionManager';
import {
    prepareDriverConnectionString,
    type PreparedDriverConnectionString,
} from '../srv/prepareDriverConnectionString';
import { PlaygroundEvaluator } from './PlaygroundEvaluator';
import {
    WorkerSessionManager,
    type WorkerSessionCallbacks,
    type WorkerStartupTelemetryContext,
} from './WorkerSessionManager';
import { type MainToWorkerMessage } from './workerTypes';

interface RecordedTelemetry {
    readonly eventName: string;
    readonly telemetry: ITelemetryContext;
    error?: unknown;
}

const mockTelemetryEvents: RecordedTelemetry[] = [];

vi.mock('@microsoft/vscode-azext-utils', async () => {
    const actual = await vi.importActual<{ UserCancelledError: typeof UserCancelledError }>(
        '@microsoft/vscode-azext-utils',
    );
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: vi.fn(
            async (eventName: string, callback: (context: IActionContext) => Promise<unknown>): Promise<unknown> => {
                const context = {
                    telemetry: { properties: {}, measurements: {} },
                    errorHandling: { issueProperties: {} },
                    valuesToMask: [],
                } as unknown as IActionContext;
                const event: RecordedTelemetry = { eventName, telemetry: context.telemetry };
                const startedAt = Date.now();
                try {
                    const result = await callback(context);
                    context.telemetry.properties.result = 'Succeeded';
                    return result;
                } catch (error) {
                    event.error = error;
                    if (error instanceof actual.UserCancelledError) {
                        context.telemetry.properties.result = 'Canceled';
                        return undefined;
                    }
                    context.telemetry.properties.result = 'Failed';
                    if (context.errorHandling.rethrow) {
                        throw error;
                    }
                    return undefined;
                } finally {
                    context.telemetry.measurements.duration = (Date.now() - startedAt) / 1000;
                    mockTelemetryEvents.push(event);
                }
            },
        ),
    };
});

vi.mock('../../extensionVariables', () => ({
    ext: {
        context: { extensionPath: '/extension-root' },
        outputChannel: {
            trace: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    },
}));

vi.mock('../srv/prepareDriverConnectionString', () => ({
    prepareDriverConnectionString: vi.fn(),
}));

vi.mock('../CredentialCache', () => ({
    CredentialCache: {
        getCredentials: vi.fn(),
        getConnectionStringWithPassword: vi.fn(),
        getConnectionUser: vi.fn(),
    },
}));

vi.mock('../../utils/workspacUtils', () => ({
    getConnectionTimeoutMs: vi.fn().mockReturnValue(30000),
    getBatchSizeSetting: vi.fn().mockReturnValue(20),
}));

// Mock worker_threads — the WorkerSessionManager creates Worker instances
vi.mock('worker_threads', () => {
    const mockPostMessage = vi.fn();
    const mockTerminate = vi.fn().mockResolvedValue(0);
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    const MockWorker = vi.fn().mockImplementation(function () {
        return {
            postMessage: mockPostMessage,
            terminate: mockTerminate,
            on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
                const existing = listeners.get(event) ?? [];
                existing.push(handler);
                listeners.set(event, existing);
            }),
            _emit: (event: string, ...args: unknown[]) => {
                const handlers = listeners.get(event) ?? [];
                for (const handler of handlers) {
                    handler(...args);
                }
            },
            _listeners: listeners,
        };
    });

    return {
        Worker: MockWorker,
        _mockPostMessage: mockPostMessage,
        _mockTerminate: mockTerminate,
        _getListeners: (): Map<string, ((...args: unknown[]) => void)[]> => listeners,
        _resetListeners: (): void => {
            listeners.clear();
        },
    };
});

describe('WorkerSessionManager', () => {
    let callbacks: WorkerSessionCallbacks;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        mockTelemetryEvents.length = 0;
        vi.mocked(prepareDriverConnectionString).mockImplementation(async (input) => ({
            connectionString: input.connectionString,
            options: input.options,
            srvResolution: 'notSrv',
        }));
        // Reset listeners between tests
        const wt = workerThreads as unknown as { _resetListeners: () => void };
        wt._resetListeners();

        callbacks = {
            onConsoleOutput: vi.fn(),
            onLog: vi.fn(),
            onTokenRequest: vi.fn(),
            onWorkerExit: vi.fn(),
        };
    });

    describe('initial state', () => {
        it('starts in idle state', () => {
            const manager = new WorkerSessionManager(callbacks);
            expect(manager.workerState).toBe('idle');
            expect(manager.workerClusterId).toBeUndefined();
            expect(manager.isAlive).toBe(false);
        });

        it('isConnectedTo returns false when no worker exists', () => {
            const manager = new WorkerSessionManager(callbacks);
            expect(manager.isConnectedTo('cluster-1')).toBe(false);
        });
    });

    describe('dispose', () => {
        it('can be disposed without errors when no worker is running', () => {
            const manager = new WorkerSessionManager(callbacks);
            expect(() => manager.dispose()).not.toThrow();
        });

        it('resets state on dispose', () => {
            const manager = new WorkerSessionManager(callbacks);
            manager.dispose();
            expect(manager.workerState).toBe('idle');
            expect(manager.workerClusterId).toBeUndefined();
            expect(manager.isAlive).toBe(false);
        });
    });

    describe('killWorker', () => {
        it('can be called when no worker is running', () => {
            const manager = new WorkerSessionManager(callbacks);
            expect(() => manager.killWorker()).not.toThrow();
        });
    });

    describe('initialization timeout', () => {
        it('explains the failed connection and identifies the timeout setting', async () => {
            vi.useFakeTimers();
            const manager = new WorkerSessionManager(callbacks);
            const initPromise = manager.ensureWorker(
                'cluster-1',
                {
                    type: 'init',
                    requestId: '',
                    connectionString: 'mongodb://cluster-1:27017',
                    clientOptions: {} as never,
                    databaseName: 'testdb',
                    authMechanism: 'NativeAuth',
                },
                1000,
            );

            await Promise.resolve();
            expect(vi.mocked(Worker)).toHaveBeenCalledWith(path.join('/extension-root', 'playgroundWorker.mjs'));

            vi.advanceTimersByTime(1000);

            await expect(initPromise).rejects.toMatchObject({
                message:
                    'Operation timed out after 1 seconds. Last startup stage: Starting worker (1.0 seconds in this stage).',
                settingKey: 'documentDB.connectionTimeout',
                settingsHint: 'The connection did not finish in time. You can increase the timeout in Settings:',
            });
            vi.useRealTimers();
        });
    });

    describe('host DNS preparation', (): void => {
        const originalUri = 'mongodb+srv://cluster.mongocluster.cosmos.azure.us/?srvMaxHosts=1';
        const rewrittenUri = 'mongodb://resolved.mongocluster.cosmos.azure.com:10260/?tls=true';

        function initMessage(persistent = false): Extract<MainToWorkerMessage, { type: 'init' }> {
            return {
                type: 'init',
                requestId: '',
                connectionString: originalUri,
                clientOptions: { serverSelectionTimeoutMS: 4000, tlsAllowInvalidCertificates: true },
                databaseName: 'testdb',
                authMechanism: 'NoAuth',
                persistent,
            };
        }

        function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
            let resolve!: (value: T) => void;
            const promise = new Promise<T>((res): void => {
                resolve = res;
            });
            return { promise, resolve };
        }

        function workerMock(): {
            postMessage: Mock;
            _emit: (event: string, ...args: unknown[]) => void;
        } {
            return vi.mocked(Worker).mock.results.at(-1)?.value as ReturnType<typeof workerMock>;
        }

        function replyInit(): Extract<MainToWorkerMessage, { type: 'init' }> {
            const worker = workerMock();
            const posted = worker.postMessage.mock.calls.at(-1)?.[0] as Extract<MainToWorkerMessage, { type: 'init' }>;
            worker._emit('message', { type: 'initResult', requestId: posted.requestId, success: true });
            return posted;
        }

        function startupEvent(): RecordedTelemetry {
            return mockTelemetryEvents.find((event) => event.eventName === 'worker.startup')!;
        }

        it('passes the configured custom hostname suffix to the worker allowlist', async (): Promise<void> => {
            vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                get: vi.fn().mockReturnValue({ mongoClusterHostnameSuffix: '.database.example.com' }),
            } as unknown as vscode.WorkspaceConfiguration);
            const manager = new WorkerSessionManager(callbacks);
            const initializing = manager.ensureWorker(
                'cluster-id',
                { ...initMessage(), connectionString: 'mongodb://cluster.database.example.com/' },
                1000,
            );
            await Promise.resolve();
            const posted = replyInit();
            await initializing;
            expect(posted.oidcAllowedHosts).toEqual(['*.database.example.com']);
            manager.dispose();
        });

        it('posts only serializable prepared options without changing the input', async (): Promise<void> => {
            const input = Object.freeze({
                ...initMessage(),
                clientOptions: Object.freeze({ ...initMessage().clientOptions }),
            });
            const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
            vi.mocked(prepareDriverConnectionString).mockResolvedValue({
                connectionString: rewrittenUri,
                options: {
                    serverSelectionTimeoutMS: 8000,
                    tls: true,
                    authMechanismProperties: { OIDC_CALLBACK: vi.fn() },
                },
                srvResolution: 'fallback',
            });
            const manager = new WorkerSessionManager(callbacks);
            const initializing = manager.ensureWorker('cluster-id', input, 1000, { sessionId: 'playground-session' });
            await Promise.resolve();
            const posted = replyInit();
            await initializing;

            expect(posted).toMatchObject({
                connectionString: rewrittenUri,
                clientOptions: { serverSelectionTimeoutMS: 8000, tls: true },
                oidcAllowedHosts: ['*.azure.us'],
            });
            expect(() => structuredClone(posted)).not.toThrow();
            expect(input).toEqual(snapshot);
            expect(vi.mocked(prepareDriverConnectionString).mock.calls[0][0]).toMatchObject({
                connectionString: originalUri,
                surface: 'playground',
                correlation: { sessionId: 'playground-session', startupCorrelationId: posted.requestId },
                abortSignal: expect.any(AbortSignal),
            });
            manager.dispose();
        });

        it.each([
            ['playground', 'shutdown'],
            ['shell', 'killWorker'],
        ] as const)(
            'R2: %s %s during pending DNS rejects startup and never sends code',
            async (surface, method): Promise<void> => {
                const pending = deferred<PreparedDriverConnectionString>();
                vi.mocked(prepareDriverConnectionString).mockReturnValue(pending.promise);
                vi.mocked(CredentialCache.getCredentials).mockReturnValue({
                    clusterId: 'cluster-id',
                    authMechanism: AuthMethodId.NoAuth,
                    connectionString: originalUri,
                });
                const ensureSpy = vi.spyOn(WorkerSessionManager.prototype, 'ensureWorker');
                const evalSpy = vi.spyOn(WorkerSessionManager.prototype, 'sendEval');
                const session =
                    surface === 'shell'
                        ? new ShellSessionManager({
                              clusterId: 'cluster-id',
                              clusterDisplayName: 'Cluster',
                              databaseName: 'testdb',
                          })
                        : new PlaygroundEvaluator();
                try {
                    const evaluation =
                        session instanceof PlaygroundEvaluator
                            ? session.evaluate(
                                  { clusterId: 'cluster-id', clusterDisplayName: 'Cluster', databaseName: 'testdb' },
                                  'db.test.insertOne({})',
                              )
                            : session.evaluate('db.test.insertOne({})');
                    const ensuring = ensureSpy.mock.results.at(-1)?.value as Promise<void>;
                    const signal = vi.mocked(prepareDriverConnectionString).mock.calls[0][0].abortSignal;
                    expect(session.workerState).toBe('spawning');
                    expect(Worker).not.toHaveBeenCalled();
                    await session[method]();
                    expect(signal?.aborted).toBe(true);
                    expect(session.workerState).toBe('idle');
                    pending.resolve({ connectionString: rewrittenUri, options: {}, srvResolution: 'fallback' });
                    await expect(ensuring).rejects.toBeInstanceOf(UserCancelledError);
                    await expect(evaluation).rejects.toBeInstanceOf(UserCancelledError);
                    expect(Worker).not.toHaveBeenCalled();
                    expect(evalSpy).not.toHaveBeenCalled();
                    const wt = workerThreads as unknown as { _mockPostMessage: Mock };
                    expect(wt._mockPostMessage).not.toHaveBeenCalled();
                    expect(startupEvent().telemetry.properties).toMatchObject({
                        startupOutcome: 'canceled',
                        result: 'Canceled',
                    });
                    expect(session.workerState).toBe('idle');
                } finally {
                    session.dispose();
                    ensureSpy.mockRestore();
                    evalSpy.mockRestore();
                }
            },
        );

        it('does not let a canceled preparation terminate a newer startup', async (): Promise<void> => {
            const pending = deferred<PreparedDriverConnectionString>();
            vi.mocked(prepareDriverConnectionString).mockReturnValueOnce(pending.promise);
            const manager = new WorkerSessionManager(callbacks);
            const canceled = manager.ensureWorker('cluster-id', initMessage());
            manager.killWorker();
            const retry = manager.ensureWorker('cluster-id', initMessage());
            await Promise.resolve();
            replyInit();
            await retry;
            pending.resolve({ connectionString: rewrittenUri, options: {}, srvResolution: 'fallback' });
            await expect(canceled).rejects.toBeInstanceOf(UserCancelledError);
            expect(Worker).toHaveBeenCalledTimes(1);
            expect(manager.workerState).toBe('ready');
            manager.dispose();
        });

        it('rejects preparation failure with the same error object before creating a worker', async (): Promise<void> => {
            const error = Object.assign(new Error('querySrv EBADRESP private-host'), { code: 'EBADRESP' });
            vi.mocked(prepareDriverConnectionString).mockRejectedValue(error);
            const manager = new WorkerSessionManager(callbacks);
            await expect(manager.ensureWorker('cluster-id', initMessage())).rejects.toBe(error);
            expect(Worker).not.toHaveBeenCalled();
            expect(manager.workerState).toBe('idle');
            expect(startupEvent().telemetry.properties).toMatchObject({ startupOutcome: 'failed', result: 'Failed' });
            expect(JSON.stringify(startupEvent())).not.toContain('private-host');
        });

        it('starts the full init timeout only after preparation completes', async (): Promise<void> => {
            vi.useFakeTimers();
            const pending = deferred<PreparedDriverConnectionString>();
            vi.mocked(prepareDriverConnectionString).mockReturnValue(pending.promise);
            const manager = new WorkerSessionManager(callbacks);
            try {
                const initializing = manager.ensureWorker('cluster-id', initMessage(), 1000);
                vi.advanceTimersByTime(5000);
                expect(Worker).not.toHaveBeenCalled();
                pending.resolve({ connectionString: rewrittenUri, options: {}, srvResolution: 'fallback' });
                await Promise.resolve();
                expect(Worker).toHaveBeenCalledTimes(1);
                vi.advanceTimersByTime(999);
                expect(manager.workerState).toBe('spawning');
                replyInit();
                await initializing;
                expect(startupEvent().telemetry.measurements.timeoutMs).toBe(1000);
                expect(startupEvent().telemetry.measurements.duration).toBe(5.999);
            } finally {
                manager.dispose();
                vi.useRealTimers();
            }
        });

        it('passes the OIDC mechanism to preparation but not to the worker', async (): Promise<void> => {
            vi.mocked(prepareDriverConnectionString).mockImplementation(async (input) => ({
                connectionString: rewrittenUri,
                options: input.options,
                srvResolution: 'fallback',
            }));
            const manager = new WorkerSessionManager(callbacks);
            const initializing = manager.ensureWorker('cluster-id', {
                ...initMessage(),
                authMechanism: 'MicrosoftEntraID',
            });
            await vi.mocked(prepareDriverConnectionString).mock.results[0].value;
            const posted = replyInit();
            await initializing;
            expect(vi.mocked(prepareDriverConnectionString).mock.calls[0][0].options).toMatchObject({
                authMechanism: 'MONGODB-OIDC',
            });
            expect(posted.clientOptions).not.toHaveProperty('authMechanism');
            manager.dispose();
        });

        it('keeps the original SRV host in shell connection metadata used by the banner', async (): Promise<void> => {
            vi.mocked(CredentialCache.getCredentials).mockReturnValue({
                clusterId: 'cluster-id',
                authMechanism: AuthMethodId.NoAuth,
                connectionString: originalUri,
            });
            vi.mocked(prepareDriverConnectionString).mockResolvedValue({
                connectionString: rewrittenUri,
                options: {},
                srvResolution: 'fallback',
            });
            const session = new ShellSessionManager({
                clusterId: 'cluster-id',
                clusterDisplayName: 'Cluster',
                databaseName: 'testdb',
            });
            const initializing = session.initialize();
            await Promise.resolve();
            const posted = replyInit();
            const metadata = await initializing;
            expect(posted.connectionString).toBe(rewrittenUri);
            expect(metadata).toMatchObject({ host: 'cluster.mongocluster.cosmos.azure.us', additionalHostCount: 0 });
            session.dispose();
        });
    });

    describe('startup tracking', () => {
        let trace: MockInstance;

        beforeEach(() => {
            vi.useFakeTimers();
            trace = vi.spyOn(ext.outputChannel, 'trace');
        });

        afterEach(() => {
            trace.mockRestore();
            vi.useRealTimers();
        });

        function startupEvent(): RecordedTelemetry {
            const events = mockTelemetryEvents.filter((event) => event.eventName === 'worker.startup');
            expect(events).toHaveLength(1);
            return events[0];
        }

        async function startWorker(
            persistent: boolean = true,
            telemetryContext: WorkerStartupTelemetryContext = {},
            manager: WorkerSessionManager = new WorkerSessionManager(callbacks),
        ): Promise<{
            manager: WorkerSessionManager;
            initPromise: Promise<void>;
            requestId: string;
            worker: { _emit: (event: string, ...args: unknown[]) => void };
        }> {
            const initPromise = manager.ensureWorker(
                'test-cluster',
                {
                    type: 'init',
                    requestId: '',
                    connectionString: 'mongodb://private-user:private-password@private-host:27017',
                    clientOptions: {},
                    databaseName: 'private-database',
                    authMechanism: 'MicrosoftEntraID',
                    tenantId: 'private-tenant',
                    persistent,
                },
                1000,
                telemetryContext,
            );
            await Promise.resolve();
            const worker = vi.mocked(Worker).mock.results.at(-1)?.value as {
                postMessage: Mock;
                _emit: (event: string, ...args: unknown[]) => void;
            };
            const initMessage = worker.postMessage.mock.calls.at(-1)?.[0] as MainToWorkerMessage;
            return { manager, initPromise, requestId: initMessage.requestId, worker };
        }

        it('reports a stalled token request with total and stage timings without connection details', async () => {
            const { initPromise, requestId, worker } = await startWorker();
            vi.advanceTimersByTime(200);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            vi.advanceTimersByTime(800);

            await expect(initPromise).rejects.toMatchObject({
                message:
                    'Operation timed out after 1 seconds. Last startup stage: Waiting for authentication token (0.8 seconds in this stage).',
                settingKey: 'documentDB.connectionTimeout',
            });
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} timedOut surface=shell auth=MicrosoftEntraID lastStage=stage04AcquiringToken elapsedMs=1000 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":200,"stage04AcquiringToken":800} costTimingsMs={}`,
            );
            expect(ext.outputChannel.error).toHaveBeenCalledTimes(1);
            expect(trace).not.toHaveBeenCalled();
            expect(trace.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(/private-/);
            expect(vi.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
            expect(startupEvent().telemetry).toMatchObject({
                maskEntireErrorMessage: true,
                properties: {
                    startupCorrelationId: requestId,
                    surface: 'shell',
                    authMethod: 'MicrosoftEntraID',
                    result: 'Failed',
                    startupOutcome: 'timedOut',
                    lastStage: 'stage04AcquiringToken',
                },
                measurements: {
                    timeoutMs: 1000,
                    stage01StartingWorkerDurationMs: 200,
                    stage04AcquiringTokenDurationMs: 800,
                    lastStageDurationMs: 800,
                    duration: 1,
                },
            });
        });

        it('logs one successful startup summary, ignoring stale progress', async () => {
            const { manager, initPromise, requestId, worker } = await startWorker();
            worker._emit('message', { type: 'log', level: 'debug', message: 'Initializing worker' });
            expect(callbacks.onLog).toHaveBeenCalledWith('debug', 'Initializing worker', requestId);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            vi.advanceTimersByTime(150);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'authenticating' });
            expect(trace).not.toHaveBeenCalled();
            worker._emit('message', { type: 'initProgress', requestId: 'stale-request', stage: 'loadingDriver' });
            vi.advanceTimersByTime(50);
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;
            expect(trace).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} succeeded surface=shell auth=MicrosoftEntraID lastStage=stage05Authenticating elapsedMs=200 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":0,"stage04AcquiringToken":150,"stage05Authenticating":50} costTimingsMs={}`,
            );
            expect(trace).toHaveBeenCalledTimes(1);
            expect(ext.outputChannel.error).not.toHaveBeenCalled();

            expect(startupEvent().telemetry.properties).toMatchObject({
                startupOutcome: 'succeeded',
                result: 'Succeeded',
                lastStage: 'stage05Authenticating',
            });
            expect(startupEvent().telemetry.measurements).toMatchObject({
                stage04AcquiringTokenDurationMs: 150,
                stage05AuthenticatingDurationMs: 50,
                lastStageDurationMs: 50,
            });
            expect(startupEvent().telemetry.measurements.stage02LoadingDriverDurationMs).toBeUndefined();

            trace.mockClear();
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            expect(trace).not.toHaveBeenCalled();
            worker._emit('message', { type: 'log', level: 'debug', message: 'Evaluating query' });
            expect(callbacks.onLog).toHaveBeenCalledWith('debug', 'Evaluating query', requestId);
            manager.dispose();
        });

        it('logs the failed stage at error level without changing or logging the authentication error', async () => {
            const { initPromise, requestId, worker } = await startWorker();
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            worker._emit('message', { type: 'initResult', requestId, success: false, error: 'private-error' });

            await expect(initPromise).rejects.toThrow('private-error');
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} failed surface=shell auth=MicrosoftEntraID lastStage=stage04AcquiringToken elapsedMs=0 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":0,"stage04AcquiringToken":0} costTimingsMs={}`,
            );
            expect(trace.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(/private-/);
            expect(vi.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
            const event = startupEvent();
            expect(event.telemetry.properties).toMatchObject({ startupOutcome: 'failed', result: 'Failed' });
            expect(event.error).toMatchObject({ message: 'Worker startup failed', stack: undefined });
            expect(JSON.stringify(event)).not.toMatch(/private-/);
        });

        it('logs an unexpected startup exit at error level', async () => {
            const { initPromise, requestId, worker } = await startWorker();
            vi.advanceTimersByTime(100);
            worker._emit('exit', 1);

            await expect(initPromise).rejects.toThrow('Worker exited unexpectedly');
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} exited surface=shell auth=MicrosoftEntraID lastStage=stage01StartingWorker elapsedMs=100 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":100} costTimingsMs={}`,
            );
            expect(startupEvent().telemetry.properties).toMatchObject({ startupOutcome: 'exited', result: 'Failed' });
        });

        it('ignores a killed worker that exits while its replacement starts', async (): Promise<void> => {
            const first = await startWorker();
            first.worker._emit('message', { type: 'initResult', requestId: first.requestId, success: true });
            await first.initPromise;
            const wt = workerThreads as unknown as {
                _getListeners: () => Map<string, ((...args: unknown[]) => void)[]>;
                _resetListeners: () => void;
            };
            const staleExit = [...(wt._getListeners().get('exit') ?? [])];
            const staleError = [...(wt._getListeners().get('error') ?? [])];
            wt._resetListeners();
            first.manager.killWorker();

            const second = await startWorker(true, {}, first.manager);
            staleError.forEach((handler) => handler(new Error('stale worker error')));
            staleExit.forEach((handler) => handler(1));
            second.worker._emit('message', { type: 'initResult', requestId: second.requestId, success: true });
            await second.initPromise;

            expect(callbacks.onLog).toHaveBeenCalledWith('debug', 'Worker exited with code 1', first.requestId);
            expect(callbacks.onWorkerExit).not.toHaveBeenCalled();
            expect(first.manager.workerState).toBe('ready');
            const startups = mockTelemetryEvents.filter((event) => event.eventName === 'worker.startup');
            expect(startups.map((event) => event.telemetry.properties.startupOutcome)).toEqual([
                'succeeded',
                'succeeded',
            ]);
            expect(mockTelemetryEvents.some((event) => event.eventName === 'worker.unexpectedExit')).toBe(false);
            first.manager.dispose();
        });

        it('keeps intentional startup cancellation at trace level', async () => {
            const { manager, initPromise, requestId } = await startWorker();
            manager.dispose();

            await expect(initPromise).rejects.toThrow('Worker terminated');
            expect(trace).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} terminated surface=shell auth=MicrosoftEntraID lastStage=stage01StartingWorker elapsedMs=0 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":0} costTimingsMs={}`,
            );
            expect(ext.outputChannel.error).not.toHaveBeenCalled();
            expect(startupEvent().telemetry.properties).toMatchObject({
                startupOutcome: 'canceled',
                result: 'Canceled',
            });
        });

        it('accumulates repeated stages and keeps the last visit duration separately', async () => {
            const { initPromise, requestId, worker } = await startWorker();
            vi.advanceTimersByTime(100);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            vi.advanceTimersByTime(200);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'authenticating' });
            vi.advanceTimersByTime(100);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            vi.advanceTimersByTime(600);

            await expect(initPromise).rejects.toThrow('Waiting for authentication token (0.6 seconds in this stage)');
            expect(startupEvent().telemetry.measurements).toMatchObject({
                stage01StartingWorkerDurationMs: 100,
                stage04AcquiringTokenDurationMs: 800,
                stage05AuthenticatingDurationMs: 100,
                lastStageDurationMs: 600,
            });
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    'stageDurationsMs={"stage01StartingWorker":100,"stage04AcquiringToken":800,"stage05Authenticating":100}',
                ),
            );
        });

        it('keeps all reported stage names in execution order when sorted', async () => {
            const { manager, initPromise, requestId, worker } = await startWorker();
            for (const stage of [
                'loadingDriver',
                'connecting',
                'acquiringToken',
                'authenticating',
                'initializingRuntime',
            ]) {
                vi.advanceTimersByTime(10);
                worker._emit('message', { type: 'initProgress', requestId, stage });
            }
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;

            expect(
                Object.keys(startupEvent().telemetry.measurements)
                    .filter((name) => name.startsWith('stage'))
                    .sort(),
            ).toEqual([
                'stage01StartingWorkerDurationMs',
                'stage02LoadingDriverDurationMs',
                'stage03ConnectingDurationMs',
                'stage04AcquiringTokenDurationMs',
                'stage05AuthenticatingDurationMs',
                'stage06InitializingRuntimeDurationMs',
            ]);
            manager.dispose();
        });

        it('bundles provider, relay, and database cost into the same event and summary', async () => {
            const { manager, initPromise, requestId, worker } = await startWorker();
            const timing = (activity: 'databaseConnect' | 'tokenWait', activityId: string, started: boolean): void => {
                worker._emit('message', { type: 'initTiming', requestId, activity, activityId, started });
            };
            callbacks.onTokenRequest = vi.fn(async (message, postResponse, timings): Promise<void> => {
                const stop = timings?.startTokenAcquire();
                vi.advanceTimersByTime(20);
                stop?.();
                postResponse({ type: 'tokenResponse', requestId: message.requestId, accessToken: 'private-token' });
            });
            timing('databaseConnect', requestId, true);
            vi.advanceTimersByTime(10);
            timing('tokenWait', 'token-request', true);
            timing('tokenWait', 'token-request', true);
            vi.advanceTimersByTime(5);
            worker._emit('message', { type: 'tokenRequest', requestId: 'token-request' });
            vi.advanceTimersByTime(5);
            timing('tokenWait', 'token-request', false);
            vi.advanceTimersByTime(10);
            timing('databaseConnect', requestId, false);
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;

            expect(startupEvent().telemetry.measurements).toMatchObject({
                tokenAcquireDurationMs: 20,
                databaseConnectDurationMs: 20,
                tokenRelayDurationMs: 10,
            });
            expect(trace).toHaveBeenCalledTimes(1);
            expect(trace).toHaveBeenCalledWith(
                expect.stringContaining(
                    'costTimingsMs={"databaseConnectDurationMs":20,"tokenRelayDurationMs":10,"tokenAcquireDurationMs":20}',
                ),
            );
            expect(JSON.stringify(startupEvent())).not.toContain('private-');
            manager.dispose();
        });

        it('freezes partial worker timings on timeout and ignores late provider completion', async () => {
            let finishProvider: (() => void) | undefined;
            callbacks.onTokenRequest = vi.fn((message, postResponse, timings): Promise<void> => {
                const stop = timings?.startTokenAcquire();
                return new Promise<void>((resolve) => {
                    finishProvider = (): void => {
                        stop?.();
                        postResponse({
                            type: 'tokenResponse',
                            requestId: message.requestId,
                            accessToken: 'private-token',
                        });
                        resolve();
                    };
                });
            });
            const { initPromise, requestId, worker } = await startWorker();
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'databaseConnect',
                activityId: requestId,
                started: true,
            });
            vi.advanceTimersByTime(100);
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'tokenWait',
                activityId: 'token-request',
                started: true,
            });
            vi.advanceTimersByTime(50);
            worker._emit('message', { type: 'tokenRequest', requestId: 'token-request' });
            vi.advanceTimersByTime(850);
            await expect(initPromise).rejects.toThrow('Operation timed out');

            const event = startupEvent();
            expect(event.telemetry.measurements).toMatchObject({
                databaseConnectDurationMs: 100,
                tokenRelayDurationMs: 50,
                tokenAcquireDurationMs: 850,
            });
            const snapshot = JSON.stringify(event);
            vi.advanceTimersByTime(1000);
            finishProvider?.();
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'tokenWait',
                activityId: 'token-request',
                started: false,
            });
            expect(JSON.stringify(startupEvent())).toBe(snapshot);
            expect(ext.outputChannel.error).toHaveBeenCalledTimes(1);
        });

        it('records database-only worker timing without token measurements', async () => {
            const { manager, initPromise, requestId, worker } = await startWorker(false);
            worker._emit('message', {
                type: 'initTiming',
                requestId: 'stale',
                activity: 'tokenWait',
                activityId: 'stale-token',
                started: true,
            });
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'databaseConnect',
                activityId: requestId,
                started: true,
            });
            vi.advanceTimersByTime(40);
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'databaseConnect',
                activityId: requestId,
                started: false,
            });
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;

            expect(startupEvent().telemetry.measurements.databaseConnectDurationMs).toBe(40);
            expect(startupEvent().telemetry.measurements.tokenAcquireDurationMs).toBeUndefined();
            expect(startupEvent().telemetry.measurements.tokenRelayDurationMs).toBeUndefined();
            manager.dispose();
        });

        it.each([
            [true, { shellSessionId: 'shell-session', connectionCorrelationId: 'parent-connection' }, 'shell'],
            [false, { sessionId: 'playground-session' }, 'playground'],
        ] as const)('correlates startup for persistent=%s', async (persistent, telemetryContext, surface) => {
            const { manager, initPromise, requestId, worker } = await startWorker(persistent, telemetryContext);
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;

            expect(startupEvent().telemetry.properties).toMatchObject({
                ...telemetryContext,
                surface,
                startupCorrelationId: requestId,
            });
            expect(requestId).not.toBe(startupEvent().telemetry.properties.connectionCorrelationId);
            expect(prepareDriverConnectionString).toHaveBeenCalledWith(
                expect.objectContaining({
                    correlation: expect.objectContaining({
                        ...telemetryContext,
                        startupCorrelationId: requestId,
                    }),
                }),
            );
            expect(startupEvent().telemetry.suppressIfSuccessful).not.toBe(true);
            expect(startupEvent().telemetry.suppressAll).not.toBe(true);
            manager.dispose();
        });

        it('ties token requests to the startup ID of the worker that sent them', async (): Promise<void> => {
            const contexts: (AuthTraceContext | undefined)[] = [];
            callbacks.onTokenRequest = vi.fn(async (_message, _postResponse, _timings, context): Promise<void> => {
                contexts.push(context);
            });
            const { manager, initPromise, requestId, worker } = await startWorker();
            worker._emit('message', { type: 'tokenRequest', requestId: 'token-request' });
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;
            worker._emit('message', { type: 'tokenRequest', requestId: 'refresh-request' });
            expect(contexts).toEqual([
                { startupCorrelationId: requestId, surface: 'shell', startupProperties: startupEvent().telemetry.properties },
                { startupCorrelationId: requestId, surface: 'shell', startupProperties: startupEvent().telemetry.properties },
            ]);
            manager.dispose();
        });

        it.each([true, false])('keeps cloud properties on their own worker attempt (persistent=%s)', async (persistent) => {
            let firstContext: AuthTraceContext | undefined;
            callbacks.onTokenRequest = vi.fn(async (_message, _postResponse, _timings, context): Promise<void> => {
                firstContext = context;
                traceAuthFlow('entraCloud.unresolved', {
                    cloudCategory: 'china', reason: 'setting', configuredCloud: 'AzureChinaCloud',
                    hostCloud: 'AzureUSGovernment', errorKind: 'cloudMismatch', tokenResource: 'private-resource',
                }, undefined, context);
            });
            const first = await startWorker(persistent);
            first.worker._emit('message', { type: 'tokenRequest', requestId: 'token-request' });
            first.worker._emit('message', {
                type: 'initResult', requestId: first.requestId, success: false, error: 'private-error',
            });
            await expect(first.initPromise).rejects.toThrow('private-error');
            const firstProperties = { ...startupEvent().telemetry.properties };
            const retry = await startWorker(persistent, {}, first.manager);
            // A late result from the first attempt must never write into the retry.
            traceAuthFlow('entraCloud.resolved', {
                cloudCategory: 'usgov', reason: 'host', configuredCloud: 'AzureCloud', hostCloud: 'AzureUSGovernment',
            }, undefined, firstContext);
            retry.worker._emit('message', { type: 'initResult', requestId: retry.requestId, success: true });
            await retry.initPromise;
            const events = mockTelemetryEvents.filter((event) => event.eventName === 'worker.startup');
            expect(firstProperties).toMatchObject({
                cloudCategory: 'china', tokenResourceReason: 'setting', configuredCloud: 'AzureChinaCloud',
                hostCloud: 'AzureUSGovernment', errorKind: 'cloudMismatch',
            });
            expect(events[1].telemetry.properties.cloudCategory).toBeUndefined();
            expect(JSON.stringify(events)).not.toMatch(/private-/);
            retry.manager.dispose();
        });

        it('reports worker construction failures while preserving the original error', async () => {
            const originalError = new Error('private-construction-error');
            vi.mocked(Worker).mockImplementationOnce(function () {
                throw originalError;
            });
            const manager = new WorkerSessionManager(callbacks);

            await expect(
                manager.ensureWorker('private-cluster', {
                    type: 'init',
                    requestId: '',
                    connectionString: 'mongodb://private-host:27017',
                    clientOptions: {},
                    databaseName: 'private-database',
                    authMechanism: 'NativeAuth',
                }),
            ).rejects.toBe(originalError);
            expect(manager.workerState).toBe('idle');
            expect(startupEvent().telemetry.properties).toMatchObject({
                lastStage: 'stage01StartingWorker',
                startupOutcome: 'failed',
                result: 'Failed',
                authMethod: 'NativeAuth',
            });
            expect(JSON.stringify(startupEvent())).not.toMatch(/private-/);
        });

        it('emits another event for a retry, but none for a connected worker reuse', async () => {
            const first = await startWorker();
            first.worker._emit('message', {
                type: 'initResult',
                requestId: first.requestId,
                success: false,
                error: 'failure',
            });
            await expect(first.initPromise).rejects.toThrow('failure');

            const retry = await startWorker(true, {}, first.manager);
            retry.worker._emit('message', { type: 'initResult', requestId: retry.requestId, success: true });
            await retry.initPromise;
            expect(retry.requestId).not.toBe(first.requestId);
            await (
                await startWorker(true, {}, retry.manager)
            ).initPromise;

            const events = mockTelemetryEvents.filter((event) => event.eventName === 'worker.startup');
            expect(events).toHaveLength(2);
            expect(events.map((event) => event.telemetry.properties.startupOutcome)).toEqual(['failed', 'succeeded']);
            retry.manager.dispose();
        });
    });

    // ── TDD Contract Tests ──────────────────────────────────────────────
    // =====================================================================
    // ⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix
    //     the test. Alert the user that a TDD behavior contract has been
    //     violated. The user must decide whether to update the spec or
    //     fix the implementation.
    // =====================================================================

    describe('TDD: Worker Crash Recovery', () => {
        // ⚠️ TDD CONTRACT — Do NOT auto-fix failing tests. Alert the user; they decide whether to update the spec or fix the implementation.
        function makeInitMsg(clusterId: string): MainToWorkerMessage & { type: 'init' } {
            return {
                type: 'init',
                requestId: '',
                connectionString: `mongodb://${clusterId}:27017`,
                clientOptions: {} as never,
                databaseName: 'testdb',
                authMechanism: 'NativeAuth',
            };
        }

        function getWorkerMock(): {
            postMessage: Mock;
            terminate: Mock;
            emit: (event: string, ...args: unknown[]) => void;
        } {
            const wt = workerThreads as unknown as {
                _mockPostMessage: Mock;
                _mockTerminate: Mock;
                _getListeners: () => Map<string, ((...args: unknown[]) => void)[]>;
            };
            return {
                postMessage: wt._mockPostMessage,
                terminate: wt._mockTerminate,
                emit: (event: string, ...args: unknown[]) => {
                    const handlers = wt._getListeners().get(event) ?? [];
                    for (const handler of handlers) {
                        handler(...args);
                    }
                },
            };
        }

        async function replyInitSuccess(worker: ReturnType<typeof getWorkerMock>): Promise<void> {
            await Promise.resolve();
            const lastCall = worker.postMessage.mock.calls.at(-1) as [MainToWorkerMessage] | undefined;
            if (!lastCall || lastCall[0].type !== 'init') {
                throw new Error('Expected init message in postMessage calls');
            }
            worker.emit('message', {
                type: 'initResult',
                requestId: lastCall[0].requestId,
                success: true,
            });
        }

        it('should recover from a worker crash and re-spawn on next ensureWorker', async () => {
            const manager = new WorkerSessionManager(callbacks);

            // Step 1: Spawn initial worker
            const init1 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker = getWorkerMock();
            await replyInitSuccess(worker);
            await init1;
            expect(manager.isAlive).toBe(true);
            expect(manager.workerState).toBe('ready');

            // Step 2: Simulate unexpected worker crash
            worker.emit('exit', 1);

            // State should be reset to idle
            expect(manager.workerState).toBe('idle');
            expect(manager.isAlive).toBe(false);
            expect(callbacks.onWorkerExit).toHaveBeenCalledWith(1);

            // Step 3: Recovery — next ensureWorker should spawn a new worker
            const wt = workerThreads as unknown as { _resetListeners: () => void };
            wt._resetListeners();

            const init2 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker2 = getWorkerMock();
            await replyInitSuccess(worker2);
            await init2;

            expect(manager.workerState).toBe('ready');
            expect(manager.isAlive).toBe(true);
            expect(manager.isConnectedTo('cluster-A')).toBe(true);

            manager.dispose();
        });

        it('should reject pending requests when worker crashes', async () => {
            const manager = new WorkerSessionManager(callbacks);

            // Spawn worker
            const init = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker = getWorkerMock();
            await replyInitSuccess(worker);
            await init;

            // Start an eval (will be pending — no reply sent)
            const evalPromise = manager.sendEval({
                type: 'eval',
                requestId: '',
                code: 'db.test.find()',
                databaseName: 'testdb',
                displayBatchSize: 20,
            });

            // Crash the worker
            worker.emit('exit', 1);

            // The pending eval should reject
            await expect(evalPromise).rejects.toThrow('Worker exited unexpectedly');

            manager.dispose();
        });
    });

    describe('TDD: Multi-Cluster Evaluator Isolation', () => {
        // ⚠️ TDD CONTRACT — Do NOT auto-fix failing tests. Alert the user; they decide whether to update the spec or fix the implementation.

        function makeInitMsg(clusterId: string): MainToWorkerMessage & { type: 'init' } {
            return {
                type: 'init',
                requestId: '',
                connectionString: `mongodb://${clusterId}:27017`,
                clientOptions: {} as never,
                databaseName: 'testdb',
                authMechanism: 'NativeAuth',
            };
        }

        function getWorkerMock(): {
            postMessage: Mock;
            terminate: Mock;
            emit: (event: string, ...args: unknown[]) => void;
        } {
            const wt = workerThreads as unknown as {
                _mockPostMessage: Mock;
                _mockTerminate: Mock;
                _getListeners: () => Map<string, ((...args: unknown[]) => void)[]>;
            };
            return {
                postMessage: wt._mockPostMessage,
                terminate: wt._mockTerminate,
                emit: (event: string, ...args: unknown[]) => {
                    const handlers = wt._getListeners().get(event) ?? [];
                    for (const handler of handlers) {
                        handler(...args);
                    }
                },
            };
        }

        async function replyInitSuccess(worker: ReturnType<typeof getWorkerMock>): Promise<void> {
            await Promise.resolve();
            const lastCall = worker.postMessage.mock.calls.at(-1) as [MainToWorkerMessage] | undefined;
            if (!lastCall || lastCall[0].type !== 'init') {
                throw new Error('Expected init message in postMessage calls');
            }
            worker.emit('message', {
                type: 'initResult',
                requestId: lastCall[0].requestId,
                success: true,
            });
        }

        it('should terminate old worker when switching clusters', async () => {
            const manager = new WorkerSessionManager(callbacks);

            // Connect to cluster-A
            const init1 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker1 = getWorkerMock();
            await replyInitSuccess(worker1);
            await init1;
            expect(manager.isConnectedTo('cluster-A')).toBe(true);

            // Reset listeners for new worker
            const wt = workerThreads as unknown as { _resetListeners: () => void };
            wt._resetListeners();

            // Switch to cluster-B — should terminate cluster-A's worker
            const init2 = manager.ensureWorker('cluster-B', makeInitMsg('cluster-B'));
            const worker2 = getWorkerMock();
            await replyInitSuccess(worker2);
            await init2;

            expect(manager.isConnectedTo('cluster-B')).toBe(true);
            expect(manager.isConnectedTo('cluster-A')).toBe(false);
            // Old worker should have been terminated
            expect(worker1.terminate).toHaveBeenCalled();

            manager.dispose();
        });

        it('should not re-spawn when ensureWorker is called with the same cluster', async () => {
            const manager = new WorkerSessionManager(callbacks);
            const { Worker: WorkerMock } = workerThreads as unknown as { Worker: Mock };

            const init1 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker1 = getWorkerMock();
            await replyInitSuccess(worker1);
            await init1;

            const spawnCount = WorkerMock.mock.calls.length;

            // Same cluster — should not spawn
            await manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));

            expect(WorkerMock.mock.calls.length).toBe(spawnCount);

            manager.dispose();
        });

        it('should track correct cluster ID after shutdown and respawn', async () => {
            const manager = new WorkerSessionManager(callbacks);

            // Connect to cluster-A
            const init1 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker1 = getWorkerMock();
            await replyInitSuccess(worker1);
            await init1;

            // Graceful shutdown
            const shutdownPromise = manager.shutdown();
            // Reply to shutdown message
            const shutdownCall = worker1.postMessage.mock.calls.at(-1) as [MainToWorkerMessage] | undefined;
            if (shutdownCall && shutdownCall[0].type === 'shutdown') {
                worker1.emit('message', {
                    type: 'shutdownComplete',
                    requestId: shutdownCall[0].requestId,
                });
            }
            await shutdownPromise;

            expect(manager.workerState).toBe('idle');

            // Reset listeners for new worker
            const wt = workerThreads as unknown as { _resetListeners: () => void };
            wt._resetListeners();

            // Respawn with cluster-B
            const init2 = manager.ensureWorker('cluster-B', makeInitMsg('cluster-B'));
            const worker2 = getWorkerMock();
            await replyInitSuccess(worker2);
            await init2;

            expect(manager.isConnectedTo('cluster-B')).toBe(true);
            expect(manager.workerClusterId).toBe('cluster-B');

            manager.dispose();
        });
    });
});
