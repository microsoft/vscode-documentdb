/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ConnectionDiagnosticsService, type ConnectionDiagnosticsProvider } from './connectionDiagnosticsService';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(),
    UserCancelledError: class UserCancelledError extends Error {},
}));

function provider(id: string, explain: ConnectionDiagnosticsProvider['explain']): ConnectionDiagnosticsProvider {
    return { id, explain };
}

describe('ConnectionDiagnosticsService', () => {
    beforeEach(() => {
        ConnectionDiagnosticsService.resetForTests();
    });

    afterEach(() => {
        ConnectionDiagnosticsService.resetForTests();
        jest.useRealTimers();
    });

    it('returns undefined when no provider is registered', async () => {
        await expect(
            ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toBeUndefined();
    });

    it('returns the first non-undefined explanation and stops asking', async () => {
        const second = jest.fn().mockResolvedValue('second');
        ConnectionDiagnosticsService.registerProvider(provider('a', () => Promise.resolve(undefined)));
        ConnectionDiagnosticsService.registerProvider(provider('b', () => Promise.resolve('from b')));
        ConnectionDiagnosticsService.registerProvider(provider('c', second));

        await expect(
            ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'b', message: 'from b' });
        expect(second).not.toHaveBeenCalled();
    });

    it('skips a throwing provider instead of failing the caller', async () => {
        ConnectionDiagnosticsService.registerProvider(provider('a', () => Promise.reject(new Error('provider bug'))));
        ConnectionDiagnosticsService.registerProvider(provider('b', () => Promise.resolve('from b')));

        await expect(
            ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'b', message: 'from b' });
    });

    it('gives up on a provider that never settles so the original error can still be reported', async () => {
        jest.useFakeTimers();
        ConnectionDiagnosticsService.registerProvider(provider('slow', () => new Promise<string>(() => {})));

        const pending = ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') });
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(pending).resolves.toBeUndefined();
    });

    it('spends one deadline in total, not one per provider', async () => {
        jest.useFakeTimers();
        const stall = (): Promise<string> => new Promise<string>(() => {});
        ConnectionDiagnosticsService.registerProvider(provider('a', stall));
        ConnectionDiagnosticsService.registerProvider(provider('b', stall));
        ConnectionDiagnosticsService.registerProvider(provider('c', stall));

        const pending = ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') });
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(pending).resolves.toBeUndefined();
    });

    // The deadline used to be a plain race, which leaves the losing side running: later providers
    // kept being queried, and an answer arriving after the caller had already been handed
    // `undefined` was still reported as an explanation.
    it('stops querying providers once the deadline has passed', async () => {
        jest.useFakeTimers();
        let releaseFirst: (() => void) | undefined;
        const first = jest.fn(
            () =>
                new Promise<string>((resolve) => {
                    releaseFirst = () => resolve('too late');
                }),
        );
        const second = jest.fn().mockResolvedValue('second');
        ConnectionDiagnosticsService.registerProvider(provider('first', first));
        ConnectionDiagnosticsService.registerProvider(provider('second', second));

        const pending = ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') });
        await jest.advanceTimersByTimeAsync(5_000);
        await expect(pending).resolves.toBeUndefined();

        jest.mocked(callWithTelemetryAndErrorHandling).mockClear();
        // The slow provider answers after the caller has given up.
        releaseFirst?.();
        await jest.advanceTimersByTimeAsync(1);

        expect(second).not.toHaveBeenCalled();
        expect(callWithTelemetryAndErrorHandling).not.toHaveBeenCalled();
    });

    it('replaces a provider registered twice under the same id', async () => {
        ConnectionDiagnosticsService.registerProvider(provider('a', () => Promise.resolve('first')));
        ConnectionDiagnosticsService.registerProvider(provider('a', () => Promise.resolve('second')));

        await expect(
            ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'a', message: 'second' });
    });

    it('never modifies the error it was given', async () => {
        ConnectionDiagnosticsService.registerProvider(provider('a', () => Promise.resolve('explained')));

        class CustomError extends Error {
            public readonly code = 'ECONNREFUSED';
        }
        const error = new CustomError('raw driver text');
        const originalMessage = error.message;

        await ConnectionDiagnosticsService.explain({ clusterId: 'c1', error });

        expect(error.message).toBe(originalMessage);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.code).toBe('ECONNREFUSED');
        expect(error.cause).toBeUndefined();
    });

    it('stays silent for a cancellation, without consulting any provider', async () => {
        const explain = jest.fn().mockResolvedValue('should not be used');
        ConnectionDiagnosticsService.registerProvider(provider('a', explain));

        await expect(
            ConnectionDiagnosticsService.explain({ clusterId: 'c1', error: new UserCancelledError() }),
        ).resolves.toBeUndefined();
        expect(explain).not.toHaveBeenCalled();
    });
});
