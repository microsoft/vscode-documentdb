/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { Views } from '../../documentdb/Views';
import { API, DocumentDBExperience } from '../../DocumentDBExperiences';
import { ConnectionReachabilityService } from '../../services/connectionReachabilityService';
import {
    ConnectionStorageService,
    ItemType,
    StorageZone,
    type ConnectionItem,
} from '../../services/connectionStorageService';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';

const stored: ConnectionItem = {
    id: 'stable-id',
    name: 'Test connection',
    properties: {
        type: ItemType.Connection,
        api: API.DocumentDB,
        availableAuthMethods: [AuthMethodId.NoAuth],
        selectedAuthMethod: AuthMethodId.NoAuth,
    },
    secrets: { connectionString: 'mongodb://localhost:27017/db' },
};

function item(): DocumentDBClusterItem {
    return new DocumentDBClusterItem({
        treeId: 'connectionsView/folder/stable-id',
        clusterId: 'stable-id',
        storageId: 'stable-id',
        name: stored.name,
        dbExperience: DocumentDBExperience,
        viewId: Views.ConnectionsView,
    });
}

describe('DocumentDBClusterItem credential reachability', (): void => {
    beforeEach((): void => {
        vi.spyOn(ConnectionStorageService, 'get').mockResolvedValue(stored);
        vi.spyOn(ConnectionReachabilityService, 'ensureReachable').mockResolvedValue(undefined);
    });
    afterEach((): void => {
        vi.restoreAllMocks();
    });

    it('still ensures reachability by default for existing callers', async (): Promise<void> => {
        const credentials = await item().getCredentials();
        expect(ConnectionStorageService.get).toHaveBeenCalledExactlyOnceWith('stable-id', StorageZone.Clusters);
        expect(ConnectionReachabilityService.ensureReachable).toHaveBeenCalledExactlyOnceWith(
            stored.properties,
            'stable-id',
        );
        expect(credentials).toMatchObject({
            connectionString: stored.secrets.connectionString,
            connectionProperties: stored.properties,
        });
    });

    it('can read stored credentials without preparing the endpoint', async (): Promise<void> => {
        const credentials = await item().getCredentials({ ensureReachable: false });
        expect(credentials).toMatchObject({
            connectionString: stored.secrets.connectionString,
            connectionProperties: stored.properties,
        });
        expect(ConnectionReachabilityService.ensureReachable).not.toHaveBeenCalled();
    });
});
