/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockGetChildren = jest.fn();
const mockFindChildById = jest.fn();
const mockResetNodeErrorState = jest.fn();
const mockRefresh = jest.fn();
const mockReveal = jest.fn();
const mockWarn = jest.fn();

jest.mock('../../../extensionVariables', () => ({
    ext: {
        discoveryBranchDataProvider: {
            getChildren: (...args: unknown[]) => mockGetChildren(...args),
            findChildById: (...args: unknown[]) => mockFindChildById(...args),
            resetNodeErrorState: (...args: unknown[]) => mockResetNodeErrorState(...args),
            refresh: (...args: unknown[]) => mockRefresh(...args),
        },
        discoveryTreeView: {
            reveal: (...args: unknown[]) => mockReveal(...args),
        },
        outputChannel: {
            warn: (...args: unknown[]) => mockWarn(...args),
        },
    },
}));

import { KUBERNETES_ROOT_NODE_ID, refreshKubernetesRoot, revealKubernetesSource } from './refreshKubernetesRoot';

describe('refreshKubernetesRoot', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('clears cached errors and refreshes the discovery tree', () => {
        refreshKubernetesRoot();

        expect(mockResetNodeErrorState).toHaveBeenCalledWith(KUBERNETES_ROOT_NODE_ID);
        expect(mockRefresh).toHaveBeenCalled();
    });
});

describe('revealKubernetesSource', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('discovers the Kubernetes root before finding and revealing the source', async () => {
        const rootNode = { id: KUBERNETES_ROOT_NODE_ID };
        const sourceNode = { id: `${KUBERNETES_ROOT_NODE_ID}/inline-1` };
        mockGetChildren.mockResolvedValue([rootNode]);
        mockFindChildById.mockResolvedValue(sourceNode);

        await revealKubernetesSource('inline-1');

        expect(mockGetChildren).toHaveBeenCalledWith(undefined);
        expect(mockFindChildById).toHaveBeenCalledWith(rootNode, `${KUBERNETES_ROOT_NODE_ID}/inline-1`);
        expect(mockReveal).toHaveBeenCalledWith(sourceNode, { select: true, focus: true, expand: true });
    });

    it('sanitizes source IDs before revealing', async () => {
        const rootNode = { id: KUBERNETES_ROOT_NODE_ID };
        mockGetChildren.mockResolvedValue([rootNode]);
        mockFindChildById.mockResolvedValue({ id: `${KUBERNETES_ROOT_NODE_ID}/team_config` });

        await revealKubernetesSource('team/config');

        expect(mockFindChildById).toHaveBeenCalledWith(rootNode, `${KUBERNETES_ROOT_NODE_ID}/team_config`);
    });

    it('does not throw when the source cannot be found', async () => {
        mockGetChildren.mockResolvedValue([{ id: KUBERNETES_ROOT_NODE_ID }]);
        mockFindChildById.mockResolvedValue(undefined);

        await expect(revealKubernetesSource('missing')).resolves.toBeUndefined();

        expect(mockReveal).not.toHaveBeenCalled();
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Could not reveal kubeconfig source'));
    });
});
