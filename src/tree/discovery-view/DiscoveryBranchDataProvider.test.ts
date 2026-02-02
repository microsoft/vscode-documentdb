/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { DiscoveryBranchDataProvider } from './DiscoveryBranchDataProvider';

const telemetryContextMock = {
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { issueProperties: {} },
    ui: {
        showWarningMessage: jest.fn(),
        onDidFinishPrompt: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        showOpenDialog: jest.fn(),
        showWorkspaceFolderPick: jest.fn(),
    },
    valuesToMask: [],
};

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName, callback: (context: IActionContext) => Promise<unknown>) => {
            return await callback(telemetryContextMock);
        },
    ),
    createContextValue: jest.fn((values: string[]) => values.join(';')),
}));

// Mock vscode module
jest.mock('vscode', () => ({
    Disposable: class Disposable {
        dispose() {
            // Mock dispose
        }
    },
    EventEmitter: class EventEmitter {
        fire() {
            // Mock fire
        }
        get event() {
            return jest.fn();
        }
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    l10n: {
        t: jest.fn((str) => str),
    },
}));

// Mock extensionVariables module
jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn(),
                update: jest.fn(() => Promise.resolve()),
            },
        },
        state: {
            wrapItemInStateHandling: jest.fn((item) => item),
        },
        outputChannel: {
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

// Mock DiscoveryService
jest.mock('../../services/discoveryServices', () => ({
    DiscoveryService: {
        listProviders: jest.fn(),
        getProvider: jest.fn(),
    },
}));

describe('DiscoveryBranchDataProvider - addDiscoveryProviderPromotionIfNeeded', () => {
    let dataProvider: DiscoveryBranchDataProvider;
    let globalStateGetMock: jest.Mock;
    let globalStateUpdateMock: jest.Mock;
    let listProvidersMock: jest.Mock;
    let getProviderMock: jest.Mock;

    // Create a mock provider
    const mockProvider = {
        id: 'azure-mongo-ru-discovery',
        label: 'Azure Cosmos DB for MongoDB RU',
        description: 'Azure discovery provider',
        getDiscoveryWizard: jest.fn(),
        getDiscoveryTreeRootItem: jest.fn().mockReturnValue({
            id: 'root-item-id',
            getTreeItem: jest.fn().mockResolvedValue({}),
        }),
    };

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();

        // Store references to mocks
        // eslint-disable-next-line @typescript-eslint/unbound-method
        globalStateGetMock = ext.context.globalState.get as jest.Mock;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        globalStateUpdateMock = ext.context.globalState.update as jest.Mock;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        listProvidersMock = DiscoveryService.listProviders as jest.Mock;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        getProviderMock = DiscoveryService.getProvider as jest.Mock;

        // Setup default mock behavior
        globalStateUpdateMock.mockResolvedValue(undefined);

        // Create a new instance for each test
        dataProvider = new DiscoveryBranchDataProvider();
    });

    describe('when user never worked with discovery (empty activeDiscoveryProviderIds)', () => {
        beforeEach(() => {
            // Setup: no active providers (user never added any OR removed all)
            listProvidersMock.mockReturnValue([mockProvider]); // Provider exists in registry
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return []; // Empty list = new user or removed all
                }
                return defaultValue;
            });
        });

        it('should not add the provider to activeDiscoveryProviderIds', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should NOT update activeDiscoveryProviderIds
            const updateCalls = globalStateUpdateMock.mock.calls;
            const activeProviderUpdates = updateCalls.filter((call) => call[0] === 'activeDiscoveryProviderIds');
            expect(activeProviderUpdates).toHaveLength(0);
        });

        it('should mark the promotion flag as processed', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should mark the promotion as processed
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );
        });

        it('should return early without checking provider availability', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not call getProvider since we return early
            expect(getProviderMock).not.toHaveBeenCalled();
        });
    });

    describe('when user has explored discovery in the past', () => {
        beforeEach(() => {
            // Setup: user has some providers active
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    // User has other providers active, indicating they've used discovery before
                    return ['other-provider-id'];
                }
                return defaultValue;
            });
        });

        it('should add the provider to activeDiscoveryProviderIds', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should add the provider to the active list
            expect(globalStateUpdateMock).toHaveBeenCalledWith('activeDiscoveryProviderIds', [
                'other-provider-id',
                'azure-mongo-ru-discovery',
            ]);
        });

        it('should mark the promotion flag as processed', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should mark the promotion as processed
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );
        });

        it('should preserve existing providers when adding the new one', async () => {
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['provider-1', 'provider-2'];
                }
                return defaultValue;
            });

            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            expect(globalStateUpdateMock).toHaveBeenCalledWith('activeDiscoveryProviderIds', [
                'provider-1',
                'provider-2',
                'azure-mongo-ru-discovery',
            ]);
        });
    });

    describe('when promotion was already shown', () => {
        beforeEach(() => {
            // Setup: promotion flag already set
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return true; // Already shown
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['other-provider-id'];
                }
                return defaultValue;
            });
        });

        it('should return early without any updates', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not update anything
            expect(globalStateUpdateMock).not.toHaveBeenCalled();
        });

        it('should not check for registered providers', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not call listProviders since we return early
            expect(listProvidersMock).not.toHaveBeenCalled();
        });
    });

    describe('when provider is not registered in DiscoveryService', () => {
        beforeEach(() => {
            // Setup: providers exist but not the requested one
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(undefined); // Provider not found
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['other-provider-id'];
                }
                return defaultValue;
            });
        });

        it('should not add the provider to activeDiscoveryProviderIds', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not update activeDiscoveryProviderIds
            const updateCalls = globalStateUpdateMock.mock.calls;
            const activeProviderUpdates = updateCalls.filter((call) => call[0] === 'activeDiscoveryProviderIds');
            expect(activeProviderUpdates).toHaveLength(0);
        });

        it('should not mark promotion as processed', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not mark promotion as processed since provider doesn't exist
            expect(globalStateUpdateMock).not.toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );
        });
    });

    describe('when provider is already in activeDiscoveryProviderIds', () => {
        beforeEach(() => {
            // Setup: provider already active
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['azure-mongo-ru-discovery', 'other-provider-id']; // Already includes the provider
                }
                return defaultValue;
            });
        });

        it('should not add duplicate provider to activeDiscoveryProviderIds', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should not update activeDiscoveryProviderIds since provider already exists
            const updateCalls = globalStateUpdateMock.mock.calls;
            const activeProviderUpdates = updateCalls.filter((call) => call[0] === 'activeDiscoveryProviderIds');
            expect(activeProviderUpdates).toHaveLength(0);
        });

        it('should still mark promotion as processed', async () => {
            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should mark the promotion as processed
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['other-provider-id'];
                }
                return defaultValue;
            });
        });

        it('should handle errors when updating activeDiscoveryProviderIds gracefully', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            globalStateUpdateMock.mockImplementation((key: string) => {
                if (key === 'activeDiscoveryProviderIds') {
                    return Promise.reject(new Error('Storage error'));
                }
                return Promise.resolve();
            });

            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should log error
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to update activeDiscoveryProviderIds: Storage error');

            // Should still attempt to mark promotion as processed
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );

            consoleErrorSpy.mockRestore();
        });

        it('should handle errors when marking promotion as processed gracefully', async () => {
            globalStateUpdateMock.mockImplementation((key: string) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return Promise.reject(new Error('Storage error'));
                }
                return Promise.resolve();
            });

            // Should not throw
            await expect(
                dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery'),
            ).resolves.not.toThrow();
        });

        it('should handle errors when checking if no providers exist gracefully', async () => {
            listProvidersMock.mockReturnValue([]);
            globalStateUpdateMock.mockImplementation((key: string) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return Promise.reject(new Error('Storage error'));
                }
                return Promise.resolve();
            });

            // Should not throw
            await expect(
                dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery'),
            ).resolves.not.toThrow();
        });
    });

    describe('edge cases', () => {
        it('should handle when activeDiscoveryProviderIds is null/undefined', async () => {
            listProvidersMock.mockReturnValue([mockProvider]);
            getProviderMock.mockReturnValue(mockProvider);
            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return null; // Explicitly return null
                }
                return defaultValue;
            });

            await dataProvider.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

            // Should mark promotion as processed and not add provider
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:azure-mongo-ru-discovery',
                true,
            );

            const updateCalls = globalStateUpdateMock.mock.calls;
            const activeProviderUpdates = updateCalls.filter((call) => call[0] === 'activeDiscoveryProviderIds');
            expect(activeProviderUpdates).toHaveLength(0);
        });

        it('should handle different provider IDs correctly', async () => {
            listProvidersMock.mockReturnValue([mockProvider]);
            const differentProvider = {
                ...mockProvider,
                id: 'different-provider-id',
            };
            getProviderMock.mockReturnValue(differentProvider);

            globalStateGetMock.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'discoveryProviderPromotionProcessed:different-provider-id') {
                    return false;
                }
                if (key === 'activeDiscoveryProviderIds') {
                    return ['other-provider-id'];
                }
                return defaultValue;
            });

            await dataProvider.addDiscoveryProviderPromotionIfNeeded('different-provider-id');

            // Should add the different provider
            expect(globalStateUpdateMock).toHaveBeenCalledWith('activeDiscoveryProviderIds', [
                'other-provider-id',
                'different-provider-id',
            ]);

            // Should use the correct promotion flag
            expect(globalStateUpdateMock).toHaveBeenCalledWith(
                'discoveryProviderPromotionProcessed:different-provider-id',
                true,
            );
        });
    });
});

