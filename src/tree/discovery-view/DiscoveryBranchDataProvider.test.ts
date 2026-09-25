/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { resetDiscoveryProviderVisibilityCacheForTests } from '../../services/discoveryProviderVisibility';
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

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName, callback: (context: IActionContext) => Promise<unknown>) => {
            return await callback(telemetryContextMock);
        },
    ),
    createContextValue: jest.fn((values: string[]) => values.join(';')),
}));

jest.mock('vscode', () => ({
    Disposable: class Disposable {
        dispose(): void {
            // Mock dispose
        }
    },
    EventEmitter: class EventEmitter {
        fire(): void {
            // Mock fire
        }
        get event(): jest.Mock {
            return jest.fn();
        }
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    l10n: {
        t: jest.fn((str: string) => str),
    },
}));

const mockGlobalStateGet = jest.fn();
const mockGlobalStateUpdate = jest.fn();

jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (...args: unknown[]) => mockGlobalStateGet(...args),
                update: (...args: unknown[]) => mockGlobalStateUpdate(...args),
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

jest.mock('../../services/discoveryServices', () => ({
    DiscoveryService: {
        listProviders: jest.fn(),
        getProvider: jest.fn(),
    },
}));

interface MockTreeElement {
    readonly id: string;
    readonly contextValue?: string;
    readonly cluster?: { readonly clusterId: string; readonly name: string };
    getTreeItem(): Promise<{ readonly contextValue?: string }>;
    getChildren?(): Promise<MockTreeElement[]>;
}

const listProvidersMock = DiscoveryService.listProviders as jest.Mock;
const getProviderMock = DiscoveryService.getProvider as jest.Mock;

function createRootProvider(id: string): unknown {
    return {
        id,
        label: `Provider ${id}`,
        getDiscoveryTreeRootItem: jest.fn().mockReturnValue({
            id: `discoveryView/${id}`,
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'rootItem' }),
            getChildren: jest.fn().mockResolvedValue([]),
        }),
    };
}

function setGlobalState(values: Record<string, unknown>): void {
    mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue,
    );
}

describe('DiscoveryBranchDataProvider - provider visibility', () => {
    let dataProvider: DiscoveryBranchDataProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        resetDiscoveryProviderVisibilityCacheForTests();
        telemetryContextMock.telemetry = { properties: {}, measurements: {} };
        mockGlobalStateUpdate.mockResolvedValue(undefined);
        listProvidersMock.mockReturnValue([
            { id: 'provider-a', label: 'Provider A' },
            { id: 'provider-b', label: 'Provider B' },
        ]);
        getProviderMock.mockImplementation((id: string) => createRootProvider(id));
        dataProvider = new DiscoveryBranchDataProvider();
    });

    it('shows all registered providers by default when no visibility state exists', async () => {
        setGlobalState({});

        const result = await dataProvider.getChildren(undefined as never);

        expect(result).toHaveLength(2);
        expect(result?.map((node) => node.id)).toEqual(['discoveryView/provider-a', 'discoveryView/provider-b']);
        expect(telemetryContextMock.telemetry.measurements).toMatchObject({
            activeDiscoveryProviders: 2,
            hiddenDiscoveryProviders: 0,
        });
    });

    it('hides only providers stored in hiddenDiscoveryProviderIds', async () => {
        setGlobalState({
            hiddenDiscoveryProviderIds: ['provider-b'],
        });

        const result = await dataProvider.getChildren(undefined as never);

        expect(result).toHaveLength(1);
        expect(result?.[0]?.id).toBe('discoveryView/provider-a');
        expect(mockGlobalStateUpdate).not.toHaveBeenCalled();
        expect(telemetryContextMock.telemetry.measurements).toMatchObject({
            activeDiscoveryProviders: 1,
            hiddenDiscoveryProviders: 1,
        });
    });
});

describe('DiscoveryBranchDataProvider - Cluster ID Validation', () => {
    let dataProvider: DiscoveryBranchDataProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        resetDiscoveryProviderVisibilityCacheForTests();
        dataProvider = new DiscoveryBranchDataProvider();
    });

    it('accepts cluster IDs with the provider prefix', async () => {
        const prefixedClusterId =
            'azure-mongo-vcore-discovery__subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1';
        const mockClusterElement: MockTreeElement = {
            id: 'cluster-element-id',
            contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
            cluster: {
                clusterId: prefixedClusterId,
                name: 'Test Cluster',
            },
        };

        const mockParentElement: MockTreeElement = {
            id: 'discoveryView/azure-mongo-vcore-discovery/subscription1',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
            getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
        };

        const children = await dataProvider.getChildren(mockParentElement);

        expect(children).toBeDefined();
        expect((children?.[0] as MockTreeElement).cluster?.clusterId).toBe(prefixedClusterId);
    });

    it('throws when cluster ID is missing the provider prefix', async () => {
        const mockClusterElement: MockTreeElement = {
            id: 'cluster-element-id',
            contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
            cluster: {
                clusterId:
                    '_subscriptions_sub1_resourceGroups_rg1_providers_Microsoft.DocumentDB_mongoClusters_cluster1',
                name: 'Test Cluster',
            },
        };

        const mockParentElement: MockTreeElement = {
            id: 'discoveryView/azure-mongo-vcore-discovery/subscription1',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'subscription' }),
            getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
        };

        await expect(dataProvider.getChildren(mockParentElement)).rejects.toThrow(/must start with provider ID/i);
    });

    it('skips validation when provider ID cannot be extracted from tree ID', async () => {
        const nonPrefixedClusterId = '_subscriptions_sub1_clusters_cluster1';
        const mockClusterElement: MockTreeElement = {
            id: 'cluster-element-id',
            contextValue: 'treeItem_documentdbcluster;experience_MongoDB',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'treeItem_documentdbcluster' }),
            cluster: {
                clusterId: nonPrefixedClusterId,
                name: 'Test Cluster',
            },
        };

        const mockParentElement: MockTreeElement = {
            id: 'invalid-tree-id-format',
            getTreeItem: jest.fn().mockResolvedValue({ contextValue: 'unknown' }),
            getChildren: jest.fn().mockResolvedValue([mockClusterElement]),
        };

        const children = await dataProvider.getChildren(mockParentElement);

        expect((children?.[0] as MockTreeElement).cluster?.clusterId).toBe(nonPrefixedClusterId);
    });
});
