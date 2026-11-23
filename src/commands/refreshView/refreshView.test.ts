/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { expect, it, vi } from 'vitest';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { getVisibleDiscoveryProviders } from '../../services/discoveryProviderVisibility';
import { DiscoveryService } from '../../services/discoveryServices';
import { refreshView } from './refreshView';

vi.mock('../../extensionVariables', () => ({
    ext: { discoveryBranchDataProvider: { refresh: vi.fn() } },
}));
vi.mock('../../services/discoveryProviderVisibility', () => ({
    getVisibleDiscoveryProviders: vi.fn(),
}));

it('marks visible Discovery providers before refreshing the view', async () => {
    const prepareExplicitReload = vi.fn();
    const azureProvider = {
        id: 'azure',
        label: 'Azure',
        description: '',
        iconPath: undefined,
        getDiscoveryWizard: vi.fn(),
        getDiscoveryTreeRootItem: vi.fn(),
        prepareExplicitReload,
    };
    const otherProvider = { ...azureProvider, id: 'other', prepareExplicitReload: undefined };
    const hiddenProvider = { ...azureProvider, id: 'hidden', prepareExplicitReload: vi.fn() };
    for (const provider of [azureProvider, otherProvider, hiddenProvider]) {
        DiscoveryService.registerProvider(provider);
    }
    vi.mocked(getVisibleDiscoveryProviders).mockResolvedValue([azureProvider, otherProvider]);

    await refreshView({} as IActionContext, Views.DiscoveryView);

    expect(prepareExplicitReload).toHaveBeenCalledTimes(1);
    expect(prepareExplicitReload).toHaveBeenCalledBefore(vi.mocked(ext.discoveryBranchDataProvider.refresh));
    expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(hiddenProvider.prepareExplicitReload).not.toHaveBeenCalled();
});
