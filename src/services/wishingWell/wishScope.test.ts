/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../documentdb/ClustersClient', () => ({ ClustersClient: {} }));
vi.mock('../../documentdb/CredentialCache', () => ({ CredentialCache: {} }));
vi.mock('../../tree/connections-view/connectionsViewHelpers', () => ({ revealInConnectionsView: vi.fn() }));
vi.mock('../connectionStorageService', () => ({ ConnectionStorageService: {}, StorageZone: {} }));
vi.mock('../../documentdb/Views', () => ({ Views: { ConnectionsView: 'connectionsView' } }));

import { findConnection } from './wishScope';

const connections = [
    { id: 'a1', name: 'Production' },
    { id: 'b2', name: 'production-replica' },
    { id: 'c3', name: 'Local Shop' },
];

describe('findConnection', () => {
    it.each([
        ['a1', 'a1'],
        ['production', 'a1'],
        ['PRODUCTION-REPLICA', 'b2'],
        ['shop', 'c3'],
    ])('finds %s', (query, id) => {
        expect(findConnection(connections, query)?.id).toBe(id);
    });

    it('refuses an ambiguous partial name', () => {
        expect(findConnection(connections, 'prod')).toBeUndefined();
    });

    it('refuses an unknown name', () => {
        expect(findConnection(connections, 'staging')).toBeUndefined();
    });
});
