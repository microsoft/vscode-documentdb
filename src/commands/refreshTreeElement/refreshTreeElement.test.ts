/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { expect, it, vi } from 'vitest';
import { ext } from '../../extensionVariables';
import { refreshTreeElement } from './refreshTreeElement';

vi.mock('../../extensionVariables', () => ({
    ext: { discoveryBranchDataProvider: { refresh: vi.fn() } },
}));

it('marks a node for an explicit reload before refreshing that node', async () => {
    const node = {
        id: 'discoveryView/azure',
        contextValue: 'discoveryView',
        getTreeItem: vi.fn(),
        prepareExplicitReload: vi.fn(),
    };

    await refreshTreeElement({} as IActionContext, node);

    expect(node.prepareExplicitReload).toHaveBeenCalledTimes(1);
    expect(node.prepareExplicitReload).toHaveBeenCalledBefore(vi.mocked(ext.discoveryBranchDataProvider.refresh));
    expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
});
