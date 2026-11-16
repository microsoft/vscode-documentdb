/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveSrvFallback, resolveTxtFallback } from '@documentdb-js/srv-resolver';
import * as dns from 'node:dns';

import { type DnsIo } from '../types.js';

async function resolve<T>(signal: AbortSignal, query: (resolver: dns.promises.Resolver) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const resolver = new dns.promises.Resolver();
    const onAbort = (): void => resolver.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        return await query(resolver);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

export const nodeDns: DnsIo = {
    lookup: async (host): Promise<readonly { address: string; family: 4 | 6 }[]> => {
        const addresses = await dns.promises.lookup(host, { all: true });
        return addresses.map(({ address, family }): { address: string; family: 4 | 6 } => {
            if (family !== 4 && family !== 6) {
                throw new Error('Unexpected address family');
            }
            return { address, family };
        });
    },
    resolve4: (host, signal): Promise<string[]> =>
        resolve(signal, (resolver): Promise<string[]> => resolver.resolve4(host)),
    resolve6: (host, signal): Promise<string[]> =>
        resolve(signal, (resolver): Promise<string[]> => resolver.resolve6(host)),
    resolveCname: (host, signal): Promise<string[]> =>
        resolve(signal, (resolver): Promise<string[]> => resolver.resolveCname(host)),
    resolveSrv: (name, signal): Promise<dns.SrvRecord[]> =>
        resolve(signal, (resolver): Promise<dns.SrvRecord[]> => resolver.resolveSrv(name)),
    resolveTxt: (name, signal): Promise<string[][]> =>
        resolve(signal, (resolver): Promise<string[][]> => resolver.resolveTxt(name)),
    getServers: (): string[] => dns.getServers(),
    resolveSrvFallback,
    resolveTxtFallback,
};
