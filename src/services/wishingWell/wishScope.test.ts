/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasCredentials, exists, getClient, revealInConnectionsView } = vi.hoisted(() => ({
    hasCredentials: vi.fn(),
    exists: vi.fn(),
    getClient: vi.fn(),
    revealInConnectionsView: vi.fn(),
}));

vi.mock('../../documentdb/ClustersClient', () => ({ ClustersClient: { exists, getClient } }));
vi.mock('../../documentdb/CredentialCache', () => ({ CredentialCache: { hasCredentials } }));
vi.mock('../../tree/connections-view/connectionsViewHelpers', () => ({ revealInConnectionsView }));
vi.mock('../connectionStorageService', () => ({
    ConnectionStorageService: {
        getAll: vi.fn(async (zone: string) => (zone === 'clusters' ? [{ id: 'c1', name: 'prod' }] : [])),
    },
    StorageZone: { Clusters: 'clusters', Emulators: 'emulators' },
}));
vi.mock('../../documentdb/Views', () => ({ Views: { ConnectionsView: 'connectionsView' } }));

import { findConnection, NeedsSignInError, resolveScope } from './wishScope';

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

describe('resolveScope', () => {
    const context = {} as IActionContext;

    beforeEach(() => {
        vi.resetAllMocks();
        exists.mockReturnValue(true);
    });

    it('asks a non-interactive caller to have the user sign in, without touching the tree', async () => {
        hasCredentials.mockReturnValue(false);
        const resolving = resolveScope({ connection: 'prod', database: 'shop' }, context, { interactive: false });
        await expect(resolving).rejects.toBeInstanceOf(NeedsSignInError);
        await expect(resolving).rejects.toThrow(
            'Connection "prod" (id: c1) is not connected. Ask the user to sign in to it from the DocumentDB side bar in VS Code, then retry.',
        );
        expect(revealInConnectionsView).not.toHaveBeenCalled();
        expect(getClient).not.toHaveBeenCalled();
    });

    it('will not start a client for a non-interactive caller, since that may open an Entra ID sign-in', async () => {
        hasCredentials.mockReturnValue(true);
        exists.mockReturnValue(false);
        await expect(resolveScope({ connection: 'prod' }, context, { interactive: false })).rejects.toBeInstanceOf(
            NeedsSignInError,
        );
        expect(getClient).not.toHaveBeenCalled();
    });

    it('signs in through the tree for an interactive caller', async () => {
        let signedIn = false;
        hasCredentials.mockImplementation(() => signedIn);
        revealInConnectionsView.mockImplementation(async () => {
            signedIn = true;
        });
        await expect(resolveScope({ connection: 'prod', database: 'shop' }, context)).resolves.toMatchObject({
            cluster: { clusterId: 'c1', clusterDisplayName: 'prod' },
            databaseName: 'shop',
        });
        expect(revealInConnectionsView).toHaveBeenCalledWith(context, 'c1', false, 'shop');
    });

    it('connects a signed-in connection without prompting', async () => {
        hasCredentials.mockReturnValue(true);
        await expect(resolveScope({ connection: 'c1' }, context, { interactive: false })).resolves.toMatchObject({
            cluster: { clusterId: 'c1' },
        });
        expect(getClient).toHaveBeenCalledWith('c1');
        expect(revealInConnectionsView).not.toHaveBeenCalled();
    });
});
