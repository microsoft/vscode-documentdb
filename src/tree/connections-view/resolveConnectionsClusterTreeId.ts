/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageZone } from '../../services/connectionStorageService';
import { buildFullTreePath } from './connectionsViewHelpers';
import { isQuickStartClusterId, resolveQuickStartClusterTreeId } from './LocalQuickStart/quickStartTreeIdentity';

/**
 * Resolves a stable Connections View cluster ID to its current tree position.
 *
 * Synthetic ownership is classified before feature code runs, so a failure in one feature's
 * resolver cannot affect persisted connections. Unknown IDs follow the persisted connection path.
 */
export async function resolveConnectionsClusterTreeId(clusterId: string): Promise<string | undefined> {
    if (isQuickStartClusterId(clusterId)) {
        return resolveQuickStartClusterTreeId(clusterId);
    }

    return buildFullTreePath(clusterId, StorageZone.Clusters);
}
