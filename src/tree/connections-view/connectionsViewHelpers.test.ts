/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type TreeItem } from 'vscode';

import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import {
    ConnectionStorageService,
    ConnectionType,
    ItemType,
    type StoredItem,
} from '../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../api/revealConnectionsViewElement';
import {
    buildConnectionsViewTargetPath,
    buildConnectionsViewTreePath,
    buildFullTreePath,
    revealInConnectionsView,
} from './connectionsViewHelpers';

vi.mock('../../services/connectionStorageService', () => ({
    ConnectionStorageService: { get: vi.fn() },
    ConnectionType: { Clusters: 'clusters', Emulators: 'emulators' },
    ItemType: { Connection: 'connection', Folder: 'folder' },
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        connectionsBranchDataProvider: {
            findNodeById: vi.fn(),
            hasNodeErrorState: vi.fn(),
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
    },
}));
vi.mock('../api/revealConnectionsViewElement', () => ({ revealConnectionsViewElement: vi.fn() }));

const connection: StoredItem = {
    id: 'connection-id',
    name: 'Saved connection',
    properties: { type: ItemType.Connection, api: API.DocumentDB, availableAuthMethods: [] },
    secrets: { connectionString: 'mongodb://host' },
};

beforeEach((): void => {
    vi.clearAllMocks();
    vi.mocked(ConnectionStorageService.get).mockResolvedValue(connection);
    vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(undefined);
    vi.mocked(ext.connectionsBranchDataProvider.hasNodeErrorState).mockReturnValue(false);
});

describe('buildFullTreePath emulator invariant', () => {
    it('preserves the flat path for a root-level emulator connection', async (): Promise<void> => {
        expect(await buildFullTreePath(connection.id, ConnectionType.Emulators)).toBe(
            buildConnectionsViewTreePath(connection.id, true),
        );
        expect(await buildFullTreePath(connection.id, ConnectionType.Emulators)).toBe(
            'connectionsView/localEmulators/connection-id',
        );
    });
});

describe('buildConnectionsViewTargetPath', () => {
    it.each([false, true])('preserves root connection paths with isEmulator=%s', async (isEmulator): Promise<void> => {
        expect(await buildConnectionsViewTargetPath(connection.id, isEmulator)).toBe(
            buildConnectionsViewTreePath(connection.id, isEmulator),
        );
        expect(ConnectionStorageService.get).toHaveBeenCalledExactlyOnceWith(
            connection.id,
            isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
        );
    });

    it.each([false, true])(
        'includes ancestor folders, database, and collection with isEmulator=%s',
        async (isEmulator): Promise<void> => {
            const items: StoredItem[] = [
                { ...connection, properties: { ...connection.properties, parentId: 'inner-folder' } },
                {
                    ...connection,
                    id: 'inner-folder',
                    properties: { ...connection.properties, type: ItemType.Folder, parentId: 'outer-folder' },
                },
                { ...connection, id: 'outer-folder', properties: { ...connection.properties, type: ItemType.Folder } },
            ];
            vi.mocked(ConnectionStorageService.get).mockImplementation(
                async (id): Promise<StoredItem | undefined> => items.find((item) => item.id === id),
            );

            expect(await buildConnectionsViewTargetPath(connection.id, isEmulator, 'db', 'items')).toBe(
                `connectionsView/${isEmulator ? 'localEmulators/' : ''}outer-folder/inner-folder/connection-id/db/items`,
            );
            expect(vi.mocked(ConnectionStorageService.get).mock.calls).toEqual(
                ['connection-id', 'inner-folder', 'outer-folder'].map((id) => [
                    id,
                    isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
                ]),
            );
        },
    );

    it('extends a connection path by its database', async (): Promise<void> => {
        expect(await buildConnectionsViewTargetPath(connection.id, false, 'db')).toBe(
            'connectionsView/connection-id/db',
        );
    });

    it('does not append a collection without a database', async (): Promise<void> => {
        expect(await buildConnectionsViewTargetPath(connection.id, false, undefined, 'items')).toBe(
            'connectionsView/connection-id',
        );
    });
});

describe('revealInConnectionsView', () => {
    const context = {} as IActionContext;

    it.each([false, true])(
        'reveals nested connection, database, and collection paths with isEmulator=%s',
        async (isEmulator): Promise<void> => {
            const items: StoredItem[] = [
                { ...connection, properties: { ...connection.properties, parentId: 'folder-id' } },
                { ...connection, id: 'folder-id', properties: { ...connection.properties, type: ItemType.Folder } },
            ];
            vi.mocked(ConnectionStorageService.get).mockImplementation(
                async (id): Promise<StoredItem | undefined> => items.find((item) => item.id === id),
            );
            const path = `connectionsView/${isEmulator ? 'localEmulators/' : ''}folder-id/connection-id`;

            await revealInConnectionsView(context, connection.id, isEmulator, 'db', 'items');

            expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(path, true);
            expect(vi.mocked(revealConnectionsViewElement).mock.calls.map((call) => call[1])).toEqual([
                ...(isEmulator ? ['connectionsView/localEmulators'] : []),
                path,
                `${path}/db`,
                `${path}/db/items`,
            ]);
            expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
            expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
        },
    );

    it('resets and refreshes a failed connection before revealing it again', async (): Promise<void> => {
        const node = { id: 'connectionsView/connection-id', getTreeItem: (): TreeItem => ({ label: connection.name }) };
        vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(node);
        vi.mocked(ext.connectionsBranchDataProvider.hasNodeErrorState).mockReturnValue(true);

        await revealInConnectionsView(context, connection.id, false);

        expect(ext.connectionsBranchDataProvider.hasNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(ext.connectionsBranchDataProvider.resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(ext.connectionsBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
        expect(
            vi.mocked(ext.connectionsBranchDataProvider.resetNodeErrorState).mock.invocationCallOrder[0],
        ).toBeLessThan(vi.mocked(ext.connectionsBranchDataProvider.refresh).mock.invocationCallOrder[0]);
        expect(vi.mocked(ext.connectionsBranchDataProvider.refresh).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(revealConnectionsViewElement).mock.invocationCallOrder[0],
        );
        expect(revealConnectionsViewElement).toHaveBeenCalledExactlyOnceWith(context, node.id, {
            select: true,
            focus: true,
            expand: true,
        });
    });

    it('does not refresh a healthy connection', async (): Promise<void> => {
        const node = { id: 'connectionsView/connection-id', getTreeItem: (): TreeItem => ({ label: connection.name }) };
        vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(node);

        await revealInConnectionsView(context, connection.id, false);

        expect(ext.connectionsBranchDataProvider.hasNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
        expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
        expect(revealConnectionsViewElement).toHaveBeenCalledExactlyOnceWith(context, node.id, {
            select: true,
            focus: true,
            expand: true,
        });
    });
});
