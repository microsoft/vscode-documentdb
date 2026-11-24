/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { revealInConnectionsView } from '../../tree/connections-view/connectionsViewHelpers';
import { ConnectionStorageService, StorageZone } from '../connectionStorageService';

/** The cluster a wish is made on, by the same ids the rest of the extension uses. */
export interface WishCluster {
    /** Stable cache key for credentials and clients. */
    readonly clusterId: string;
    readonly clusterDisplayName: string;
    readonly viewId: string;
}

export interface WishScope {
    readonly cluster?: WishCluster;
    readonly databaseName?: string;
    readonly collectionName?: string;
}

export interface ConnectionSummary {
    readonly id: string;
    readonly name: string;
    readonly kind: 'connection' | 'local';
    /** Connected in this VS Code session, so wishes need no sign-in. */
    readonly connected: boolean;
}

interface SavedConnection extends ConnectionSummary {
    readonly isEmulator: boolean;
}

async function savedConnections(): Promise<SavedConnection[]> {
    const zones: [StorageZone, boolean][] = [
        [StorageZone.Clusters, false],
        [StorageZone.Emulators, true],
    ];
    const lists = await Promise.all(
        zones.map(async ([zone, isEmulator]) =>
            (await ConnectionStorageService.getAll(zone)).map(
                (item): SavedConnection => ({
                    id: item.id,
                    name: item.name,
                    kind: isEmulator ? 'local' : 'connection',
                    isEmulator,
                    connected: ClustersClient.exists(item.id) && CredentialCache.hasCredentials(item.id),
                }),
            ),
        ),
    );
    return lists.flat();
}

/** Saved connections, without secrets. In the Connections view a connection's id is its clusterId. */
export async function listConnections(): Promise<ConnectionSummary[]> {
    return (await savedConnections()).map(({ id, name, kind, connected }) => ({ id, name, kind, connected }));
}

/** Exact id, then exact name (any case), then a single partial name match. */
export function findConnection<T extends { readonly id: string; readonly name: string }>(
    connections: readonly T[],
    nameOrId: string,
): T | undefined {
    const wanted = nameOrId.trim().toLowerCase();
    const exact =
        connections.find((connection) => connection.id === nameOrId) ??
        connections.find((connection) => connection.name.toLowerCase() === wanted);
    if (exact) {
        return exact;
    }
    const partial = connections.filter((connection) => connection.name.toLowerCase().includes(wanted));
    return partial.length === 1 ? partial[0] : undefined;
}

export interface ScopeRequest {
    readonly connection?: string;
    readonly database?: string;
    readonly collection?: string;
}

/**
 * Turns an agent's connection name into a scope, signing in the same way expanding the tree does
 * when this session has not connected yet. That may ask the user for a password in VS Code.
 */
export async function resolveScope(request: ScopeRequest, context: IActionContext): Promise<WishScope> {
    if (!request.connection) {
        if (request.database || request.collection) {
            throw new Error(
                l10n.t('Name a connection to wish on a database. Call documentdb_list_connections to see them.'),
            );
        }
        return {};
    }
    if (request.collection && !request.database) {
        throw new Error(l10n.t('Name the database of collection "{0}".', request.collection));
    }

    const connections = await savedConnections();
    const connection = findConnection(connections, request.connection);
    if (!connection) {
        const names = connections.map((candidate) => `"${candidate.name}"`).join(', ') || l10n.t('none');
        throw new Error(
            l10n.t('No saved connection matches "{0}". Saved connections: {1}.', request.connection, names),
        );
    }

    if (!CredentialCache.hasCredentials(connection.id)) {
        await revealInConnectionsView(context, connection.id, connection.isEmulator, request.database);
    }
    if (!CredentialCache.hasCredentials(connection.id)) {
        throw new Error(
            l10n.t(
                '"{0}" is not signed in. Sign in from the DocumentDB side bar in VS Code, then wish again.',
                connection.name,
            ),
        );
    }
    await ClustersClient.getClient(connection.id);

    return {
        cluster: { clusterId: connection.id, clusterDisplayName: connection.name, viewId: Views.ConnectionsView },
        databaseName: request.database,
        collectionName: request.collection,
    };
}
