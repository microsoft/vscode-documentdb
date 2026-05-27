/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { resetDiscoveryProviderVisibilityMigrationForTests } from '../../services/discoveryProviderVisibility';
import { ExecuteStep } from './ExecuteStep';

const mockGlobalStateGet = jest.fn();
const mockGlobalStateUpdate = jest.fn();
const mockRefresh = jest.fn();
const mockGetProvider = jest.fn();
const mockListProviders = jest.fn();

jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (...args: unknown[]) => mockGlobalStateGet(...args),
                update: (...args: unknown[]) => mockGlobalStateUpdate(...args),
            },
        },
        discoveryBranchDataProvider: {
            refresh: (...args: unknown[]) => mockRefresh(...args),
        },
    },
}));

jest.mock('../../services/discoveryServices', () => ({
    DiscoveryService: {
        getProvider: (...args: unknown[]) => mockGetProvider(...args),
        listProviders: (...args: unknown[]) => mockListProviders(...args),
    },
}));

function makeContext(discoveryProviderId: string) {
    return {
        discoveryProviderId,
        telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
    };
}

function setHiddenProviders(hiddenProviderIds: string[]): void {
    mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) =>
        key === 'hiddenDiscoveryProviderIds' ? hiddenProviderIds : defaultValue,
    );
}

function getHiddenProviderUpdateCalls(): unknown[][] {
    return (mockGlobalStateUpdate.mock.calls as unknown[][]).filter((call) => call[0] === 'hiddenDiscoveryProviderIds');
}

describe('addDiscoveryRegistry ExecuteStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetDiscoveryProviderVisibilityMigrationForTests();
        mockGlobalStateUpdate.mockResolvedValue(undefined);
        mockListProviders.mockReturnValue([
            { id: 'azure-mongo-vcore-discovery', label: 'Azure DocumentDB' },
            { id: 'azure-cosmos-nosql-discovery', label: 'Azure Cosmos DB' },
            { id: 'kubernetes-discovery', label: 'Kubernetes' },
        ]);
        setHiddenProviders(['azure-cosmos-nosql-discovery', 'kubernetes-discovery']);
    });

    describe('providers with configureCredentialsOnActivation', () => {
        it('calls configureCredentials first, then shows provider on success, then refreshes', async () => {
            const mockConfigureCredentials = jest.fn().mockResolvedValue(undefined);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await step.execute(context as never);

            const configureOrder = mockConfigureCredentials.mock.invocationCallOrder[0];
            const showUpdateCallIndex = mockGlobalStateUpdate.mock.calls.findIndex(
                (call) =>
                    call[0] === 'hiddenDiscoveryProviderIds' &&
                    JSON.stringify(call[1]) === JSON.stringify(['azure-cosmos-nosql-discovery']),
            );
            const updateOrder = mockGlobalStateUpdate.mock.invocationCallOrder[showUpdateCallIndex];
            const refreshOrder = mockRefresh.mock.invocationCallOrder[0];
            expect(configureOrder).toBeLessThan(updateOrder);
            expect(updateOrder).toBeLessThan(refreshOrder);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith('hiddenDiscoveryProviderIds', [
                'azure-cosmos-nosql-discovery',
            ]);
            expect(mockConfigureCredentials).toHaveBeenCalledWith(context);
            expect(mockRefresh).toHaveBeenCalledTimes(1);
            expect(context.telemetry.measurements.hiddenDiscoveryProviders).toBe(1);
        });

        it('does not show provider and re-throws on UserCancelledError', async () => {
            const cancellation = new UserCancelledError();
            const mockConfigureCredentials = jest.fn().mockRejectedValue(cancellation);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await expect(step.execute(context as never)).rejects.toThrow(UserCancelledError);

            expect(getHiddenProviderUpdateCalls()).toHaveLength(0);
            expect(mockRefresh).not.toHaveBeenCalled();
        });

        it('does not show provider and propagates unexpected errors', async () => {
            const unexpectedError = new Error('network timeout');
            const mockConfigureCredentials = jest.fn().mockRejectedValue(unexpectedError);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await expect(step.execute(context as never)).rejects.toThrow('network timeout');

            expect(getHiddenProviderUpdateCalls()).toHaveLength(0);
            expect(mockRefresh).not.toHaveBeenCalled();
        });
    });

    describe('providers without configureCredentialsOnActivation', () => {
        it('shows provider and refreshes the discovery tree', async () => {
            mockGetProvider.mockReturnValue(undefined);

            const step = new ExecuteStep();
            const context = makeContext('azure-cosmos-nosql-discovery');

            await step.execute(context as never);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith('hiddenDiscoveryProviderIds', ['kubernetes-discovery']);
            expect(mockRefresh).toHaveBeenCalled();
            expect(context.telemetry.measurements.hiddenDiscoveryProviders).toBe(1);
        });
    });

    describe('duplicate prevention', () => {
        it('does not update or refresh when provider is already visible', async () => {
            setHiddenProviders(['azure-cosmos-nosql-discovery']);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: jest.fn(),
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await step.execute(context as never);

            expect(getHiddenProviderUpdateCalls()).toHaveLength(0);
            expect(mockRefresh).not.toHaveBeenCalled();
        });
    });
});
