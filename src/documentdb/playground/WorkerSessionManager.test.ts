/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkerSessionManager, type WorkerSessionCallbacks } from './WorkerSessionManager';

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
});
