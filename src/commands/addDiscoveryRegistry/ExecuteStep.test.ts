/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ExecuteStep } from './ExecuteStep';

const mockGlobalStateGet = jest.fn();
const mockGlobalStateUpdate = jest.fn();
const mockRefresh = jest.fn();
const mockGetProvider = jest.fn();

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
    },
}));

function makeContext(discoveryProviderId: string) {
    return {
        discoveryProviderId,
        telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
    };
}

describe('addDiscoveryRegistry ExecuteStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalStateGet.mockReturnValue(['azure-mongo-vcore-discovery']);
        mockGlobalStateUpdate.mockResolvedValue(undefined);
    });

    describe('providers with configureCredentialsOnActivation', () => {
        it('calls configureCredentials first, then persists provider on success, then refreshes', async () => {
            const mockConfigureCredentials = jest.fn().mockResolvedValue(undefined);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await step.execute(context as never);

            // Assert call order: configureCredentials < globalState.update < refresh
            const configureOrder = mockConfigureCredentials.mock.invocationCallOrder[0];
            const updateOrder = mockGlobalStateUpdate.mock.invocationCallOrder[0];
            const refreshOrder = mockRefresh.mock.invocationCallOrder[0];
            expect(configureOrder).toBeLessThan(updateOrder);
            expect(updateOrder).toBeLessThan(refreshOrder);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith('activeDiscoveryProviderIds', [
                'azure-mongo-vcore-discovery',
                'kubernetes-discovery',
            ]);
            expect(mockConfigureCredentials).toHaveBeenCalledWith(context);
            expect(mockRefresh).toHaveBeenCalledTimes(1);
        });

        it('does not persist provider and re-throws on UserCancelledError', async () => {
            const cancellation = new UserCancelledError();
            const mockConfigureCredentials = jest.fn().mockRejectedValue(cancellation);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await expect(step.execute(context as never)).rejects.toThrow(UserCancelledError);

            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockRefresh).not.toHaveBeenCalled();
        });

        it('does not persist provider and propagates unexpected errors', async () => {
            const unexpectedError = new Error('network timeout');
            const mockConfigureCredentials = jest.fn().mockRejectedValue(unexpectedError);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: mockConfigureCredentials,
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await expect(step.execute(context as never)).rejects.toThrow('network timeout');

            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockRefresh).not.toHaveBeenCalled();
        });
    });

    describe('providers without configureCredentialsOnActivation', () => {
        it('persists provider and refreshes the discovery tree', async () => {
            mockGetProvider.mockReturnValue(undefined);

            const step = new ExecuteStep();
            const context = makeContext('azure-cosmos-nosql-discovery');

            await step.execute(context as never);

            expect(mockGlobalStateUpdate).toHaveBeenCalledWith('activeDiscoveryProviderIds', [
                'azure-mongo-vcore-discovery',
                'azure-cosmos-nosql-discovery',
            ]);
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    describe('duplicate prevention', () => {
        it('does not add or refresh when provider is already active', async () => {
            mockGlobalStateGet.mockReturnValue(['azure-mongo-vcore-discovery', 'kubernetes-discovery']);
            mockGetProvider.mockReturnValue({
                configureCredentialsOnActivation: true,
                configureCredentials: jest.fn(),
            });

            const step = new ExecuteStep();
            const context = makeContext('kubernetes-discovery');

            await step.execute(context as never);

            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockRefresh).not.toHaveBeenCalled();
        });

        it('does not duplicate a non-activation provider already in active list', async () => {
            mockGlobalStateGet.mockReturnValue(['azure-mongo-vcore-discovery']);
            mockGetProvider.mockReturnValue(undefined);

            const step = new ExecuteStep();
            const context = makeContext('azure-mongo-vcore-discovery');

            await step.execute(context as never);

            expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
            expect(mockRefresh).not.toHaveBeenCalled();
        });
    });
});
