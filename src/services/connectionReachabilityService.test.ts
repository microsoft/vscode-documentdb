/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    ConnectionReachabilityService,
    type ConnectionReachabilityObserver,
    type ConnectionReachabilityProvider,
} from './connectionReachabilityService';

function makeProvider(
    id: string,
    appliesTo: (props: Record<string, unknown> | undefined) => boolean,
    ensure: Mock,
): ConnectionReachabilityProvider {
    return {
        id,
        appliesTo,
        ensureReachable: ensure as unknown as ConnectionReachabilityProvider['ensureReachable'],
    };
}

describe('ConnectionReachabilityService', () => {
    beforeEach(() => {
        ConnectionReachabilityService.resetForTests();
    });

    afterEach((): void => {
        ConnectionReachabilityService.resetForTests();
        vi.useRealTimers();
    });

    it('runs ensureReachable only for providers whose appliesTo returns true', async () => {
        const appliesEnsure = vi.fn().mockResolvedValue(undefined);
        const skipsEnsure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, appliesEnsure));
        ConnectionReachabilityService.registerProvider(makeProvider('skips', () => false, skipsEnsure));

        await ConnectionReachabilityService.ensureReachable({ some: 'props' });

        expect(appliesEnsure).toHaveBeenCalledTimes(1);
        expect(appliesEnsure).toHaveBeenCalledWith({ some: 'props' }, undefined, undefined);
        expect(skipsEnsure).not.toHaveBeenCalled();
    });

    it('forwards the clusterId so a provider can record which cluster it prepared', async () => {
        const ensure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, ensure));

        await ConnectionReachabilityService.ensureReachable({ some: 'props' }, 'cluster-42');

        expect(ensure).toHaveBeenCalledWith({ some: 'props' }, 'cluster-42', undefined);
    });

    it('is a no-op when connection properties are undefined', async () => {
        const ensure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('any', () => true, ensure));

        await ConnectionReachabilityService.ensureReachable(undefined);

        expect(ensure).not.toHaveBeenCalled();
    });

    it('resolves immediately when no provider applies', async () => {
        const ensure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('none', () => false, ensure));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 })).resolves.toBeUndefined();
        expect(ensure).not.toHaveBeenCalled();
    });

    it('propagates a provider failure to the caller', async () => {
        const error = new Error('tunnel failed');
        const boom = vi.fn().mockRejectedValue(error);
        ConnectionReachabilityService.registerProvider(makeProvider('boom', () => true, boom));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 })).rejects.toBe(error);
    });

    it.each([undefined, { a: 1 }])(
        'does not notify the observer when no provider applies (properties=%s)',
        async (properties): Promise<void> => {
            const ensure = vi.fn().mockResolvedValue(undefined);
            const observer = {
                onProviderStarted: vi.fn(),
                onProviderCompleted: vi.fn(),
                onProviderFailed: vi.fn(),
            } satisfies ConnectionReachabilityObserver;
            ConnectionReachabilityService.registerProvider(makeProvider('none', () => false, ensure));

            await expect(
                ConnectionReachabilityService.ensureReachable(properties, 'cluster-42', observer),
            ).resolves.toBeUndefined();

            expect(ensure).not.toHaveBeenCalled();
            expect(observer.onProviderStarted).not.toHaveBeenCalled();
            expect(observer.onProviderCompleted).not.toHaveBeenCalled();
            expect(observer.onProviderFailed).not.toHaveBeenCalled();
        },
    );

    it('observes each applicable provider in order with its elapsed time', async (): Promise<void> => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const notifications = vi.fn();
        const observer: ConnectionReachabilityObserver = {
            onProviderStarted: (providerId: string): void => {
                notifications('started', providerId);
            },
            onProviderCompleted: (providerId: string, elapsedMs: number): void => {
                notifications('completed', providerId, elapsedMs);
            },
            onProviderFailed: vi.fn(),
        };
        const first = vi.fn(async (): Promise<void> => {
            expect(notifications).toHaveBeenLastCalledWith('started', 'first');
            vi.advanceTimersByTime(25);
        });
        const second = vi.fn(async (): Promise<void> => {
            expect(notifications).toHaveBeenLastCalledWith('started', 'second');
            vi.advanceTimersByTime(40);
        });
        const skipped = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('first', () => true, first));
        ConnectionReachabilityService.registerProvider(makeProvider('skipped', () => false, skipped));
        ConnectionReachabilityService.registerProvider(makeProvider('second', () => true, second));

        await expect(
            ConnectionReachabilityService.ensureReachable({ a: 1 }, 'cluster-42', observer),
        ).resolves.toBeUndefined();

        expect(notifications.mock.calls).toEqual([
            ['started', 'first'],
            ['completed', 'first', 25],
            ['started', 'second'],
            ['completed', 'second', 40],
        ]);
        expect(first).toHaveBeenCalledWith({ a: 1 }, 'cluster-42', undefined);
        expect(second).toHaveBeenCalledWith({ a: 1 }, 'cluster-42', undefined);
        expect(skipped).not.toHaveBeenCalled();
        expect(observer.onProviderFailed).not.toHaveBeenCalled();
    });

    it('observes a failure with elapsed time and rejects with the original error', async (): Promise<void> => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const error: Error = Object.freeze(new Error('tunnel failed'));
        const observer = {
            onProviderStarted: vi.fn(),
            onProviderCompleted: vi.fn(),
            onProviderFailed: vi.fn(),
        } satisfies ConnectionReachabilityObserver;
        const ensure = vi.fn(async (): Promise<void> => {
            expect(observer.onProviderStarted).toHaveBeenCalledExactlyOnceWith('failed');
            vi.advanceTimersByTime(35);
            throw error;
        });
        const later = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('failed', () => true, ensure));
        ConnectionReachabilityService.registerProvider(makeProvider('later', () => true, later));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 }, 'cluster-42', observer)).rejects.toBe(
            error,
        );

        expect(observer.onProviderFailed).toHaveBeenCalledExactlyOnceWith('failed', 35, error);
        expect(observer.onProviderFailed.mock.calls[0][2]).toBe(error);
        expect(observer.onProviderCompleted).not.toHaveBeenCalled();
        expect(later).not.toHaveBeenCalled();
    });

    it.each(['onProviderStarted', 'onProviderCompleted'] as const)(
        'ignores a throwing %s observer on success',
        async (callback): Promise<void> => {
            const observer = {
                onProviderStarted: vi.fn(),
                onProviderCompleted: vi.fn(),
                onProviderFailed: vi.fn(),
            } satisfies ConnectionReachabilityObserver;
            observer[callback].mockImplementation((): void => {
                throw new Error('observer failed');
            });
            const ensure = vi.fn().mockResolvedValue(undefined);
            ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, ensure));

            await expect(
                ConnectionReachabilityService.ensureReachable({ a: 1 }, undefined, observer),
            ).resolves.toBeUndefined();

            expect(ensure).toHaveBeenCalledOnce();
            expect(observer.onProviderStarted).toHaveBeenCalledOnce();
            expect(observer.onProviderCompleted).toHaveBeenCalledOnce();
            expect(observer.onProviderFailed).not.toHaveBeenCalled();
        },
    );

    it.each(['onProviderStarted', 'onProviderFailed'] as const)(
        'ignores a throwing %s observer on failure',
        async (callback): Promise<void> => {
            const error = new Error('tunnel failed');
            const observer = {
                onProviderStarted: vi.fn(),
                onProviderCompleted: vi.fn(),
                onProviderFailed: vi.fn(),
            } satisfies ConnectionReachabilityObserver;
            observer[callback].mockImplementation((): void => {
                throw new Error('observer failed');
            });
            const ensure = vi.fn().mockRejectedValue(error);
            ConnectionReachabilityService.registerProvider(makeProvider('failed', () => true, ensure));

            await expect(ConnectionReachabilityService.ensureReachable({ a: 1 }, undefined, observer)).rejects.toBe(
                error,
            );

            expect(ensure).toHaveBeenCalledOnce();
            expect(observer.onProviderStarted).toHaveBeenCalledOnce();
            expect(observer.onProviderFailed).toHaveBeenCalledOnce();
            expect(observer.onProviderCompleted).not.toHaveBeenCalled();
        },
    );

    it('allows an observer with no callbacks', async (): Promise<void> => {
        const ensure = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, ensure));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 }, undefined, {})).resolves.toBeUndefined();
        expect(ensure).toHaveBeenCalledExactlyOnceWith({ a: 1 }, undefined, undefined);
    });

    it('forwards a non-interactive intent and reports what the provider observed', async (): Promise<void> => {
        const ensure = vi.fn().mockResolvedValue({ sharedTunnel: 'reused' });
        const observer = { onProviderCompleted: vi.fn() };
        const intent = { interactive: false, signal: new AbortController().signal };
        ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, ensure));

        await ConnectionReachabilityService.ensureReachable({ a: 1 }, 'cluster-42', observer, intent);

        expect(ensure).toHaveBeenCalledExactlyOnceWith({ a: 1 }, 'cluster-42', intent);
        expect(observer.onProviderCompleted).toHaveBeenCalledExactlyOnceWith('applies', expect.any(Number), {
            sharedTunnel: 'reused',
        });
    });

    it('replaces a provider registered with the same id (idempotent re-activation)', async () => {
        const first = vi.fn().mockResolvedValue(undefined);
        const second = vi.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('same-id', () => true, first));
        ConnectionReachabilityService.registerProvider(makeProvider('same-id', () => true, second));

        await ConnectionReachabilityService.ensureReachable({ a: 1 });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
