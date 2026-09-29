/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Worker } from 'worker_threads';
import { ext } from '../../extensionVariables';
import { WorkerSessionManager, type WorkerSessionCallbacks } from './WorkerSessionManager';
import { type MainToWorkerMessage } from './workerTypes';

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

        function startWorker(): {
            manager: WorkerSessionManager;
            initPromise: Promise<void>;
            requestId: string;
            worker: { _emit: (event: string, ...args: unknown[]) => void };
        } {
            const manager = new WorkerSessionManager(callbacks);
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
                    persistent: true,
                },
                1000,
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
                `[WorkerSessionManager] startup=${requestId} timedOut stage=acquiringToken elapsedMs=1000 stageElapsedMs=800`,
            );
            expect(trace.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(/private-/);
            expect(jest.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
        });

        it('traces token acquisition completion and successful startup, ignoring stale progress', async () => {
            const { manager, initPromise, requestId, worker } = startWorker();
            worker._emit('message', { type: 'initProgress', requestId, stage: 'acquiringToken' });
            jest.advanceTimersByTime(150);
            worker._emit('message', { type: 'initProgress', requestId, stage: 'authenticating' });
            expect(trace).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} stageCompleted nextStage=authenticating stage=acquiringToken elapsedMs=150 stageElapsedMs=150`,
            );
            worker._emit('message', { type: 'initProgress', requestId: 'stale-request', stage: 'loadingDriver' });
            jest.advanceTimersByTime(50);
            worker._emit('message', { type: 'initResult', requestId, success: true });
            await initPromise;
            expect(trace).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} succeeded stage=authenticating elapsedMs=200 stageElapsedMs=50`,
            );
            expect(ext.outputChannel.error).not.toHaveBeenCalled();

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
                `[WorkerSessionManager] startup=${requestId} failed stage=acquiringToken elapsedMs=0 stageElapsedMs=0`,
            );
            expect(trace.mock.calls.map((call) => String(call[0])).join('\n')).not.toMatch(/private-/);
            expect(jest.mocked(ext.outputChannel.error).mock.calls.flat().join('\n')).not.toMatch(/private-/);
        });

        it('logs an unexpected startup exit at error level', async () => {
            const { initPromise, requestId, worker } = startWorker();
            jest.advanceTimersByTime(100);
            worker._emit('exit', 1);

            await expect(initPromise).rejects.toThrow('Worker exited unexpectedly');
            expect(ext.outputChannel.error).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} exited stage=startingWorker elapsedMs=100 stageElapsedMs=100`,
            );
        });

        it('keeps intentional startup cancellation at trace level', async () => {
            const { manager, initPromise, requestId } = startWorker();
            manager.dispose();

            await expect(initPromise).rejects.toThrow('Worker terminated');
            expect(trace).toHaveBeenCalledWith(
                `[WorkerSessionManager] startup=${requestId} terminated stage=startingWorker elapsedMs=0 stageElapsedMs=0`,
            );
            expect(ext.outputChannel.error).not.toHaveBeenCalled();
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
