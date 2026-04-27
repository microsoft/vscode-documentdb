/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type KubeContextInfo, type KubeServiceInfo } from '../kubernetesClient';
import { KubernetesNamespaceItem } from './KubernetesNamespaceItem';

// --- Telemetry mock context ---
const telemetryContextMock = {
    telemetry: { properties: {} as Record<string, string>, measurements: {} as Record<string, number> },
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
        async (_eventName: string, callback: (context: IActionContext) => Promise<unknown>) => {
            return await callback(telemetryContextMock as unknown as IActionContext);
        },
    ),
}));

jest.mock('vscode', () => ({
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((template: string, ...args: unknown[]) =>
            template.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
        ),
    },
}));

const mockOutputChannelError = jest.fn();
jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
                update: jest.fn(() => Promise.resolve()),
            },
        },
        outputChannel: {
            appendLine: jest.fn(),
            error: (...args: unknown[]) => mockOutputChannelError(...args),
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

const mockLoadConfiguredKubeConfig = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListDocumentDBServices = jest.fn();
jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    listDocumentDBServices: (...args: unknown[]) => mockListDocumentDBServices(...args),
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
        contextValue: opts.contextValue,
    })),
}));

jest.mock('./KubernetesServiceItem', () => ({
    KubernetesServiceItem: class KubernetesServiceItem {
        constructor(
            public readonly journeyCorrelationId: string,
            public readonly contextInfo: KubeContextInfo,
            public readonly serviceInfo: KubeServiceInfo,
            public readonly parentId: string,
        ) {}
    },
}));

describe('KubernetesNamespaceItem', () => {
    const baseContextInfo: KubeContextInfo = {
        name: 'my-context',
        cluster: 'my-cluster',
        user: 'my-user',
        server: 'https://k8s.example.com:6443',
    };
    const mockKubeConfig = {};
    const mockCoreApi = {};

    beforeEach(() => {
        jest.clearAllMocks();
        telemetryContextMock.telemetry = { properties: {}, measurements: {} };
        mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
        mockCreateCoreApi.mockResolvedValue(mockCoreApi);
    });

    describe('getTreeItem', () => {
        it('should return correct tree item', () => {
            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-ns');
            expect(treeItem.id).toBe('parent/ctx/my-ns');
            expect(treeItem.collapsibleState).toBe(1);
        });

        it('should return a non-expandable namespace item when preloaded services are empty', () => {
            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1', []);
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-ns');
            expect(treeItem.description).toBe('No DocumentDB targets');
            expect(treeItem.collapsibleState).toBe(0);
        });

        it('should describe preloaded DocumentDB targets on expandable namespace items', () => {
            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1', [
                { name: 'svc-a', namespace: 'my-ns', type: 'LoadBalancer', port: 10260 } as KubeServiceInfo,
                { name: 'svc-b', namespace: 'my-ns', type: 'ClusterIP', port: 10260 } as KubeServiceInfo,
            ]);
            const treeItem = item.getTreeItem();

            expect(treeItem.description).toBe('2 DocumentDB targets');
            expect(treeItem.collapsibleState).toBe(1);
        });
    });

    describe('getChildren', () => {
        it('should return service items when services are found', async () => {
            const services: KubeServiceInfo[] = [
                { name: 'svc-a', namespace: 'my-ns', type: 'LoadBalancer', port: 27017 } as KubeServiceInfo,
                { name: 'svc-b', namespace: 'my-ns', type: 'ClusterIP', port: 10260 } as KubeServiceInfo,
            ];
            mockListDocumentDBServices.mockResolvedValue(services);

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(2);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).serviceInfo.name).toBe('svc-a');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![1] as any).serviceInfo.name).toBe('svc-b');
        });

        it('should return preloaded service items without reading the cluster again', async () => {
            const services: KubeServiceInfo[] = [
                { name: 'svc-a', namespace: 'my-ns', type: 'LoadBalancer', port: 10260 } as KubeServiceInfo,
            ];

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1', services);
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            expect(mockLoadConfiguredKubeConfig).not.toHaveBeenCalled();
            expect(mockCreateCoreApi).not.toHaveBeenCalled();
            expect(mockListDocumentDBServices).not.toHaveBeenCalled();
        });

        it('should show informational child when no DocumentDB services are found', async () => {
            mockListDocumentDBServices.mockResolvedValue([]);

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).contextValue).toBe('informational');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).label).toBe('No DocumentDB services found in this namespace.');
        });

        it('should show retry/error child and log diagnostics on RBAC or service-list failure', async () => {
            mockListDocumentDBServices.mockRejectedValue(new Error('RBAC: forbidden'));

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errorNode = children![0] as any;
            expect(errorNode.contextValue).toBe('error');
            expect(errorNode.id).toContain('retry');
            expect(errorNode.label).toBe('Failed to list services. Click to retry.');
            expect(mockOutputChannelError).toHaveBeenCalledWith(
                expect.stringContaining('Failed to list services in "my-context/my-ns"'),
            );
            expect(telemetryContextMock.telemetry.properties).toHaveProperty('serviceFetchError', 'true');
        });

        it('should show retry/error child when kubeconfig fails to load', async () => {
            mockLoadConfiguredKubeConfig.mockRejectedValue(new Error('ENOENT: config not found'));

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).contextValue).toBe('error');
            expect(mockOutputChannelError).toHaveBeenCalled();
        });

        it('should set telemetry measurements for service count and load time', async () => {
            const services: KubeServiceInfo[] = [
                { name: 'svc-a', namespace: 'my-ns', type: 'LoadBalancer', port: 27017 } as KubeServiceInfo,
            ];
            mockListDocumentDBServices.mockResolvedValue(services);

            const item = new KubernetesNamespaceItem('parent/ctx', baseContextInfo, 'my-ns', 'corr-1');
            await item.getChildren();

            expect(telemetryContextMock.telemetry.measurements).toHaveProperty('discoveryResourcesCount', 1);
            expect(telemetryContextMock.telemetry.measurements).toHaveProperty('discoveryLoadTimeMs');
            expect(telemetryContextMock.telemetry.measurements.discoveryLoadTimeMs).toBeGreaterThanOrEqual(0);
        });
    });
});
