/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isIP } from 'node:net';
import * as tls from 'node:tls';

import { type NetworkOptions } from '../types.js';

export function tlsConnectionOptions(
    options: NetworkOptions,
    host: string,
    address: string,
    port: number,
    signal: AbortSignal,
    ca: Buffer | undefined,
    clientPem: Buffer | undefined,
): tls.ConnectionOptions & { signal: AbortSignal } {
    return {
        host: address,
        port,
        signal,
        ...(isIP(host) ? {} : { servername: host }),
        ...(ca === undefined ? {} : { ca }),
        ...(clientPem === undefined ? {} : { cert: clientPem, key: clientPem }),
        ...(options.tlsCertificateKeyFilePassword === undefined
            ? {}
            : { passphrase: options.tlsCertificateKeyFilePassword }),
        rejectUnauthorized: !(options.tlsAllowInvalidCertificates || options.tlsInsecure),
        checkServerIdentity: (_hostname, cert): Error | undefined => {
            return options.tlsAllowInvalidHostnames || options.tlsInsecure
                ? undefined
                : tls.checkServerIdentity(host, cert);
        },
    };
}
