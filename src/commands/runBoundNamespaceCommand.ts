/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ClustersClient, type ConnectionBinding } from '../documentdb/ClustersClient';
import { classifyConnectionFailure } from '../documentdb/connectionFailures';
import { ConnectionUnavailableError } from '../documentdb/ConnectionUnavailableError';
import { runWithClient } from '../documentdb/runWithClient';

export async function runBoundNamespaceCommand<T>(
    clusterId: string,
    binding: ConnectionBinding,
    operation: (client: ClustersClient) => Promise<T>,
): Promise<T> {
    if (clusterId !== binding.clusterId) {
        throw new ConnectionUnavailableError('identityChanged');
    }

    try {
        const result = await runWithClient(binding, async (client) => ({ value: await operation(client) }), {
            trigger: 'clusterDashboard',
        });
        if ('unavailable' in result) {
            throw new ConnectionUnavailableError(result.unavailable.reason);
        }
        return result.value;
    } catch (error) {
        const { kind } = classifyConnectionFailure(error);
        if (kind === 'transient' || kind === 'clientClosed') {
            throw new ConnectionUnavailableError('unreachable', { cause: error });
        }
        throw error;
    }
}
