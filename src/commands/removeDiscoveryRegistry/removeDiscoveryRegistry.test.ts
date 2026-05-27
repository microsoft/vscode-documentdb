/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { resetDiscoveryProviderVisibilityMigrationForTests } from '../../services/discoveryProviderVisibility';
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
            warn: jest.fn(),
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
        resetDiscoveryProviderVisibilityMigrationForTests();
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) =>
            key === 'hiddenDiscoveryProviderIds' ? [] : defaultValue,
        );
        mockGlobalStateUpdate.mockResolvedValue(undefined);
    });

    it('deactivates provider resources before hiding the provider', async () => {
        const deactivate = jest.fn().mockResolvedValue(undefined);
        DiscoveryService.registerProvider(createProvider('provider-with-cleanup', deactivate));
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/provider-with-cleanup/root`));

        expect(deactivate).toHaveBeenCalledWith(context);
        expect(mockGlobalStateUpdate).toHaveBeenCalledWith('hiddenDiscoveryProviderIds', ['provider-with-cleanup']);
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties.discoveryProviderId).toBe('provider-with-cleanup');
        expect(context.telemetry.measurements.hiddenDiscoveryProviders).toBe(1);
    });

    it('hides providers that do not expose deactivation cleanup', async () => {
        DiscoveryService.registerProvider(createProvider('provider-without-cleanup'));
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/provider-without-cleanup/root`));

        expect(mockGlobalStateUpdate).toHaveBeenCalledWith('hiddenDiscoveryProviderIds', ['provider-without-cleanup']);
        expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not update hidden providers when provider lookup fails', async () => {
        const context = createActionContext();

        await removeDiscoveryRegistry(context, createNode(`${Views.DiscoveryView}/missing-provider/root`));

        expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).toHaveBeenCalledWith(
            'Failed to access the service provider with the id "missing-provider".',
        );
    });
});
