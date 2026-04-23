/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkerSessionManager, type WorkerSessionCallbacks } from './WorkerSessionManager';
import { type MainToWorkerMessage } from './workerTypes';

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

    // ── TDD Contract Tests ──────────────────────────────────────────────

    describe('TDD: Worker Crash Recovery', () => {
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
