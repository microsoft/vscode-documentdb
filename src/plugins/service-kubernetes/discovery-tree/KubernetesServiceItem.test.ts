/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KUBERNETES_PORT_FORWARD_METADATA_PROPERTY } from '../portForwardMetadata';
import { KubernetesServiceItem } from './KubernetesServiceItem';

const mockHasCredentials = jest.fn();
const mockGetClient = jest.fn();

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, values?: Record<string, string>) => {
        if (!values) {
            return message;
        }

        return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), message);
    }),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    MarkdownString: class MarkdownString {
        public isTrusted = false;
        private readonly chunks: string[] = [];

        constructor(initialValue?: string) {
            if (initialValue) {
                this.chunks.push(initialValue);
            }
        }

        public appendMarkdown(value: string): void {
            this.chunks.push(value);
        }

        public toString(): string {
            return this.chunks.join('');
        }
    },
    l10n: {
        t: jest.fn((message: string) => message),
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    ProgressLocation: {
        Notification: 15,
    },
    window: {
        withProgress: async (
            _options: unknown,
            task: (
                _progress: unknown,
                token: { onCancellationRequested: (cb: () => void) => void },
            ) => Promise<unknown>,
        ) => await task(undefined, { onCancellationRequested: () => {} }),
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) =>
            await callback({
                telemetry: { properties: {}, measurements: {} },
                errorHandling: {},
                valuesToMask: [],
            }),
    ),
    createGenericElement: jest.fn((options: Record<string, unknown>) => options),
    AzureWizard: class AzureWizard {
        constructor(_context: unknown, _options: unknown) {}
        public async prompt(): Promise<void> {}
    },
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            append: jest.fn(),
            appendLine: jest.fn(),
            debug: jest.fn(),
        },
        state: {
            notifyChildrenChanged: jest.fn(),
        },
    },
}));

jest.mock('../../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: (...args: unknown[]) => mockHasCredentials(...args),
        deleteCredentials: jest.fn(),
        setAuthCredentials: jest.fn(),
    },
}));

jest.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: (...args: unknown[]) => mockGetClient(...args),
        deleteClient: jest.fn(),
    },
}));

jest.mock('../../../tree/api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: jest.fn((options: Record<string, unknown>) => options),
}));

// Mock kubernetesClient module
const mockLoadConfiguredKubeConfig = jest.fn();
const mockCreateCoreApi = jest.fn();
const mockResolveServiceEndpoint = jest.fn();
const mockResolveDocumentDBCredentials = jest.fn();
const mockResolveGenericServiceCredentials = jest.fn();
const mockBuildPortForwardConnectionString = jest.fn();

jest.mock('../kubernetesClient', () => ({
    loadConfiguredKubeConfig: (...args: unknown[]) => mockLoadConfiguredKubeConfig(...args),
    createCoreApi: (...args: unknown[]) => mockCreateCoreApi(...args),
    resolveServiceEndpoint: (...args: unknown[]) => mockResolveServiceEndpoint(...args),
    resolveDocumentDBCredentials: (...args: unknown[]) => mockResolveDocumentDBCredentials(...args),
    resolveGenericServiceCredentials: (...args: unknown[]) => mockResolveGenericServiceCredentials(...args),
    buildPortForwardConnectionString: (...args: unknown[]) => mockBuildPortForwardConnectionString(...args),
}));

// Mock PortForwardTunnelManager
const mockStartTunnel = jest.fn();
jest.mock('../portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: () => ({
            startTunnel: mockStartTunnel,
        }),
    },
}));

// Mock promptForLocalPort
const mockPromptForLocalPort = jest.fn();
jest.mock('../promptForLocalPort', () => ({
    promptForLocalPort: (...args: unknown[]) => mockPromptForLocalPort(...args),
}));

