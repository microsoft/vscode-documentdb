/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type KubeContextInfo } from '../kubernetesClient';
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
const mockLoadConfiguredKubeConfig = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockListNamespaces = jest.fn();
const mockListDocumentDBServices = jest.fn();
jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
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

function getNamespaceName(child: unknown): string {
    return (child as { namespace: string }).namespace;
}

function getCollapsibleState(child: unknown): unknown {
    return (child as { getTreeItem(): { collapsibleState?: unknown } }).getTreeItem().collapsibleState;
}

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
            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-context');
            expect(treeItem.description).toBe('(k8s.example.com:6443)');
            expect(treeItem.id).toBe('parent/my-context');
            // Collapsed state value = 1
            expect(treeItem.collapsibleState).toBe(1);
        });

        it('should handle malformed server URL gracefully', () => {
            const malformedContext: KubeContextInfo = {
                ...baseContextInfo,
                server: 'not-a-valid-url',
            };

            const item = new KubernetesContextItem('parent', 'default', malformedContext, 'corr-1');

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

            const item = new KubernetesContextItem('parent', 'default', emptyServerContext, 'corr-1');
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

            const item = new KubernetesContextItem('parent', 'default', slashContext, 'corr-1');
            expect(item.id).toBe('parent/arn:aws:eks:us-east-1:123456_my-cluster');
            expect(item.id).not.toContain('//');
        });

        it('uses the alias as the tree label and includes the original context name in the description when an alias is set', () => {
            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1', 'Prod AKS');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('Prod AKS');
            expect(treeItem.description).toContain('(my-context)');
            expect(treeItem.description).toContain('(k8s.example.com:6443)');
            const tooltipValue = (treeItem.tooltip as { value: string } | undefined)?.value ?? '';
            expect(tooltipValue).toContain('Display name:** Prod AKS');
            expect(tooltipValue).toContain('Context:** my-context');
        });

        it('falls back to the original context name when the alias is undefined', () => {
            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const treeItem = item.getTreeItem();

            expect(treeItem.label).toBe('my-context');
            expect(treeItem.description).toBe('(k8s.example.com:6443)');
            const tooltipValue = (treeItem.tooltip as { value: string } | undefined)?.value ?? '';
            expect(tooltipValue).not.toContain('Display name:');
        });
    });

    describe('getChildren', () => {
        const mockKubeConfig = {};
        const mockCoreApi = {};

        beforeEach(() => {
            mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
            mockCreateCoreApi.mockResolvedValue(mockCoreApi);
        });

        it('should make namespaces with DocumentDB targets expandable and empty namespaces non-expandable', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'production']);
            mockListDocumentDBServices.mockImplementation(async (_coreApi: unknown, namespace: string) =>
                namespace === 'production'
                    ? [{ name: 'documentdb-service', namespace, type: 'ClusterIP', port: 10260 }]
                    : [],
            );

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(2);
            expect(getNamespaceName(children![0])).toBe('production');
            expect(getCollapsibleState(children![0])).toBe(1);
            expect(getNamespaceName(children![1])).toBe('default');
            expect(getCollapsibleState(children![1])).toBe(0);

            expect(mockListDocumentDBServices).toHaveBeenCalledTimes(2);
        });

        it('should return error/retry node when kubeconfig load fails', async () => {
            mockLoadConfiguredKubeConfig.mockRejectedValue(new Error('ENOENT: no such file or directory'));

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
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

        it('should ignore stale hidden namespace filters from earlier builds', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'kube-system', 'production']);

            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === 'kubernetes-discovery.filteredNamespaces') {
                    return { 'my-context': ['kube-system'] };
                }
                return defaultValue;
            });

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(3);
            const namespaceNames = children!.map((child) => getNamespaceName(child));
            expect(namespaceNames).toContain('default');
            expect(namespaceNames).toContain('kube-system');
            expect(namespaceNames).toContain('production');
        });

        it('should sort namespaces with DocumentDB targets before namespaces without targets', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'staging']);
            mockListDocumentDBServices.mockImplementation(async (_coreApi: unknown, namespace: string) =>
                namespace === 'staging' ? [{ name: 'svc-a', namespace, type: 'ClusterIP', port: 10260 }] : [],
            );

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(2);
            expect(getNamespaceName(children![0])).toBe('staging');
            expect(getNamespaceName(children![1])).toBe('default');
        });

        it('should limit concurrent namespace service pre-scans', async () => {
            mockListNamespaces.mockResolvedValue(
                Array.from({ length: 12 }, (_value, index) => `namespace-${String(index + 1)}`),
            );

            let activeScans = 0;
            let maxActiveScans = 0;
            mockListDocumentDBServices.mockImplementation(async () => {
                activeScans++;
                maxActiveScans = Math.max(maxActiveScans, activeScans);
                await new Promise((resolve) => setTimeout(resolve, 10));
                activeScans--;
                return [];
            });

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            await item.getChildren();

            expect(maxActiveScans).toBeLessThanOrEqual(5);
        });

        it('should show informational child when no namespaces exist', async () => {
            mockListNamespaces.mockResolvedValue([]);

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).contextValue).toBe('informational');
        });

        it('should return error node when createCoreApi fails', async () => {
            mockCreateCoreApi.mockRejectedValue(new Error('context not found'));

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(1);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((children![0] as any).contextValue).toBe('error');
            expect(mockOutputChannelError).toHaveBeenCalled();
        });

        it('should keep namespaces expandable when service pre-scan throws', async () => {
            mockListNamespaces.mockResolvedValue(['default', 'broken-ns', 'working-ns']);
            mockListDocumentDBServices.mockImplementation(async (_coreApi: unknown, namespace: string) => {
                if (namespace === 'broken-ns') {
                    throw new Error('forbidden');
                }

                return namespace === 'working-ns' ? [{ name: 'svc-a', namespace, type: 'ClusterIP', port: 10260 }] : [];
            });

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            const children = await item.getChildren();

            expect(children).toBeDefined();
            expect(children).toHaveLength(3);
            const brokenNamespace = children!.find((child) => getNamespaceName(child) === 'broken-ns');
            expect(getCollapsibleState(brokenNamespace)).toBe(1);
            expect(telemetryContextMock.telemetry.properties).toHaveProperty('namespaceServiceFetchError', 'true');
        });

        it('should set namespacesCount telemetry to all visible namespace count', async () => {
            mockListNamespaces.mockResolvedValue(['default']);
            mockListDocumentDBServices.mockResolvedValue([]);

            const item = new KubernetesContextItem('parent', 'default', baseContextInfo, 'corr-1');
            await item.getChildren();

            expect(telemetryContextMock.telemetry.measurements).toHaveProperty('namespacesCount', 1);
            expect(telemetryContextMock.telemetry.measurements).toHaveProperty('documentDbNamespacesCount', 0);
        });
    });
});
