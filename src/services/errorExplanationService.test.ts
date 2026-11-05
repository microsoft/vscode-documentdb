/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callWithTelemetryAndErrorHandling, UserCancelledError } from '@microsoft/vscode-azext-utils';
import {
    ErrorExplanationService,
    type ErrorExplanationProvider,
    type ErrorExplanationRequest,
} from './errorExplanationService';

const telemetryContext = vi.hoisted(() => ({
    telemetry: { properties: {} as Record<string, string> },
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: typeof telemetryContext) => void): Promise<void> => {
            callback(telemetryContext);
        },
    ),
    UserCancelledError: class UserCancelledError extends Error {},
}));

function provider(id: string, explain: ErrorExplanationProvider['explain']): ErrorExplanationProvider {
    return { id, explain };
}

describe('ErrorExplanationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        telemetryContext.telemetry.properties = {};
        ErrorExplanationService.resetForTests();
    });

    afterEach(() => {
        ErrorExplanationService.resetForTests();
        vi.useRealTimers();
    });

    it('returns undefined when no provider is registered', async () => {
        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toBeUndefined();
    });

    it('returns the first non-undefined explanation and stops asking', async () => {
        const second = vi.fn().mockResolvedValue('second');
        ErrorExplanationService.registerProvider(provider('a', () => Promise.resolve(undefined)));
        ErrorExplanationService.registerProvider(provider('b', () => Promise.resolve('from b')));
        ErrorExplanationService.registerProvider(provider('c', second));

        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'b', message: 'from b' });
        expect(second).not.toHaveBeenCalled();
    });

    it('passes through the identifiers a structured explanation names (R4)', async () => {
        const identifiers = [{ kind: 'service', value: 'payments-db-svc' }] as const;
        ErrorExplanationService.registerProvider(
            provider('k', () => Promise.resolve({ message: 'from k', identifiers })),
        );

        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'k', message: 'from k', identifiers });
    });

    it.each([undefined, 'troubleshooter'] as const)(
        'records the explanation source and passes it unchanged to providers (source=%s)',
        async (source): Promise<void> => {
            const explain = vi.fn().mockResolvedValue('explained');
            ErrorExplanationService.registerProvider(provider('a', explain));
            const request: ErrorExplanationRequest = { clusterId: 'c1', error: new Error('boom'), source };

            await expect(ErrorExplanationService.explain(request)).resolves.toEqual({
                providerId: 'a',
                message: 'explained',
            });

            expect(explain).toHaveBeenCalledExactlyOnceWith(request);
            expect(explain.mock.calls[0][0]).toBe(request);
            expect(callWithTelemetryAndErrorHandling).toHaveBeenCalledExactlyOnceWith(
                'errorExplanation.explained',
                expect.any(Function),
            );
            expect(telemetryContext.telemetry.properties).toEqual({
                explanationProviderId: 'a',
                explanationSource: source ?? 'connect',
            });
        },
    );

    it('skips a throwing provider instead of failing the caller', async () => {
        ErrorExplanationService.registerProvider(provider('a', () => Promise.reject(new Error('provider bug'))));
        ErrorExplanationService.registerProvider(provider('b', () => Promise.resolve('from b')));

        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'b', message: 'from b' });
    });

    it('gives up on a provider that never settles so the original error can still be reported', async () => {
        vi.useFakeTimers();
        ErrorExplanationService.registerProvider(provider('slow', () => new Promise<string>(() => {})));

        const pending = ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') });
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(pending).resolves.toBeUndefined();
    });

    it('spends one deadline in total, not one per provider', async () => {
        vi.useFakeTimers();
        const stall = (): Promise<string> => new Promise<string>(() => {});
        ErrorExplanationService.registerProvider(provider('a', stall));
        ErrorExplanationService.registerProvider(provider('b', stall));
        ErrorExplanationService.registerProvider(provider('c', stall));

        const pending = ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') });
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(pending).resolves.toBeUndefined();
    });

    // The deadline used to be a plain race, which leaves the losing side running: later providers
    // kept being queried, and an answer arriving after the caller had already been handed
    // `undefined` was still reported as an explanation.
    it('stops querying providers once the deadline has passed', async () => {
        vi.useFakeTimers();
        let releaseFirst: (() => void) | undefined;
        const first = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    releaseFirst = () => resolve('too late');
                }),
        );
        const second = vi.fn().mockResolvedValue('second');
        ErrorExplanationService.registerProvider(provider('first', first));
        ErrorExplanationService.registerProvider(provider('second', second));

        const pending = ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') });
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(pending).resolves.toBeUndefined();

        vi.mocked(callWithTelemetryAndErrorHandling).mockClear();
        // The slow provider answers after the caller has given up.
        releaseFirst?.();
        await vi.advanceTimersByTimeAsync(1);

        expect(second).not.toHaveBeenCalled();
        expect(callWithTelemetryAndErrorHandling).not.toHaveBeenCalled();
    });

    it('replaces a provider registered twice under the same id', async () => {
        ErrorExplanationService.registerProvider(provider('a', () => Promise.resolve('first')));
        ErrorExplanationService.registerProvider(provider('a', () => Promise.resolve('second')));

        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new Error('boom') }),
        ).resolves.toEqual({ providerId: 'a', message: 'second' });
    });

    it('never modifies the error it was given', async () => {
        ErrorExplanationService.registerProvider(provider('a', () => Promise.resolve('explained')));

        class CustomError extends Error {
            public readonly code = 'ECONNREFUSED';
        }
        const error = new CustomError('raw driver text');
        const originalMessage = error.message;

        await ErrorExplanationService.explain({ clusterId: 'c1', error });

        expect(error.message).toBe(originalMessage);
        expect(error).toBeInstanceOf(CustomError);
        expect(error.code).toBe('ECONNREFUSED');
        expect(error.cause).toBeUndefined();
    });

    it('stays silent for a cancellation, without consulting any provider', async () => {
        const explain = vi.fn().mockResolvedValue('should not be used');
        ErrorExplanationService.registerProvider(provider('a', explain));

        await expect(
            ErrorExplanationService.explain({ clusterId: 'c1', error: new UserCancelledError() }),
        ).resolves.toBeUndefined();
        expect(explain).not.toHaveBeenCalled();
    });
});
