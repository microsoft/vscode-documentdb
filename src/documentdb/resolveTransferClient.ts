/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient, type ConnectionBinding } from './ClustersClient';
import { ConnectionUnavailableError } from './ConnectionUnavailableError';

export async function resolveTransferClient(
    clusterId: string,
    binding?: ConnectionBinding,
): Promise<ClustersClient> {
    if (!binding) {
        return ClustersClient.getClient(clusterId);
    }
    if (binding.clusterId !== clusterId) {
        throw new ConnectionUnavailableError('credentialsChanged');
    }
    try {
        return await ClustersClient.resolveBoundClient(binding);
    } catch (error) {
        if (error instanceof ConnectionUnavailableError && error.reason === 'identityChanged') {
            throw new ConnectionUnavailableError('credentialsChanged', { cause: error });
        }
        throw error;
    }
}
