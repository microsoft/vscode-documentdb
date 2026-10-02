/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import { StorageZone } from '../../services/connectionStorageService';
import { buildFullTreePath } from './connectionsViewHelpers';
import { isQuickStartClusterId, resolveQuickStartClusterTreeId } from './LocalQuickStart/quickStartTreeIdentity';
import { resolveConnectionsClusterTreeId } from './resolveConnectionsClusterTreeId';

vi.mock('./connectionsViewHelpers', () => ({
    buildFullTreePath: vi.fn(),
}));
vi.mock('./LocalQuickStart/quickStartTreeIdentity', () => ({
    isQuickStartClusterId: vi.fn(),
    resolveQuickStartClusterTreeId: vi.fn(),
}));

const buildStoredTreePath = buildFullTreePath as MockedFunction<typeof buildFullTreePath>;
const ownsQuickStartClusterId = isQuickStartClusterId as MockedFunction<typeof isQuickStartClusterId>;
const resolveQuickStartTreePath = resolveQuickStartClusterTreeId as MockedFunction<
    typeof resolveQuickStartClusterTreeId
>;

describe('resolveConnectionsClusterTreeId', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses the Quick Start-owned synthetic tree path when the managed instance matches', async () => {
        ownsQuickStartClusterId.mockReturnValue(true);
        resolveQuickStartTreePath.mockReturnValue('connectionsView/localQuickStart/instance');

        await expect(resolveConnectionsClusterTreeId('quickstart-vscode-documentdb-local')).resolves.toBe(
            'connectionsView/localQuickStart/instance',
        );
        expect(buildStoredTreePath).not.toHaveBeenCalled();
    });

    it('reconstructs persisted connection paths from the Clusters storage zone', async () => {
        ownsQuickStartClusterId.mockReturnValue(false);
        buildStoredTreePath.mockResolvedValue('connectionsView/folder-1/connection-1');

        await expect(resolveConnectionsClusterTreeId('connection-1')).resolves.toBe(
            'connectionsView/folder-1/connection-1',
        );
        expect(resolveQuickStartTreePath).not.toHaveBeenCalled();
        expect(buildStoredTreePath).toHaveBeenCalledWith('connection-1', StorageZone.Clusters);
    });

    it('does not treat an unavailable Quick Start instance as a stored connection', async () => {
        ownsQuickStartClusterId.mockReturnValue(true);
        resolveQuickStartTreePath.mockReturnValue(undefined);

        await expect(resolveConnectionsClusterTreeId('quickstart-vscode-documentdb-local')).resolves.toBeUndefined();
        expect(buildStoredTreePath).not.toHaveBeenCalled();
    });

    it('keeps persisted lookup independent from Quick Start resolver failures', async () => {
        ownsQuickStartClusterId.mockReturnValue(false);
        resolveQuickStartTreePath.mockImplementation(() => {
            throw new Error('Quick Start resolver failed');
        });
        buildStoredTreePath.mockResolvedValue('connectionsView/connection-1');

        await expect(resolveConnectionsClusterTreeId('connection-1')).resolves.toBe('connectionsView/connection-1');
        expect(resolveQuickStartTreePath).not.toHaveBeenCalled();
    });
});
