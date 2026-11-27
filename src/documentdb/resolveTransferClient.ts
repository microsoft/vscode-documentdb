/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient, type ConnectionBinding } from './ClustersClient';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';
import { runWithClient } from './runWithClient';

export async function resolveTransferClient(clusterId: string, binding?: ConnectionBinding): Promise<ClustersClient> {
    if (!binding) {
        return ClustersClient.getClient(clusterId);
    }
    if (binding.clusterId !== clusterId) {
        throw new ConnectionUnavailableError('credentialsChanged');
    }
    const result = await runWithClient(binding, async (client) => ({ client }));
    if ('unavailable' in result) {
        const { reason } = result.unavailable;
        throw new ConnectionUnavailableError(reason === 'identityChanged' ? 'credentialsChanged' : reason);
    }
    return result.client;
}
