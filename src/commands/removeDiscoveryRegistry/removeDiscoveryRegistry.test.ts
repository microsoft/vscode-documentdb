/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DiscoveryService, type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { removeDiscoveryRegistry } from './removeDiscoveryRegistry';

jest.mock('vscode', () => ({
    l10n: { t: (message: string) => message },
}));

const mockGlobalStateGet = jest.fn();
const mockGlobalStateUpdate = jest.fn();
const mockRefresh = jest.fn();

jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (key: string, defaultValue?: unknown) => mockGlobalStateGet(key, defaultValue),
                update: (key: string, value: unknown) => mockGlobalStateUpdate(key, value),
            },
        },
        discoveryBranchDataProvider: {
            refresh: () => mockRefresh(),
        },
        outputChannel: {
            error: jest.fn(),
        },
    },
}));

function createProvider(id: string, deactivate?: DiscoveryProvider['deactivate']): DiscoveryProvider {
    return {
        id,
        label: id,
        description: id,
        getDiscoveryWizard: () => ({}),
        getDiscoveryTreeRootItem: () => createNode(`${Views.DiscoveryView}/${id}`),
        deactivate,
    };
}

function createNode(id: string): TreeElement {
    return {
        id,
        getTreeItem: () => ({ label: id }),
    };
}

function createActionContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
    } as unknown as IActionContext;
}

describe('removeDiscoveryRegistry', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalStateGet.mockReturnValue(['provider-with-cleanup', 'other-provider']);
        mockGlobalStateUpdate.mockResolvedValue(undefined);
    });

    it('deactivates provider resources before removing the provider from active state', async () => {
        const deactivate = jest.fn().mockResolvedValue(undefined);
        DiscoveryService.registerProvider(createProvider('provider-with-cleanup', deactivate));
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/provider-with-cleanup/root`));

        expect(deactivate).toHaveBeenCalledWith(context);
        expect(mockGlobalStateUpdate).toHaveBeenCalledWith('activeDiscoveryProviderIds', ['other-provider']);
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties.discoveryProviderId).toBe('provider-with-cleanup');
        expect(context.telemetry.measurements.activeDiscoveryProviders).toBe(1);
    });

    it('removes providers that do not expose deactivation cleanup', async () => {
        DiscoveryService.registerProvider(createProvider('provider-without-cleanup'));
        mockGlobalStateGet.mockReturnValue(['provider-without-cleanup']);
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/provider-without-cleanup/root`));

        expect(mockGlobalStateUpdate).toHaveBeenCalledWith('activeDiscoveryProviderIds', []);
        expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not update active providers when provider lookup fails', async () => {
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/missing-provider/root`));

        expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).toHaveBeenCalledWith(
            'Failed to access the service provider with the id "missing-provider".',
        );
    });
});