describe('DiscoveryBranchDataProvider - Cluster ID Validation', () => {
    let dataProvider: DiscoveryBranchDataProvider;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();

        // Create a new instance for each test
        dataProvider = new DiscoveryBranchDataProvider();
    });

    describe('when getting children from a provider', () => {
        it('should accept cluster IDs with correct provider prefix', async () => {
            // Plugins must provide prefixed cluster IDs
            const prefixedClusterId =
                'azure-mongo-vcore-discovery__subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1';
            const mockClusterElement = {
                id: 'cluster-element-id',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: prefixedClusterId,
                    name: 'Test Cluster',
                },
            };

            // Mock the parent element that returns the cluster as child
            const mockParentElement = {
                id: 'discoveryView/azure-mongo-vcore-discovery/subscription1',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
                getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
            };

            // Call getChildren - should not throw
            const children = await dataProvider.getChildren(mockParentElement);

            // Verify clusterId remains unchanged (no augmentation)
            expect(children).toBeDefined();
            expect(children![0]).toBeDefined();
            // @ts-expect-error - accessing cluster property on tree element
            expect(children![0].cluster.clusterId).toBe(prefixedClusterId);
        });

        it('should throw error when cluster ID is missing provider prefix', async () => {
            // Non-prefixed cluster ID (violates the contract)
            const nonPrefixedClusterId =
                '_subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1';
            const mockClusterElement = {
                id: 'cluster-element-id',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: nonPrefixedClusterId,
                    name: 'Test Cluster',
                },
            };

            const mockParentElement = {
                id: 'discoveryView/azure-mongo-vcore-discovery/subscription1',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
                getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
            };

            // Should throw because plugin didn't prefix the clusterId
            await expect(dataProvider.getChildren(mockParentElement)).rejects.toThrow(/must start with provider ID/i);
        });

        it('should not modify non-cluster elements', async () => {
            const mockNonClusterElement = {
                id: 'subscription-element-id',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
                // No cluster property
            };

            const mockParentElement = {
                id: 'discoveryView/azure-mongo-vcore-discovery',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'provider' }),
                getChildren: jest.fn().mockResolvedValue([mockNonClusterElement]),
            };

            const children = await dataProvider.getChildren(mockParentElement);

            // Element should be unchanged (no cluster property added)
            expect(children).toBeDefined();
            // @ts-expect-error - checking cluster property doesn't exist
            expect(children![0].cluster).toBeUndefined();
        });

        it('should handle multiple cluster children with correct prefixes', async () => {
            const prefixedClusterId1 = 'azure-mongo-ru-discovery__subscriptions_sub1_clusters_cluster1';
            const prefixedClusterId2 = 'azure-mongo-ru-discovery__subscriptions_sub1_clusters_cluster2';
            const mockClusterElement1 = {
                id: 'cluster-element-id-1',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: prefixedClusterId1,
                    name: 'Test Cluster 1',
                },
            };
            const mockClusterElement2 = {
                id: 'cluster-element-id-2',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: prefixedClusterId2,
                    name: 'Test Cluster 2',
                },
            };

            const mockParentElement = {
                id: 'discoveryView/azure-mongo-ru-discovery/subscription1',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
                getChildren: jest.fn().mockResolvedValue([mockClusterElement1, mockClusterElement2]),
            };

            const children = await dataProvider.getChildren(mockParentElement);

            // Both should remain unchanged (already prefixed correctly)
            expect(children).toBeDefined();
            expect(children!.length).toBe(2);
            // @ts-expect-error - accessing cluster property on tree element
            expect(children![0].cluster.clusterId).toBe(prefixedClusterId1);
            // @ts-expect-error - accessing cluster property on tree element
            expect(children![1].cluster.clusterId).toBe(prefixedClusterId2);
        });

        it('should skip validation when provider ID cannot be extracted from tree ID', async () => {
            // Non-prefixed cluster ID - but validation is skipped when provider ID is unknown
            const nonPrefixedClusterId = '_subscriptions_sub1_clusters_cluster1';
            const mockClusterElement = {
                id: 'cluster-element-id',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: nonPrefixedClusterId,
                    name: 'Test Cluster',
                },
            };

            // Parent element with invalid tree ID format (can't extract provider ID)
            const mockParentElement = {
                id: 'invalid-tree-id-format',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'unknown' }),
                getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
            };

            const children = await dataProvider.getChildren(mockParentElement);

            // Should not throw because provider ID couldn't be extracted (validation skipped)
            expect(children).toBeDefined();
            // @ts-expect-error - accessing cluster property on tree element
            expect(children![0].cluster.clusterId).toBe(nonPrefixedClusterId);
        });

        it('should throw when cluster ID has unexpected provider prefix', async () => {
            // Cluster ID with wrong provider prefix
            const wrongPrefixClusterId = 'wrong-provider__subscriptions_sub1_clusters_cluster1';
            const mockClusterElement = {
                id: 'cluster-element-id',
                contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
                cluster: {
                    clusterId: wrongPrefixClusterId,
                    name: 'Test Cluster',
                },
            };

            const mockParentElement = {
                id: 'discoveryView/azure-mongo-vcore-discovery/subscription1',
                getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
                getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
            };

            // Should throw an error about unexpected prefix
            await expect(dataProvider.getChildren(mockParentElement)).rejects.toThrow(
                /must start with provider ID.*azure-mongo-vcore-discovery/,
            );
        });
    });
});
