/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient, type ConnectionBinding } from './ClustersClient';
import { classifyConnectionFailure, type ConnectionFailure } from './connectionFailures';
import { ConnectionUnavailableError, type ConnectionUnavailableReason } from './ConnectionUnavailableError';

interface ResolveOptions {
    readonly background?: boolean;
}

interface RunOptions extends ResolveOptions {
    resolveClient(binding: ConnectionBinding, options: ResolveOptions): Promise<ClustersClient>;
}

interface Unavailable {
    readonly unavailable: { readonly reason: ConnectionUnavailableReason };
}

function unavailableFor(kind: ConnectionFailure['kind'] | undefined): Unavailable | undefined {
    switch (kind) {
        case 'signInRequired':
        case 'credentialsRejected':
        case 'credentialsMissing':
        case 'identityChanged':
            return { unavailable: { reason: kind } };
        default:
            return undefined;
    }
}

/** @internal The bound resolver and conversion to a surface response are supplied by WI-6. */
export async function runWithClient<T>(
    binding: ConnectionBinding,
    op: (client: ClustersClient) => Promise<T>,
    { resolveClient, background }: RunOptions,
): Promise<T | Unavailable> {
    let client: ClustersClient;
    try {
        client = await resolveClient(binding, { background });
    } catch (error) {
        // No operation ran, so there is no client generation to report against.
        const unavailable =
            error instanceof ConnectionUnavailableError
                ? { unavailable: { reason: error.reason } }
                : unavailableFor(classifyConnectionFailure(error).kind);
        if (unavailable) {
            return unavailable;
        }
        throw error;
    }

    try {
        return await op(client);
    } catch (error) {
        // Resolution can advance the generation without changing the surface's identity.
        const unavailable = unavailableFor(ClustersClient.reportFailure(client.binding, error));
        if (unavailable) {
            return unavailable;
        }
        throw error;
    }
}
