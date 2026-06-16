/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionReachabilityService, type ConnectionReachabilityProvider } from './connectionReachabilityService';

function makeProvider(
    id: string,
    appliesTo: (props: Record<string, unknown> | undefined) => boolean,
    ensure: jest.Mock,
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

    it('runs ensureReachable only for providers whose appliesTo returns true', async () => {
        const appliesEnsure = jest.fn().mockResolvedValue(undefined);
        const skipsEnsure = jest.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('applies', () => true, appliesEnsure));
        ConnectionReachabilityService.registerProvider(makeProvider('skips', () => false, skipsEnsure));

        await ConnectionReachabilityService.ensureReachable({ some: 'props' });

        expect(appliesEnsure).toHaveBeenCalledTimes(1);
        expect(appliesEnsure).toHaveBeenCalledWith({ some: 'props' });
        expect(skipsEnsure).not.toHaveBeenCalled();
    });

    it('is a no-op when connection properties are undefined', async () => {
        const ensure = jest.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('any', () => true, ensure));

        await ConnectionReachabilityService.ensureReachable(undefined);

        expect(ensure).not.toHaveBeenCalled();
    });

    it('resolves immediately when no provider applies', async () => {
        const ensure = jest.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('none', () => false, ensure));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 })).resolves.toBeUndefined();
        expect(ensure).not.toHaveBeenCalled();
    });

    it('propagates a provider failure to the caller', async () => {
        const boom = jest.fn().mockRejectedValue(new Error('tunnel failed'));
        ConnectionReachabilityService.registerProvider(makeProvider('boom', () => true, boom));

        await expect(ConnectionReachabilityService.ensureReachable({ a: 1 })).rejects.toThrow('tunnel failed');
    });

    it('replaces a provider registered with the same id (idempotent re-activation)', async () => {
        const first = jest.fn().mockResolvedValue(undefined);
        const second = jest.fn().mockResolvedValue(undefined);
        ConnectionReachabilityService.registerProvider(makeProvider('same-id', () => true, first));
        ConnectionReachabilityService.registerProvider(makeProvider('same-id', () => true, second));

        await ConnectionReachabilityService.ensureReachable({ a: 1 });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
