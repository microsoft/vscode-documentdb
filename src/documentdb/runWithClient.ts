/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from './auth/AuthMethodId';
import { ClustersClient, type ConnectionBinding } from './ClustersClient';
import { classifyConnectionFailure, type ConnectionFailure } from './connectionFailures';
import { ConnectionUnavailableError, type ConnectionUnavailableReason } from './ConnectionUnavailableError';
import { CredentialCache } from './CredentialCache';
import { type ClientStartupTrigger } from './utils/startupFailureTelemetry';

interface RunOptions {
    readonly background?: boolean;
    readonly trigger?: ClientStartupTrigger;
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

export async function runWithClient<T>(
    binding: ConnectionBinding,
    op: (client: ClustersClient) => Promise<T>,
    options?: RunOptions,
): Promise<T | Unavailable> {
    const credentials = CredentialCache.getCredentials(binding.clusterId);
    const authMethod = credentials ? (credentials.authMechanism ?? AuthMethodId.NativeAuth) : undefined;
    let client: ClustersClient;
    try {
        client = await ClustersClient.resolveBoundClient(binding, options);
    } catch (error) {
        // No operation ran, so there is no client generation to report against.
        const unavailable =
            error instanceof ConnectionUnavailableError
                ? { unavailable: { reason: error.reason } }
                : unavailableFor(classifyConnectionFailure(error, authMethod).kind);
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
