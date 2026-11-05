/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as tls from 'node:tls';

import { type NetIo } from '../types.js';

function connected<T extends net.Socket>(
    socket: T,
    event: 'connect' | 'secureConnect',
    signal: AbortSignal,
): Promise<T> {
    return new Promise<T>((resolve, reject): void => {
        const onAbort = (): void => {
            socket.destroy();
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Operation aborted', { cause: signal.reason }),
            );
        };
        const onError = (error: Error): void => {
            socket.destroy();
            reject(error);
        };
        socket.once(event, (): void => {
            resolve(socket);
        });
        socket.on('error', onError);
        socket.once('close', (): void => {
            signal.removeEventListener('abort', onAbort);
            socket.removeListener('error', onError);
            reject(Object.assign(new Error('Socket closed before connection completed'), { code: 'ECONNRESET' }));
        });
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
        }
    });
}

export const nodeNet: NetIo = {
    connect: (options): Promise<net.Socket> => {
        options.signal.throwIfAborted();
        return connected(
            net.connect({ host: options.host, port: options.port, family: options.family }),
            'connect',
            options.signal,
        );
    },
    connectTls: (options): Promise<tls.TLSSocket> => {
        options.signal.throwIfAborted();
        const { signal, ...connectionOptions } = options;
        return connected(tls.connect(connectionOptions), 'secureConnect', signal);
    },
};

export const readFile = (path: string): Promise<Uint8Array> => fs.readFile(path);
