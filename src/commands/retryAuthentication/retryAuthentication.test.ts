/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ext } from '../../extensionVariables';
import { retryAuthentication } from './retryAuthentication';

vi.mock('../../extensionVariables', () => ({
    ext: {
        connectionsBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        discoveryBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        azureResourcesRUBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
        azureResourcesVCoreBranchDataProvider: {
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
        },
    },
}));

vi.mock('vscode', () => ({
    l10n: {
        t: vi.fn((value: string) => value),
    },
}));

describe('retryAuthentication', () => {
    const actionContext = {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
    };
    const getTreeItem = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retries discovery nodes based on tree id when the context value lacks the view token', async () => {
        const node = {
            id: 'discoveryView/kubernetes-discovery/kind-documentdb-dev',
            contextValue: 'enableRefreshCommand;discoveryKubernetesContext',
            getTreeItem,
        };

        await retryAuthentication(actionContext as never, node);

        expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledWith(node);
        expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
    });

    it('continues to route Azure Resources retries by branch token', async () => {
        const node = {
            id: 'azureResourcesView/some-provider/resource',
            contextValue: 'azureResourcesView;documentDbBranch',
            getTreeItem,
        };

        await retryAuthentication(actionContext as never, node);

        expect(ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState).toHaveBeenCalledWith(node.id);
        expect(ext.azureResourcesVCoreBranchDataProvider.refresh).toHaveBeenCalledWith(node);
        expect(ext.azureResourcesRUBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
    });

    it('throws for unsupported retry nodes', async () => {
        await expect(
            retryAuthentication(actionContext as never, {
                id: 'unknown/id',
                contextValue: 'enableRefreshCommand;unknown',
                getTreeItem,
            }),
        ).rejects.toThrow('Unsupported view for an authentication retry.');
    });
});