describe('KubernetesServiceItem', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockHasCredentials.mockReturnValue(true);
        mockGetClient.mockResolvedValue({
            listDatabases: jest.fn().mockResolvedValue([{ name: 'appdb' }]),
        });
    });

    it('expands to database nodes instead of metadata detail rows', async () => {
        const item = new KubernetesServiceItem(
            'corr-1',
            {
                name: 'kind-documentdb-dev',
                cluster: 'kind-documentdb-dev',
                user: 'kind-documentdb-dev',
                server: 'https://127.0.0.1:6443',
            },
            {
                sourceKind: 'dko',
                name: 'documentdb-service-kind-documentdb',
                displayName: 'kind-documentdb',
                serviceName: 'documentdb-service-kind-documentdb',
                namespace: 'documentdb-ns',
                type: 'LoadBalancer',
                port: 10260,
                externalAddress: '127.0.0.1',
                connectionParams: 'directConnection=true',
            },
            'discoveryView/kubernetes-discovery/documentdb-ns',
        );

        const treeItem = item.getTreeItem();
        expect(treeItem.collapsibleState).toBe(1);
        expect(treeItem.contextValue).toContain('treeItem_documentdbcluster');
        expect(treeItem.contextValue).toContain('documentdbTargetLeaf');
        expect(treeItem.contextValue).toContain('discovery.kubernetesService');

        const children = await item.getChildren();
        expect(children).toHaveLength(1);
        expect(children[0].id).toBe(`${item.id}/appdb`);

        const databaseTreeItem = await children[0].getTreeItem();
        expect(databaseTreeItem.label).toBe('appdb');
        expect(databaseTreeItem.collapsibleState).toBe(1);
    });

    describe('ClusterIP port-forward', () => {
        const mockKubeConfig = { name: 'mock-kc' };
        const mockCoreApi = { name: 'mock-api' };

        beforeEach(() => {
            mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
            mockCreateCoreApi.mockResolvedValue(mockCoreApi);
            mockResolveDocumentDBCredentials.mockResolvedValue(undefined);
            mockStartTunnel.mockResolvedValue({ outcome: 'started' });
        });

        it('should start a port-forward tunnel for ClusterIP services', async () => {
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'needsPortForward',
                serviceName: 'my-svc',
                namespace: 'default',
                remotePort: 10260,
                suggestedLocalPort: 10260,
            });
            mockPromptForLocalPort.mockResolvedValue(10260);
            mockBuildPortForwardConnectionString.mockReturnValue('mongodb://127.0.0.1:10260/');

            const item = new KubernetesServiceItem(
                'corr-pf',
                {
                    name: 'my-ctx',
                    cluster: 'my-cluster',
                    user: 'my-user',
                    server: 'https://api.example.com:6443',
                },
                {
                    sourceKind: 'dko',
                    name: 'my-svc',
                    displayName: 'My Service',
                    serviceName: 'my-svc',
                    namespace: 'default',
                    type: 'ClusterIP',
                    port: 10260,
                    clusterIP: '10.0.0.1',
                },
                'discoveryView/kubernetes-discovery/default',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.connectionString).toBe('mongodb://127.0.0.1:10260/');
            expect(creds?.connectionProperties?.[KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]).toEqual({
                kind: 'kubernetesClusterIpPortForward',
                contextName: 'my-ctx',
                namespace: 'default',
                serviceName: 'my-svc',
                servicePort: 10260,
                localPort: 10260,
            });

            expect(mockStartTunnel).toHaveBeenCalledWith({
                kubeConfig: mockKubeConfig,
                coreApi: mockCoreApi,
                contextName: 'my-ctx',
                namespace: 'default',
                serviceName: 'my-svc',
                servicePort: 10260,
                localPort: 10260,
            });
        });

        it('should return undefined when user cancels port prompt', async () => {
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'needsPortForward',
                serviceName: 'my-svc',
                namespace: 'default',
                remotePort: 10260,
                suggestedLocalPort: 10260,
            });
            mockPromptForLocalPort.mockResolvedValue(undefined); // user cancels

            const item = new KubernetesServiceItem(
                'corr-cancel',
                {
                    name: 'my-ctx',
                    cluster: 'my-cluster',
                    user: 'my-user',
                    server: 'https://api.example.com:6443',
                },
                {
                    sourceKind: 'dko',
                    name: 'my-svc',
                    displayName: 'My Service',
                    serviceName: 'my-svc',
                    namespace: 'default',
                    type: 'ClusterIP',
                    port: 10260,
                    clusterIP: '10.0.0.1',
                },
                'discoveryView/kubernetes-discovery/default',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeUndefined();
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('should not start tunnel for LoadBalancer services', async () => {
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'ready',
                connectionString: 'mongodb://1.2.3.4:10260/',
            });

            const item = new KubernetesServiceItem(
                'corr-lb',
                {
                    name: 'my-ctx',
                    cluster: 'my-cluster',
                    user: 'my-user',
                    server: 'https://api.example.com:6443',
                },
                {
                    sourceKind: 'dko',
                    name: 'my-svc',
                    displayName: 'My Service',
                    serviceName: 'my-svc',
                    namespace: 'default',
                    type: 'LoadBalancer',
                    port: 10260,
                    externalAddress: '1.2.3.4',
                },
                'discoveryView/kubernetes-discovery/default',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.connectionString).toBe('mongodb://1.2.3.4:10260/');
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('should return undefined for unreachable services', async () => {
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'unreachable',
                reason: 'Not reachable',
            });

            const item = new KubernetesServiceItem(
                'corr-ur',
                {
                    name: 'my-ctx',
                    cluster: 'my-cluster',
                    user: 'my-user',
                    server: 'https://api.example.com:6443',
                },
                {
                    sourceKind: 'generic',
                    name: 'unreachable-svc',
                    displayName: 'Unreachable',
                    serviceName: 'unreachable-svc',
                    namespace: 'ns',
                    type: 'ExternalName',
                    port: 27017,
                },
                'discoveryView/kubernetes-discovery/ns',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeUndefined();
            expect(mockStartTunnel).not.toHaveBeenCalled();
        });

        it('should include resolved DKO credentials with port-forward', async () => {
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'needsPortForward',
                serviceName: 'dko-svc',
                namespace: 'prod',
                remotePort: 10260,
                suggestedLocalPort: 10260,
            });
            mockPromptForLocalPort.mockResolvedValue(55555);
            mockBuildPortForwardConnectionString.mockReturnValue('mongodb://127.0.0.1:55555/');
            mockResolveDocumentDBCredentials.mockResolvedValue({
                username: 'admin',
                password: 'secret123',
                connectionParams: 'directConnection=true',
            });

            const item = new KubernetesServiceItem(
                'corr-dko',
                {
                    name: 'aks-ctx',
                    cluster: 'aks-cluster',
                    user: 'aks-user',
                    server: 'https://aks.eastus.azmk8s.io:443',
                },
                {
                    sourceKind: 'dko',
                    name: 'dko-svc',
                    displayName: 'DKO Service',
                    serviceName: 'dko-svc',
                    namespace: 'prod',
                    type: 'ClusterIP',
                    port: 10260,
                    clusterIP: '10.0.1.5',
                },
                'discoveryView/kubernetes-discovery/prod',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.connectionString).toBe('mongodb://127.0.0.1:55555/');
            expect(creds?.nativeAuthConfig?.connectionUser).toBe('admin');
            expect(creds?.nativeAuthConfig?.connectionPassword).toBe('secret123');

            expect(mockStartTunnel).toHaveBeenCalledWith(
                expect.objectContaining({
                    contextName: 'aks-ctx',
                    namespace: 'prod',
                    serviceName: 'dko-svc',
                    localPort: 55555,
                }),
            );
        });
    });

    // -------------------------------------------------------------------------
    // credential-secret-resolution – generic service path (issue 1)
    // -------------------------------------------------------------------------
    describe('generic service credential resolution', () => {
        const mockKubeConfig = { name: 'mock-kc' };
        const mockCoreApi = { name: 'mock-api' };

        beforeEach(() => {
            mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
            mockCreateCoreApi.mockResolvedValue(mockCoreApi);
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'ready',
                connectionString: 'mongodb://10.0.0.5:27017/',
            });
        });

        it('should resolve credentials from annotation credentialSecretName for generic services', async () => {
            mockResolveDocumentDBCredentials.mockResolvedValue(undefined);
            mockResolveGenericServiceCredentials.mockResolvedValue({
                username: 'genericuser',
                password: 'genericpass',
            });

            const item = new KubernetesServiceItem(
                'corr-gen-cred',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'generic',
                    name: 'my-docdb',
                    displayName: 'My DocumentDB',
                    serviceName: 'my-docdb',
                    namespace: 'prod',
                    type: 'LoadBalancer',
                    port: 27017,
                    externalAddress: '10.0.0.5',
                    credentialSecretName: 'my-db-secret',
                },
                'discoveryView/kubernetes-discovery/prod',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.connectionString).toBe('mongodb://10.0.0.5:27017/');
            expect(creds?.nativeAuthConfig?.connectionUser).toBe('genericuser');
            expect(creds?.nativeAuthConfig?.connectionPassword).toBe('genericpass');
            expect(mockResolveGenericServiceCredentials).toHaveBeenCalledWith(mockCoreApi, 'prod', 'my-db-secret');
        });

        it('should not call resolveGenericServiceCredentials when DKO credentials resolve', async () => {
            mockResolveDocumentDBCredentials.mockResolvedValue({
                username: 'dkoadmin',
                password: 'dkopass',
                connectionParams: '',
            });

            const item = new KubernetesServiceItem(
                'corr-dko-wins',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'dko',
                    name: 'documentdb-service-mydb',
                    displayName: 'MyDB',
                    serviceName: 'documentdb-service-mydb',
                    namespace: 'prod',
                    type: 'LoadBalancer',
                    port: 10260,
                    externalAddress: '10.0.0.5',
                },
                'discoveryView/kubernetes-discovery/prod',
            );

            const creds = await item.getCredentials();
            expect(creds?.nativeAuthConfig?.connectionUser).toBe('dkoadmin');
            expect(mockResolveGenericServiceCredentials).not.toHaveBeenCalled();
        });

        it('should not call resolveGenericServiceCredentials when service has no credentialSecretName', async () => {
            mockResolveDocumentDBCredentials.mockResolvedValue(undefined);

            const item = new KubernetesServiceItem(
                'corr-no-cred',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'generic',
                    name: 'my-docdb',
                    displayName: 'My DocumentDB',
                    serviceName: 'my-docdb',
                    namespace: 'prod',
                    type: 'LoadBalancer',
                    port: 27017,
                    externalAddress: '10.0.0.5',
                    // no credentialSecretName
                },
                'discoveryView/kubernetes-discovery/prod',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.nativeAuthConfig).toBeUndefined();
            expect(mockResolveGenericServiceCredentials).not.toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // nodeport-loadbalancer-safety – warning surfacing (issue 2)
    // -------------------------------------------------------------------------
    describe('endpoint warning surfacing', () => {
        const mockKubeConfig = { name: 'mock-kc' };
        const mockCoreApi = { name: 'mock-api' };

        beforeEach(() => {
            mockLoadConfiguredKubeConfig.mockResolvedValue(mockKubeConfig);
            mockCreateCoreApi.mockResolvedValue(mockCoreApi);
            mockResolveDocumentDBCredentials.mockResolvedValue(undefined);
            mockResolveGenericServiceCredentials.mockResolvedValue(undefined);
        });

        it('should write the warning to the output channel for ready endpoint with InternalIP', async () => {
            const warningText =
                'Using node InternalIP for NodePort service — this address may not be reachable outside the cluster.';
            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'ready',
                connectionString: 'mongodb://10.0.0.1:30017/',
                warning: warningText,
            });

            const item = new KubernetesServiceItem(
                'corr-warn',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'generic',
                    name: 'my-np-svc',
                    displayName: 'NodePort Svc',
                    serviceName: 'my-np-svc',
                    namespace: 'default',
                    type: 'NodePort',
                    port: 27017,
                    nodePort: 30017,
                },
                'discoveryView/kubernetes-discovery/default',
            );

            const creds = await item.getCredentials();
            expect(creds).toBeDefined();
            expect(creds?.connectionString).toBe('mongodb://10.0.0.1:30017/');

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { ext } = require('../../../extensionVariables') as {
                ext: { outputChannel: { appendLine: jest.Mock } };
            };
            expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(warningText);
        });

        it('should set endpointWarning telemetry property for ready endpoint with warning', async () => {
            const capturedProperties: Record<string, string> = {};
            // Access the jest.fn() spy created in the module mock factory.
            // jest.requireMock returns `any`, so we access properties directly.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const mockFn = jest.requireMock('@microsoft/vscode-azext-utils').callWithTelemetryAndErrorHandling;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            mockFn.mockImplementationOnce(
                async (_eventName: string, callback: (ctx: unknown) => Promise<unknown>) =>
                    await callback({
                        telemetry: { properties: capturedProperties, measurements: {} },
                        errorHandling: {},
                        valuesToMask: [],
                    }),
            );

            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'ready',
                connectionString: 'mongodb://10.0.0.1:30017/',
                warning: 'InternalIP fallback warning',
            });

            const item = new KubernetesServiceItem(
                'corr-warn-telem',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'generic',
                    name: 'np-svc',
                    displayName: 'np-svc',
                    serviceName: 'np-svc',
                    namespace: 'default',
                    type: 'NodePort',
                    port: 27017,
                    nodePort: 30017,
                },
                'parent',
            );

            await item.getCredentials();
            expect(capturedProperties['endpointWarning']).toBe('internalIpMayBeUnreachable');
        });

        it('should not set endpointWarning for ready endpoint without warning', async () => {
            const capturedProperties: Record<string, string> = {};
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const mockFn = jest.requireMock('@microsoft/vscode-azext-utils').callWithTelemetryAndErrorHandling;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            mockFn.mockImplementationOnce(
                async (_eventName: string, callback: (ctx: unknown) => Promise<unknown>) =>
                    await callback({
                        telemetry: { properties: capturedProperties, measurements: {} },
                        errorHandling: {},
                        valuesToMask: [],
                    }),
            );

            mockResolveServiceEndpoint.mockResolvedValue({
                kind: 'ready',
                connectionString: 'mongodb://1.2.3.4:10260/',
                // no warning
            });

            const item = new KubernetesServiceItem(
                'corr-no-warn',
                { name: 'my-ctx', cluster: 'my-cluster', user: 'my-user', server: 'https://api.example.com:6443' },
                {
                    sourceKind: 'dko',
                    name: 'lb-svc',
                    displayName: 'lb-svc',
                    serviceName: 'lb-svc',
                    namespace: 'default',
                    type: 'LoadBalancer',
                    port: 10260,
                    externalAddress: '1.2.3.4',
                },
                'parent',
            );

            await item.getCredentials();
            expect(capturedProperties['endpointWarning']).toBeUndefined();
        });
    });
});
