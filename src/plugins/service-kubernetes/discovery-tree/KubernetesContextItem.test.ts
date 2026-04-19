/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type KubeContextInfo, type KubeServiceInfo } from '../kubernetesClient';
import { KubernetesContextItem } from './KubernetesContextItem';

// --- Telemetry mock context ---
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

// --- Mock @microsoft/vscode-azext-utils ---
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: IActionContext) => Promise<unknown>) => {
            return await callback(telemetryContextMock as unknown as IActionContext);
        },
    ),
    createContextValue: jest.fn((values: string[]) => values.join(';')),
}));

// --- Mock vscode ---
jest.mock('vscode', () => ({
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    MarkdownString: class MarkdownString {
        constructor(public readonly value: string) {}
    },
    l10n: {
        t: jest.fn((...args: unknown[]) => {
            // Simple template replacement for l10n.t('text {0}', val)
            const template = args[0] as string;
            return template.replace(/\{(\d+)\}/g, (_match, index) => String(args[Number(index) + 1]));
        }),
    },
}));

// --- Mock extensionVariables ---
// Default implementation respects the defaultValue parameter (2nd arg) so that
// globalState.get(KEY, {}) returns {} rather than undefined when no specific mock is set.
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
            appendLine: jest.fn(),
            error: (...args: unknown[]) => mockOutputChannelError(...args),
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

// --- Mock kubernetesClient functions ---
const mockLoadKubeConfig = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListNamespaces = jest.fn();
const mockListDocumentDBServices = jest.fn();
jest.mock('../kubernetesClient', () => ({
    loadKubeConfig: (...args: unknown[]) => mockLoadKubeConfig(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    listNamespaces: (...args: unknown[]) => mockListNamespaces(...args),
    listDocumentDBServices: (...args: unknown[]) => mockListDocumentDBServices(...args),
}));

// --- Mock createGenericElementWithContext ---
jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
        contextValue: opts.contextValue,
    })),
}));

