/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KubernetesRootItem } from './KubernetesRootItem';

jest.mock('crypto', () => ({
    randomUUID: jest.fn(() => 'corr-1'),
}));

jest.mock('vscode', () => ({
    commands: {
        executeCommand: jest.fn(),
    },
    window: {
        showInformationMessage: jest.fn(),
    },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    l10n: {
        t: jest.fn((message: string) => message),
    },
}));

const mockGlobalStateGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
const mockOutputChannelError = jest.fn();

jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (key: string, defaultValue?: unknown) => mockGlobalStateGet(key, defaultValue),
                update: jest.fn(() => Promise.resolve()),
            },
        },
        outputChannel: {
            warn: jest.fn(),
            error: (...args: unknown[]) => mockOutputChannelError(...args),
            trace: jest.fn(),
        },
    },
}));

const mockLoadConfiguredKubeConfig = jest.fn();
const mockGetContexts = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListNamespaces = jest.fn();
const mockListDocumentDBServices = jest.fn();

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    getContexts: (...args: unknown[]) => mockGetContexts(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    listNamespaces: (...args: unknown[]) => mockListNamespaces(...args),
    listDocumentDBServices: (...args: unknown[]) => mockListDocumentDBServices(...args),
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
        contextValue: opts.contextValue,
        commandId: opts.commandId,
    })),
}));

jest.mock('./KubernetesContextItem', () => ({
    KubernetesContextItem: class KubernetesContextItem {
        constructor(
            public readonly parentId: string,
            public readonly contextInfo: { name: string },
            public readonly journeyCorrelationId: string,
        ) {}
    },
}));

describe('KubernetesRootItem', () => {
    const mockKubeConfig = {};
    const liveContext = {
        name: 'kind-documentdb-dev',
        cluster: 'kind-documentdb-dev',
        user: 'kind-user',
        server: 'https://127.0.0.1:6443',
    };
    const deadContext = {
        name: 'kind-documentdb-old',
        cluster: 'kind-documentdb-old',
        user: 'kind-user',
        server: 'https://127.0.0.1:55555',
    };
    const hiddenContext = {
        name: 'kind-documentdb-hidden',
        cluster: 'kind-documentdb-hidden',
        user: 'kind-user',
        server: 'https://127.0.0.1:44444',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
        mockGetContexts.mockReturnValue([liveContext, deadContext, hiddenContext]);
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'kubernetes-discovery.enabledContexts') {
                return [liveContext.name, deadContext.name, hiddenContext.name];
            }
            if (key === 'kubernetes-discovery.hiddenContexts') {
                return [];
            }
            return defaultValue;
        });
    });

    it('lists all enabled visible contexts without service scanning (lazy)', async () => {
        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        // All three enabled, none hidden → all three returned
        expect(children).toHaveLength(3);
        const names = children.map((child) => (child as unknown as { contextInfo: { name: string } }).contextInfo.name);
        expect(names).toContain(liveContext.name);
        expect(names).toContain(deadContext.name);
        expect(names).toContain(hiddenContext.name);

        // Root must NOT scan namespaces or services
        expect(mockCreateCoreApi).not.toHaveBeenCalled();
        expect(mockListNamespaces).not.toHaveBeenCalled();
        expect(mockListDocumentDBServices).not.toHaveBeenCalled();
    });

    it('excludes contexts listed in HIDDEN_CONTEXTS_KEY', async () => {
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'kubernetes-discovery.enabledContexts') {
                return [liveContext.name, deadContext.name, hiddenContext.name];
            }
            if (key === 'kubernetes-discovery.hiddenContexts') {
                return [hiddenContext.name];
            }
            return defaultValue;
        });

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        expect(children).toHaveLength(2);
        const names = children.map((child) => (child as unknown as { contextInfo: { name: string } }).contextInfo.name);
        expect(names).not.toContain(hiddenContext.name);
        expect(names).toContain(liveContext.name);
        expect(names).toContain(deadContext.name);
    });

    it('treats all kubeconfig contexts as enabled when none have been configured yet', async () => {
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'kubernetes-discovery.hiddenContexts') {
                return [];
            }
            // ENABLED_CONTEXTS_KEY not set → resolveEnabledContextNames falls back to all contexts
            return defaultValue;
        });

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        // All three contexts are present since none have been explicitly enabled/disabled
        expect(children).toHaveLength(3);
        // No scanning should occur
        expect(mockCreateCoreApi).not.toHaveBeenCalled();
        expect(mockListNamespaces).not.toHaveBeenCalled();
    });

    it('returns a retry node when kubeconfig fails to load', async () => {
        mockLoadConfiguredKubeConfig.mockRejectedValue(new Error('ENOENT: no such file'));

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({
            contextValue: 'error',
            id: 'discoveryView/kubernetes-discovery/retry',
            label: 'Failed to load kubeconfig. Click to retry.',
        });
        expect(mockOutputChannelError).toHaveBeenCalledWith(expect.stringContaining('Failed to load kubeconfig'));
    });

    it('returns a retry node when no contexts exist in kubeconfig', async () => {
        mockGetContexts.mockReturnValue([]);

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({
            contextValue: 'error',
            id: 'discoveryView/kubernetes-discovery/retry',
            label: 'No Kubernetes contexts found in the configured kubeconfig. Click to retry.',
        });
    });

    it('returns a retry node when all enabled contexts are hidden', async () => {
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'kubernetes-discovery.enabledContexts') {
                return [liveContext.name, deadContext.name, hiddenContext.name];
            }
            // Hide all contexts
            if (key === 'kubernetes-discovery.hiddenContexts') {
                return [liveContext.name, deadContext.name, hiddenContext.name];
            }
            return defaultValue;
        });

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({
            contextValue: 'error',
            commandId: 'vscode-documentdb.command.discoveryView.filterProviderContent',
            label: 'All Kubernetes contexts are hidden by Filter. Use Filter to show contexts.',
        });
    });

    it('returns a retry node when no contexts are enabled', async () => {
        mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
            if (key === 'kubernetes-discovery.enabledContexts') {
                return [];
            }
            if (key === 'kubernetes-discovery.hiddenContexts') {
                return [];
            }
            return defaultValue;
        });

        const item = new KubernetesRootItem('discoveryView');
        const children = await item.getChildren();

        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({
            contextValue: 'error',
            commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
            label: 'No enabled contexts found in kubeconfig. Click to reconfigure.',
        });
    });
});
