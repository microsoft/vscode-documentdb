/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { Worker } from 'worker_threads';
import { ext } from '../../extensionVariables';
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

jest.mock('@microsoft/vscode-azext-utils', () => {
    const actual: typeof import('@microsoft/vscode-azext-utils') = jest.requireActual('@microsoft/vscode-azext-utils');
    return {
        ...actual,
        callWithTelemetryAndErrorHandling: jest.fn(
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

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            trace: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
    },
}));

// Mock worker_threads — the WorkerSessionManager creates Worker instances
jest.mock('worker_threads', () => {
    const mockPostMessage = jest.fn();
    const mockTerminate = jest.fn().mockResolvedValue(0);
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    const MockWorker = jest.fn().mockImplementation(() => ({
        postMessage: mockPostMessage,
        terminate: mockTerminate,
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
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
    }));

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
        jest.clearAllMocks();
        mockTelemetryEvents.length = 0;
        // Reset listeners between tests
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const wt = require('worker_threads') as { _resetListeners: () => void };
        wt._resetListeners();

        callbacks = {
            onConsoleOutput: jest.fn(),
            onLog: jest.fn(),
            onTokenRequest: jest.fn(),
            onWorkerExit: jest.fn(),
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
            jest.useFakeTimers();
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

            jest.advanceTimersByTime(1000);

            await expect(initPromise).rejects.toMatchObject({
                message:
                    'Operation timed out after 1 seconds. Last startup stage: Starting worker (1.0 seconds in this stage).',
                settingKey: 'documentDB.connectionTimeout',
                settingsHint: 'The connection did not finish in time. You can increase the timeout in Settings:',
            });
            jest.useRealTimers();
        });
    });

    describe('startup tracking', () => {
        let trace: jest.SpyInstance;

        beforeEach(() => {
            jest.useFakeTimers();
            trace = jest.spyOn(ext.outputChannel, 'trace');
        });

        afterEach(() => {
            trace.mockRestore();
            jest.useRealTimers();
        });

        function startupEvent(): RecordedTelemetry {
            const events = mockTelemetryEvents.filter((event) => event.eventName === 'worker.startup');
            expect(events).toHaveLength(1);
            return events[0];
        }

        function startWorker(
            persistent: boolean = true,
            telemetryContext: WorkerStartupTelemetryContext = {},
            manager: WorkerSessionManager = new WorkerSessionManager(callbacks),
        ): {
            manager: WorkerSessionManager;
            initPromise: Promise<void>;
            requestId: string;
            worker: { _emit: (event: string, ...args: unknown[]) => void };
        } {
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
            const worker = jest.mocked(Worker).mock.results.at(-1)?.value as {
                postMessage: jest.Mock;
                _emit: (event: string, ...args: unknown[]) => void;
            };
            const initMessage = worker.postMessage.mock.calls.at(-1)?.[0] as MainToWorkerMessage;
            return { manager, initPromise, requestId: initMessage.requestId, worker };
        }

        it('reports a stalled token request with total and stage timings without connection details', async () => {
            const { initPromise, requestId, worker } = startWorker();
            jest.advanceTimersByTime(200);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            jest.advanceTimersByTime(800);

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
            expect(jest.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
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
            const { manager, initPromise, requestId, worker } = startWorker();
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            jest.advanceTimersByTime(150);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'authenticating' });
            expect(trace).not.toHaveBeenCalled();
            worker._emit('message', { type: 'initProgress', requestId: 'stale-request', stage: 'loadingDriver' });
            jest.advanceTimersByTime(50);
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
            manager.dispose();
        });

        it('logs the failed stage at error level without changing or logging the authentication error', async () => {
            const { initPromise, requestId, worker } = startWorker();
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            worker._emit('message', { type: 'initResult', requestId, success: false, error: 'private-error' });

            await expect(initPromise).rejects.toThrow('private-error');
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} failed surface=shell auth=MicrosoftEntraID lastStage=stage04AcquiringToken elapsedMs=0 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":0,"stage04AcquiringToken":0} costTimingsMs={}`,
            );
            expect(trace.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(/private-/);
            expect(jest.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
            const event = startupEvent();
            expect(event.telemetry.properties).toMatchObject({ startupOutcome: 'failed', result: 'Failed' });
            expect(event.error).toMatchObject({ message: 'Worker startup failed', stack: undefined });
            expect(JSON.stringify(event)).not.toMatch(/private-/);
        });

        it('logs an unexpected startup exit at error level', async () => {
            const { initPromise, requestId, worker } = startWorker();
            jest.advanceTimersByTime(100);
            worker._emit('exit', 1);

            await expect(initPromise).rejects.toThrow('Worker exited unexpectedly');
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} exited surface=shell auth=MicrosoftEntraID lastStage=stage01StartingWorker elapsedMs=100 timeoutMs=1000 stageDurationsMs={"stage01StartingWorker":100} costTimingsMs={}`,
            );
            expect(startupEvent().telemetry.properties).toMatchObject({ startupOutcome: 'exited', result: 'Failed' });
        });

        it('keeps intentional startup cancellation at trace level', async () => {
            const { manager, initPromise, requestId } = startWorker();
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
            const { initPromise, requestId, worker } = startWorker();
            jest.advanceTimersByTime(100);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            jest.advanceTimersByTime(200);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'authenticating' });
            jest.advanceTimersByTime(100);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            jest.advanceTimersByTime(600);

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
            const { manager, initPromise, requestId, worker } = startWorker();
            for (const stage of [
                'loadingDriver',
                'connecting',
                'acquiringToken',
                'authenticating',
                'initializingRuntime',
            ]) {
                jest.advanceTimersByTime(10);
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
            const { manager, initPromise, requestId, worker } = startWorker();
            const timing = (activity: 'databaseConnect' | 'tokenWait', activityId: string, started: boolean): void => {
                worker._emit('message', { type: 'initTiming', requestId, activity, activityId, started });
            };
            callbacks.onTokenRequest = jest.fn(async (message, postResponse, timings): Promise<void> => {
                const stop = timings?.startTokenAcquire();
                jest.advanceTimersByTime(20);
                stop?.();
                postResponse({ type: 'tokenResponse', requestId: message.requestId, accessToken: 'private-token' });
            });
            timing('databaseConnect', requestId, true);
            jest.advanceTimersByTime(10);
            timing('tokenWait', 'token-request', true);
            timing('tokenWait', 'token-request', true);
            jest.advanceTimersByTime(5);
            worker._emit('message', { type: 'tokenRequest', requestId: 'token-request', scopes: ['private-scope'] });
            jest.advanceTimersByTime(5);
            timing('tokenWait', 'token-request', false);
            jest.advanceTimersByTime(10);
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
            callbacks.onTokenRequest = jest.fn((message, postResponse, timings): Promise<void> => {
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
            const { initPromise, requestId, worker } = startWorker();
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'databaseConnect',
                activityId: requestId,
                started: true,
            });
            jest.advanceTimersByTime(100);
            worker._emit('message', {
                type: 'initTiming',
                requestId,
                activity: 'tokenWait',
                activityId: 'token-request',
                started: true,
            });
            jest.advanceTimersByTime(50);
            worker._emit('message', { type: 'tokenRequest', requestId: 'token-request', scopes: ['private-scope'] });
            jest.advanceTimersByTime(850);
            await expect(initPromise).rejects.toThrow('Operation timed out');

            const event = startupEvent();
            expect(event.telemetry.measurements).toMatchObject({
                databaseConnectDurationMs: 100,
                tokenRelayDurationMs: 50,
                tokenAcquireDurationMs: 850,
            });
            const snapshot = JSON.stringify(event);
            jest.advanceTimersByTime(1000);
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
            const { manager, initPromise, requestId, worker } = startWorker(false);
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
            jest.advanceTimersByTime(40);
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
            const { manager, initPromise, requestId, worker } = startWorker(persistent, telemetryContext);
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;

            expect(startupEvent().telemetry.properties).toMatchObject({ ...telemetryContext, surface });
            expect(startupEvent().telemetry.suppressIfSuccessful).not.toBe(true);
            expect(startupEvent().telemetry.suppressAll).not.toBe(true);
            manager.dispose();
        });

        it('reports worker construction failures while preserving the original error', async () => {
            const originalError = new Error('private-construction-error');
            jest.mocked(Worker).mockImplementationOnce(() => {
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
            const first = startWorker();
            first.worker._emit('message', {
                type: 'initResult',
                requestId: first.requestId,
                success: false,
                error: 'failure',
            });
            await expect(first.initPromise).rejects.toThrow('failure');

            const retry = startWorker(true, {}, first.manager);
            retry.worker._emit('message', { type: 'initResult', requestId: retry.requestId, success: true });
            await retry.initPromise;
            expect(retry.requestId).not.toBe(first.requestId);
            await startWorker(true, {}, retry.manager).initPromise;

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
            postMessage: jest.Mock;
            terminate: jest.Mock;
            emit: (event: string, ...args: unknown[]) => void;
        } {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const wt = require('worker_threads') as {
                _mockPostMessage: jest.Mock;
                _mockTerminate: jest.Mock;
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

        function replyInitSuccess(worker: ReturnType<typeof getWorkerMock>): void {
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
            replyInitSuccess(worker);
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
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const wt = require('worker_threads') as { _resetListeners: () => void };
            wt._resetListeners();

            const init2 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker2 = getWorkerMock();
            replyInitSuccess(worker2);
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
            replyInitSuccess(worker);
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
            postMessage: jest.Mock;
            terminate: jest.Mock;
            emit: (event: string, ...args: unknown[]) => void;
        } {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const wt = require('worker_threads') as {
                _mockPostMessage: jest.Mock;
                _mockTerminate: jest.Mock;
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

        function replyInitSuccess(worker: ReturnType<typeof getWorkerMock>): void {
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
            replyInitSuccess(worker1);
            await init1;
            expect(manager.isConnectedTo('cluster-A')).toBe(true);

            // Reset listeners for new worker
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const wt = require('worker_threads') as { _resetListeners: () => void };
            wt._resetListeners();

            // Switch to cluster-B — should terminate cluster-A's worker
            const init2 = manager.ensureWorker('cluster-B', makeInitMsg('cluster-B'));
            const worker2 = getWorkerMock();
            replyInitSuccess(worker2);
            await init2;

            expect(manager.isConnectedTo('cluster-B')).toBe(true);
            expect(manager.isConnectedTo('cluster-A')).toBe(false);
            // Old worker should have been terminated
            expect(worker1.terminate).toHaveBeenCalled();

            manager.dispose();
        });

        it('should not re-spawn when ensureWorker is called with the same cluster', async () => {
            const manager = new WorkerSessionManager(callbacks);
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Worker: WorkerMock } = require('worker_threads') as { Worker: jest.Mock };

            const init1 = manager.ensureWorker('cluster-A', makeInitMsg('cluster-A'));
            const worker1 = getWorkerMock();
            replyInitSuccess(worker1);
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
            replyInitSuccess(worker1);
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
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const wt = require('worker_threads') as { _resetListeners: () => void };
            wt._resetListeners();

            // Respawn with cluster-B
            const init2 = manager.ensureWorker('cluster-B', makeInitMsg('cluster-B'));
            const worker2 = getWorkerMock();
            replyInitSuccess(worker2);
            await init2;

            expect(manager.isConnectedTo('cluster-B')).toBe(true);
            expect(manager.workerClusterId).toBe('cluster-B');

            manager.dispose();
        });
    });
});