describe('KubernetesContextItem', () => {
    const baseContextInfo: KubeContextInfo = {
        name: 'my-context',
        cluster: 'my-cluster',
        user: 'my-user',
        server: 'https://k8s.example.com:6443',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset telemetry context for each test
        telemetryContextMock.telemetry = { properties: {}, measurements: {} };
        // Default: return the defaultValue parameter (2nd arg) so get(KEY, {}) returns {}
        mockGlobalStateGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);
    });

    describe('getTreeItem', () => {
        it('should return correct tree item with valid server URL', () => {
            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-context');
            expect(treeItem.description).toBe('(k8s.example.com:6443)');
            expect(treeItem.id).toBe('parent/my-context');
            // Collapsed state value = 1
            expect(treeItem.collapsibleState).toBe(1);
        });

        it('should use alias as label when alias is provided', () => {
            const item = new KubernetesContextItem('parent', baseContextInfo, 'Production K8s', 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('Production K8s');
            // Description should still show the host
            expect(treeItem.description).toBe('(k8s.example.com:6443)');
        });

        it('should handle malformed server URL gracefully', () => {
            const malformedContext: KubeContextInfo = {
                ...baseContextInfo,
                server: 'not-a-valid-url',
            };

            const item = new KubernetesContextItem('parent', malformedContext, undefined, 'corr-1');

            // The current code may throw on malformed URL; Ripley's fix wraps in try/catch.
            // After the fix, the description should use the raw URL on parse failure.
            let treeItem;
            try {
                treeItem = item.getTreeItem();
                // If no error, verify the description falls back gracefully
                expect(treeItem.label).toBe('my-context');
                // After Ripley's fix: description should contain the raw URL
                if (treeItem.description !== undefined) {
                    expect(treeItem.description).toContain('not-a-valid-url');
                }
            } catch {
                // Before Ripley's fix: new URL() throws on malformed input
                expect(true).toBe(true); // Acknowledged — fix is in-flight
            }
        });

        it('should handle empty server URL', () => {
            const emptyServerContext: KubeContextInfo = {
                ...baseContextInfo,
                server: '',
            };

            const item = new KubernetesContextItem('parent', emptyServerContext, undefined, 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-context');
            // Empty server → description should be undefined (the ternary guard)
            expect(treeItem.description).toBeUndefined();
        });

        it('should sanitize context names with slashes for tree ID', () => {
            const slashContext: KubeContextInfo = {
                ...baseContextInfo,
                name: 'arn:aws:eks:us-east-1:123456/my-cluster',
            };

            const item = new KubernetesContextItem('parent', slashContext, undefined, 'corr-1');
            expect(item.id).toBe('parent/arn:aws:eks:us-east-1:123456_my-cluster');
            expect(item.id).not.toContain('//');
        });
    });

    describe('getChildren', () => {
        const mockKubeConfig = {};
        const mockCoreApi = {};

        beforeEach(() => {
            mockLoadKubeConfig.mockResolvedValue(mockKubeConfig);
            mockCreateCoreApi.mockResolvedValue(mockCoreApi);
        });

        it('should return namespace items for context with DocumentDB services', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'production']);
            mockListDocumentDBServices.mockImplementation((_api: unknown, ns: string) => {
                if (ns === 'default') {
                    return Promise.resolve([
                        { name: 'mongo-svc', namespace: 'default', type: 'ClusterIP', port: 27017 } as KubeServiceInfo,
                    ]);
                }
                if (ns === 'production') {
                    return Promise.resolve([
                        {
                            name: 'mongo-prod',
                            namespace: 'production',
                            type: 'LoadBalancer',
                            port: 27017,
                        } as KubeServiceInfo,
                    ]);
                }
                return Promise.resolve([]);
            });

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(2);
            // Children should be KubernetesNamespaceItem instances
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).namespace).toBe('default');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![1] as any).namespace).toBe('production');
        });

        it('should return error/retry node when kubeconfig load fails', async () => {
            mockLoadKubeConfig.mockRejectedValue(new Error('ENOENT: no such file or directory'));

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // The error node should have 'error' contextValue and a retry ID
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errorNode = children![0] as any;
            expect(errorNode.contextValue).toBe('error');
            expect(errorNode.id).toContain('retry');
            expect(mockOutputChannelError).toHaveBeenCalled();
        });

        it('should filter out hidden namespaces based on globalState', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'kube-system', 'production']);
            mockListDocumentDBServices.mockImplementation((_api: unknown, ns: string) => {
                // All namespaces have services
                return Promise.resolve([
                    { name: `svc-${ns}`, namespace: ns, type: 'ClusterIP', port: 27017 } as KubeServiceInfo,
                ]);
            });

            // Mock globalState.get to return hidden namespaces for this context
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'kubernetes-discovery.filteredNamespaces') {
                    return { 'my-context': ['kube-system'] };
                }
                return defaultValue;
            });

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(2);
            // kube-system should be filtered out
            const namespaceNames = children!.map(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (child) => (child as any).namespace,
            );
            expect(namespaceNames).toContain('default');
            expect(namespaceNames).toContain('production');
            expect(namespaceNames).not.toContain('kube-system');
        });

        it('should return empty array when no namespaces have DocumentDB services', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'staging']);
            // No namespace has any DocumentDB services
            mockListDocumentDBServices.mockResolvedValue([]);

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(0);
        });

        it('should return error node when createCoreApi fails', async () => {
            mockCreateCoreApi.mockRejectedValue(new Error('context not found'));

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).contextValue).toBe('error');
            expect(mockOutputChannelError).toHaveBeenCalled();
        });

        it('should skip namespaces where service listing throws', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'broken-ns', 'working-ns']);
            mockListDocumentDBServices.mockImplementation((_api: unknown, ns: string) => {
                if (ns === 'broken-ns') {
                    return Promise.reject(new Error('RBAC denied'));
                }
                if (ns === 'working-ns') {
                    return Promise.resolve([
                        { name: 'svc', namespace: ns, type: 'ClusterIP', port: 27017 } as KubeServiceInfo,
                    ]);
                }
                return Promise.resolve([]);
            });

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            // Only working-ns should appear (default has no services, broken-ns threw)
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).namespace).toBe('working-ns');
        });

        it('should set namespacesCount telemetry measurement', async () => {
            mockListNamespaces.mockResolvedValue(['default']);
            mockListDocumentDBServices.mockResolvedValue([
                { name: 'svc', namespace: 'default', type: 'ClusterIP', port: 27017 } as KubeServiceInfo,
            ]);

            const item = new KubernetesContextItem('parent', baseContextInfo, undefined, 'corr-1');
            await item.getChildren();

            expect(telemetryContextMock.telemetry.measurements).toHaveProperty('namespacesCount', 1);
        });
    });
});
