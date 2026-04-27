/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CREDENTIAL_SECRET_ANNOTATION,
    CUSTOM_KUBECONFIG_PATH_KEY,
    DISCOVERY_ANNOTATION,
    DOCUMENTDB_PORTS,
    KUBECONFIG_SOURCE_KEY,
} from './config';
import {
    getContexts,
    inferClusterProvider,
    isValidKubernetesSecretName,
    type KubeServiceEndpoint,
    type KubeServiceInfo,
} from './kubernetesClient';

// Mock @kubernetes/client-node
const mockLoadFromFile = jest.fn();
const mockLoadFromString = jest.fn();
const mockGetContexts = jest.fn();
const mockGetCluster = jest.fn();
const mockGetClusters = jest.fn();
const mockGetUsers = jest.fn();
const mockGetCurrentContext = jest.fn();
const mockSetCurrentContext = jest.fn();
const mockMakeApiClient = jest.fn();

const mockLoadFromDefault = jest.fn();
const mockGlobalStateGet = jest.fn((_key: string, defaultValue?: unknown) => defaultValue);
const mockSecretGet = jest.fn();

jest.mock('../../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: (key: string, defaultValue?: unknown) => mockGlobalStateGet(key, defaultValue),
            },
        },
        secretStorage: {
            get: (key: string) => mockSecretGet(key),
        },
    },
}));

jest.mock('@kubernetes/client-node', () => ({
    KubeConfig: jest.fn().mockImplementation(() => ({
        loadFromFile: mockLoadFromFile,
        loadFromString: mockLoadFromString,
        loadFromDefault: mockLoadFromDefault,
        getContexts: mockGetContexts,
        getCluster: mockGetCluster,
        getClusters: mockGetClusters,
        getUsers: mockGetUsers,
        getCurrentContext: mockGetCurrentContext,
        setCurrentContext: mockSetCurrentContext,
        makeApiClient: mockMakeApiClient,
    })),
    CoreV1Api: jest.fn(),
    CustomObjectsApi: jest.fn(),
}));

function createServiceInfo(overrides: Partial<KubeServiceInfo>): KubeServiceInfo {
    const serviceName = overrides.serviceName ?? overrides.name ?? 'documentdb-service-sample';
    return {
        sourceKind: 'generic',
        name: serviceName,
        displayName: serviceName,
        serviceName,
        namespace: 'default',
        type: 'LoadBalancer',
        port: 10260,
        ...overrides,
    };
}

describe('kubernetesClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlobalStateGet.mockImplementation((_key: string, defaultValue?: unknown) => defaultValue);
        mockGetContexts.mockReturnValue([{ name: 'ctx', cluster: 'cluster', user: 'user' }]);
        mockGetClusters.mockReturnValue([{ name: 'cluster', server: 'https://cluster.example.com' }]);
        mockGetUsers.mockReturnValue([{ name: 'user' }]);
        mockGetCurrentContext.mockReturnValue('ctx');
    });

    describe('config', () => {
        it('should define standard DocumentDB ports', () => {
            expect(DOCUMENTDB_PORTS).toEqual([27017, 27018, 27019, 10260]);
        });
    });

    describe('loadKubeConfig', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadKubeConfig } = require('./kubernetesClient');

        it('should load kubeconfig from default path', async () => {
            mockLoadFromDefault.mockImplementation(() => {
                /* success */
            });

            const result = await loadKubeConfig();
            expect(result).toBeDefined();
            expect(mockLoadFromDefault).toHaveBeenCalledTimes(1);
            expect(mockLoadFromFile).not.toHaveBeenCalled();
        });

        it('should load kubeconfig from custom path', async () => {
            mockLoadFromFile.mockImplementation(() => {
                /* success */
            });

            const result = await loadKubeConfig('/custom/path/config');
            expect(result).toBeDefined();
            expect(mockLoadFromFile).toHaveBeenCalledWith('/custom/path/config');
        });

        it('should load kubeconfig from pasted YAML', async () => {
            mockLoadFromString.mockImplementation(() => {
                /* success */
            });

            const result = await loadKubeConfig(undefined, 'apiVersion: v1');
            expect(result).toBeDefined();
            expect(mockLoadFromString).toHaveBeenCalledWith('apiVersion: v1');
            expect(mockLoadFromDefault).not.toHaveBeenCalled();
            expect(mockLoadFromFile).not.toHaveBeenCalled();
        });

        it('should throw descriptive error when kubeconfig not found (default)', async () => {
            mockLoadFromDefault.mockImplementation(() => {
                throw new Error('ENOENT: no such file or directory');
            });

            await expect(loadKubeConfig()).rejects.toThrow(/Failed to load kubeconfig/);
        });

        it('should throw descriptive error when kubeconfig file not found (custom path)', async () => {
            mockLoadFromFile.mockImplementation(() => {
                throw new Error('ENOENT: no such file or directory');
            });

            await expect(loadKubeConfig('/nonexistent/path')).rejects.toThrow(/Failed to load kubeconfig/);
        });

        it('should throw descriptive error for malformed kubeconfig', async () => {
            mockLoadFromDefault.mockImplementation(() => {
                throw new Error('invalid YAML');
            });

            await expect(loadKubeConfig()).rejects.toThrow(/Failed to load kubeconfig/);
        });

        it('should throw descriptive error for malformed pasted kubeconfig YAML', async () => {
            mockLoadFromString.mockImplementation(() => {
                throw new Error('invalid YAML');
            });

            await expect(loadKubeConfig(undefined, 'not: valid: yaml')).rejects.toThrow(
                /Failed to load kubeconfig from pasted YAML/,
            );
        });

        it('should reject the synthetic default localhost context when no kubeconfig exists', async () => {
            mockLoadFromDefault.mockImplementation(() => {
                /* success with synthesized client-node fallback */
            });
            mockGetContexts.mockReturnValue([{ name: 'loaded-context', cluster: 'cluster', user: 'user' }]);
            mockGetClusters.mockReturnValue([{ name: 'cluster', server: 'http://localhost:8080' }]);
            mockGetUsers.mockReturnValue([{ name: 'user' }]);
            mockGetCurrentContext.mockReturnValue('loaded-context');

            await expect(loadKubeConfig()).rejects.toThrow(/No Kubernetes kubeconfig was found/);
        });

        it('should allow explicit custom kubeconfig files that use localhost', async () => {
            mockLoadFromFile.mockImplementation(() => {
                /* success */
            });
            mockGetContexts.mockReturnValue([{ name: 'loaded-context', cluster: 'cluster', user: 'user' }]);
            mockGetClusters.mockReturnValue([{ name: 'cluster', server: 'http://localhost:8080' }]);
            mockGetUsers.mockReturnValue([{ name: 'user' }]);
            mockGetCurrentContext.mockReturnValue('loaded-context');

            const result = await loadKubeConfig('/custom/path/config');
            expect(result).toBeDefined();
            expect(mockLoadFromFile).toHaveBeenCalledWith('/custom/path/config');
        });
    });

    describe('loadConfiguredKubeConfig', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadConfiguredKubeConfig } = require('./kubernetesClient');

        it('should load the default kubeconfig when default source is configured', async () => {
            mockLoadFromDefault.mockImplementation(() => {
                /* success */
            });

            const result = await loadConfiguredKubeConfig();
            expect(result).toBeDefined();
            expect(mockLoadFromDefault).toHaveBeenCalledTimes(1);
        });

        it('should load the configured custom kubeconfig file', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) {
                    return 'customFile';
                }

                if (key === CUSTOM_KUBECONFIG_PATH_KEY) {
                    return '/custom/path/config';
                }

                return defaultValue;
            });
            mockLoadFromFile.mockImplementation(() => {
                /* success */
            });

            const result = await loadConfiguredKubeConfig();
            expect(result).toBeDefined();
            expect(mockLoadFromFile).toHaveBeenCalledWith('/custom/path/config');
        });

        it('should load stored inline kubeconfig YAML from secure storage', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) {
                    return 'inline';
                }

                return defaultValue;
            });
            mockSecretGet.mockResolvedValue('apiVersion: v1');
            mockLoadFromString.mockImplementation(() => {
                /* success */
            });

            const result = await loadConfiguredKubeConfig();
            expect(result).toBeDefined();
            expect(mockSecretGet).toHaveBeenCalledTimes(1);
            expect(mockLoadFromString).toHaveBeenCalledWith('apiVersion: v1');
        });

        it('should fail when custom-file source is configured without a path', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) {
                    return 'customFile';
                }

                return defaultValue;
            });

            await expect(loadConfiguredKubeConfig()).rejects.toThrow(/No custom kubeconfig file is configured/);
        });

        it('should fail when inline source is configured without stored YAML', async () => {
            mockGlobalStateGet.mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === KUBECONFIG_SOURCE_KEY) {
                    return 'inline';
                }

                return defaultValue;
            });
            mockSecretGet.mockResolvedValue(undefined);

            await expect(loadConfiguredKubeConfig()).rejects.toThrow(/No pasted kubeconfig YAML is stored/);
        });
    });

    describe('getContexts', () => {
        it('should return context info from kubeconfig', () => {
            const mockKubeConfig = {
                getContexts: jest.fn().mockReturnValue([
                    { name: 'ctx-1', cluster: 'cluster-1', user: 'user-1' },
                    { name: 'ctx-2', cluster: 'cluster-2', user: 'user-2' },
                ]),
                getCluster: jest.fn().mockImplementation((name: string) => {
                    if (name === 'cluster-1') return { server: 'https://k8s-1.example.com' };
                    if (name === 'cluster-2') return { server: 'https://k8s-2.example.com' };
                    return null;
                }),
            };

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            const contexts = getContexts(mockKubeConfig as any);

            expect(contexts).toHaveLength(2);
            expect(contexts[0]).toEqual({
                name: 'ctx-1',
                cluster: 'cluster-1',
                user: 'user-1',
                server: 'https://k8s-1.example.com',
            });
        });

        it('should handle missing cluster server gracefully', () => {
            const mockKubeConfig = {
                getContexts: jest.fn().mockReturnValue([{ name: 'ctx-1', cluster: 'unknown-cluster', user: 'user-1' }]),
                getCluster: jest.fn().mockReturnValue(null),
            };

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            const contexts = getContexts(mockKubeConfig as any);

            expect(contexts).toHaveLength(1);
            expect(contexts[0].server).toBe('');
        });
    });

    describe('listDocumentDBServices', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listDocumentDBServices } = require('./kubernetesClient');

        it('should return DKO targets first and then generic DocumentDB fallback targets', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'documentdb-service-mydb', namespace: 'default' },
                            spec: {
                                type: 'LoadBalancer',
                                clusterIP: '10.0.0.1',
                                ports: [{ port: 10260, targetPort: 10260 }],
                            },
                            status: {
                                loadBalancer: {
                                    ingress: [{ hostname: 'mydb.example.com' }],
                                },
                            },
                        },
                        {
                            metadata: { name: 'manual-documentdb', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                clusterIP: '10.0.0.2',
                                ports: [{ port: 10260, targetPort: 10260 }],
                            },
                        },
                        {
                            metadata: { name: 'nginx' },
                            spec: { type: 'ClusterIP', ports: [{ port: 80 }] },
                        },
                    ],
                }),
            };
            const mockKubeConfig = {
                makeApiClient: jest.fn().mockReturnValue({
                    listNamespacedCustomObject: jest.fn().mockResolvedValue({
                        items: [
                            {
                                metadata: { name: 'mydb' },
                                spec: {},
                                status: {
                                    status: 'Cluster in healthy state',
                                    tls: { ready: true },
                                },
                            },
                        ],
                    }),
                }),
            };

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default', mockKubeConfig);

            expect(services).toHaveLength(2);
            expect(services[0]).toMatchObject({
                sourceKind: 'dko',
                displayName: 'mydb',
                serviceName: 'documentdb-service-mydb',
                secretName: 'documentdb-credentials',
                status: 'Cluster in healthy state',
                tlsReady: true,
                externalAddress: 'mydb.example.com',
                connectionParams: expect.stringContaining('tlsAllowInvalidCertificates=true'),
            });
            expect(services[1]).toMatchObject({
                sourceKind: 'generic',
                name: 'manual-documentdb',
                serviceName: 'manual-documentdb',
                clusterIP: '10.0.0.2',
            });
        });

        it('should fall back to generic DocumentDB discovery when the DKO CRD is unavailable', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'manual-documentdb', namespace: 'default' },
                            spec: {
                                type: 'LoadBalancer',
                                ports: [{ port: 10260, targetPort: 10260 }],
                            },
                            status: {
                                loadBalancer: {
                                    ingress: [{ ip: '1.2.3.4' }],
                                },
                            },
                        },
                    ],
                }),
            };
            const mockKubeConfig = {
                makeApiClient: jest.fn().mockReturnValue({
                    listNamespacedCustomObject: jest.fn().mockRejectedValue(new Error('Forbidden')),
                }),
            };

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default', mockKubeConfig);
            expect(services).toHaveLength(1);
            expect(services[0].externalAddress).toBe('1.2.3.4');
            expect(services[0].sourceKind).toBe('generic');
            expect(services[0].type).toBe('LoadBalancer');
        });

        it('should throw on RBAC error', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockRejectedValue(new Error('Forbidden')),
            };

            await expect(listDocumentDBServices(mockCoreApi, 'default')).rejects.toThrow(/Failed to list services/);
        });
    });

    describe('resolveServiceEndpoint', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveServiceEndpoint } = require('./kubernetesClient');

        it('should resolve LoadBalancer with external IP', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
            }
        });

        it('should return unreachable for LoadBalancer without external IP and no nodePort', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('pending');
            if (endpoint.kind === 'pending') {
                expect(endpoint.reason).toContain('not yet assigned');
            }
        });

        it('should fall back to NodePort for LoadBalancer without external IP', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
                nodePort: 30192,
            });

            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [
                        {
                            status: {
                                addresses: [{ type: 'InternalIP', address: '172.18.0.2' }],
                            },
                        },
                    ],
                }),
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://172.18.0.2:30192/');
            }
        });

        it('should resolve NodePort with node address', async () => {
            const service = createServiceInfo({
                name: 'mongo-np',
                displayName: 'mongo-np',
                serviceName: 'mongo-np',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                nodePort: 30017,
            });

            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [
                        {
                            status: {
                                addresses: [{ type: 'InternalIP', address: '192.168.1.10' }],
                            },
                        },
                    ],
                }),
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://192.168.1.10:30017/');
            }
        });

        it('should return an explicit port-forward requirement for ClusterIP services', async () => {
            const service = createServiceInfo({
                name: 'mongo-cip',
                displayName: 'mongo-cip',
                serviceName: 'mongo-cip',
                namespace: 'default',
                type: 'ClusterIP',
                port: 27017,
                clusterIP: '10.0.0.1',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('needsPortForward');
            if (endpoint.kind === 'needsPortForward') {
                expect(endpoint.serviceName).toBe('mongo-cip');
                expect(endpoint.namespace).toBe('default');
                expect(endpoint.remotePort).toBe(27017);
                expect(endpoint.suggestedLocalPort).toBe(27017);
            }
        });

        it('should return unreachable for ExternalName service', async () => {
            const service = createServiceInfo({
                name: 'mongo-ext',
                displayName: 'mongo-ext',
                serviceName: 'mongo-ext',
                namespace: 'default',
                type: 'ExternalName',
                port: 27017,
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('unreachable');
            if (endpoint.kind === 'unreachable') {
                expect(endpoint.reason).toContain('ExternalName');
            }
        });

        it('should return unreachable for unknown/unsupported service type', async () => {
            const service = createServiceInfo({
                name: 'mongo-headless',
                displayName: 'mongo-headless',
                serviceName: 'mongo-headless',
                namespace: 'default',
                type: 'Headless',
                port: 27017,
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('unreachable');
            if (endpoint.kind === 'unreachable') {
                expect(endpoint.reason).toContain('Headless');
            }
        });

        it('should return unreachable for NodePort without nodePort assigned', async () => {
            const service = createServiceInfo({
                name: 'mongo-np-noport',
                displayName: 'mongo-np-noport',
                serviceName: 'mongo-np-noport',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                // nodePort intentionally omitted
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('unreachable');
            if (endpoint.kind === 'unreachable') {
                expect(endpoint.reason).toContain('node address');
            }
        });

        it('should return unreachable for NodePort when no nodes are available', async () => {
            const service = createServiceInfo({
                name: 'mongo-np-nonodes',
                displayName: 'mongo-np-nonodes',
                serviceName: 'mongo-np-nonodes',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                nodePort: 30017,
            });

            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [],
                }),
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('unreachable');
            if (endpoint.kind === 'unreachable') {
                expect(endpoint.reason).toContain('node address');
            }
        });
    });

    describe('listNamespaces', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listNamespaces } = require('./kubernetesClient');

        it('should return sorted namespace names', async () => {
            const mockCoreApi = {
                listNamespace: jest.fn().mockResolvedValue({
                    items: [
                        { metadata: { name: 'staging' } },
                        { metadata: { name: 'default' } },
                        { metadata: { name: 'production' } },
                    ],
                }),
            };

            const namespaces: string[] = await listNamespaces(mockCoreApi);
            expect(namespaces).toEqual(['default', 'production', 'staging']);
        });

        it('should throw on RBAC denied', async () => {
            const mockCoreApi = {
                listNamespace: jest.fn().mockRejectedValue(new Error('Forbidden')),
            };

            await expect(listNamespaces(mockCoreApi)).rejects.toThrow(/Failed to list namespaces/);
        });
    });

    describe('buildConnectionString (via resolveServiceEndpoint)', () => {
        // buildConnectionString is private — tested indirectly through resolveServiceEndpoint.
        // LoadBalancer with external IP is the simplest path to exercise it.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveServiceEndpoint } = require('./kubernetesClient');

        it('should include allowed connection parameters in the connection string', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'directConnection=true&tls=true',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/?directConnection=true&tls=true');
            }
        });

        it('should strip disallowed connection parameters', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'foo=bar&password=leaked',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
                expect(endpoint.connectionString).not.toContain('foo');
                expect(endpoint.connectionString).not.toContain('password');
                expect(endpoint.connectionString).not.toContain('leaked');
            }
        });

        it('should keep only valid parameters from a mix of valid and invalid', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'tls=true&evil=inject&replicaSet=rs0&password=secret',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toContain('tls=true');
                expect(endpoint.connectionString).toContain('replicaSet=rs0');
                expect(endpoint.connectionString).not.toContain('evil');
                expect(endpoint.connectionString).not.toContain('password');
                expect(endpoint.connectionString).not.toContain('secret');
            }
        });

        it('should not append ? suffix when connectionParams is empty', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: '',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
                expect(endpoint.connectionString).not.toContain('?');
            }
        });

        it('should not append ? suffix when connectionParams contains only invalid keys', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'badKey=badValue&anotherBad=true',
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
                expect(endpoint.connectionString).not.toContain('?');
            }
        });

        it('should pass through all recognized allowed parameters', async () => {
            const allAllowed = [
                'tls=true',
                'tlsAllowInvalidCertificates=true',
                'replicaSet=rs0',
                'authSource=admin',
                'authMechanism=SCRAM-SHA-256',
                'directConnection=true',
                'retryWrites=true',
                'w=majority',
                'readPreference=secondary',
            ].join('&');

            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '10.0.0.1',
                connectionParams: allAllowed,
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                const url = endpoint.connectionString;
                expect(url).toContain('tls=true');
                expect(url).toContain('tlsAllowInvalidCertificates=true');
                expect(url).toContain('replicaSet=rs0');
                expect(url).toContain('authSource=admin');
                expect(url).toContain('authMechanism=SCRAM-SHA-256');
                expect(url).toContain('directConnection=true');
                expect(url).toContain('retryWrites=true');
                expect(url).toContain('w=majority');
                expect(url).toContain('readPreference=secondary');
            }
        });

        it('should not include connectionParams when service has no connectionParams set', async () => {
            const service = createServiceInfo({
                name: 'mongo-lb',
                displayName: 'mongo-lb',
                serviceName: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                // connectionParams intentionally omitted (undefined)
            });

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
                expect(endpoint.connectionString).not.toContain('?');
            }
        });
    });

    describe('resolveDocumentDBCredentials', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveDocumentDBCredentials } = require('./kubernetesClient');

        const createMockKubeConfig = (customApiMock: Record<string, jest.Mock>) => ({
            makeApiClient: jest.fn().mockReturnValue(customApiMock),
        });

        it('should return credentials when matching CR and secret are found', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mydb' },
                            spec: { documentDbCredentialSecret: 'my-secret' },
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        username: Buffer.from('admin').toString('base64'),
                        password: Buffer.from('s3cret!').toString('base64'),
                    },
                }),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeDefined();
            expect(result!.username).toBe('admin');
            expect(result!.password).toBe('s3cret!');
            expect(result!.connectionParams).toContain('directConnection=true');
            expect(mockCoreApi.readNamespacedSecret).toHaveBeenCalledWith({
                name: 'my-secret',
                namespace: 'default',
            });
        });

        it('should return undefined when no CRs exist (empty items)', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn(),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeUndefined();
            expect(mockCoreApi.readNamespacedSecret).not.toHaveBeenCalled();
        });

        it('should return undefined when no CR matches the service name', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'otherdb' },
                            spec: {},
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn(),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeUndefined();
            expect(mockCoreApi.readNamespacedSecret).not.toHaveBeenCalled();
        });

        it('should return undefined when secret does not have username/password fields', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mydb' },
                            spec: { documentDbCredentialSecret: 'my-secret' },
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        token: Buffer.from('some-token').toString('base64'),
                    },
                }),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeUndefined();
        });

        it('should return undefined when CRD API call fails (RBAC or CRD not installed)', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockRejectedValue(new Error('Forbidden')),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn(),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeUndefined();
            expect(mockCoreApi.readNamespacedSecret).not.toHaveBeenCalled();
        });

        it('should return undefined when secret read fails', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mydb' },
                            spec: { documentDbCredentialSecret: 'missing-secret' },
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockRejectedValue(new Error('Not Found')),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeUndefined();
        });

        it('should correctly base64-decode username and password', async () => {
            const rawUsername = 'docdb-admin@cluster';
            const rawPassword = 'p@$$w0rd/with+special=chars';

            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mydb' },
                            spec: {},
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        username: Buffer.from(rawUsername).toString('base64'),
                        password: Buffer.from(rawPassword).toString('base64'),
                    },
                }),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeDefined();
            expect(result!.username).toBe(rawUsername);
            expect(result!.password).toBe(rawPassword);
        });

        it('should use default secret name when CR does not specify one', async () => {
            const mockCustomApi = {
                listNamespacedCustomObject: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mydb' },
                            spec: {}, // no documentDbCredentialSecret
                        },
                    ],
                }),
            };
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        username: Buffer.from('user1').toString('base64'),
                        password: Buffer.from('pass1').toString('base64'),
                    },
                }),
            };
            const mockKubeConfig = createMockKubeConfig(mockCustomApi);

            const result = await resolveDocumentDBCredentials(
                mockCoreApi,
                mockKubeConfig,
                'default',
                'documentdb-service-mydb',
            );

            expect(result).toBeDefined();
            expect(mockCoreApi.readNamespacedSecret).toHaveBeenCalledWith({
                name: 'documentdb-credentials',
                namespace: 'default',
            });
        });
    });

    describe('buildPortForwardConnectionString', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { buildPortForwardConnectionString } = require('./kubernetesClient');

        it('should use 127.0.0.1 instead of localhost', () => {
            const service = createServiceInfo({
                name: 'svc',
                displayName: 'svc',
                serviceName: 'svc',
                namespace: 'default',
                type: 'ClusterIP',
                port: 27017,
            });

            const connStr: string = buildPortForwardConnectionString(service, 27017);
            expect(connStr).toBe('mongodb://127.0.0.1:27017/');
            expect(connStr).not.toContain('localhost');
        });

        it('should use the provided local port', () => {
            const service = createServiceInfo({
                name: 'svc',
                displayName: 'svc',
                serviceName: 'svc',
                namespace: 'default',
                type: 'ClusterIP',
                port: 10260,
            });

            const connStr: string = buildPortForwardConnectionString(service, 55555);
            expect(connStr).toBe('mongodb://127.0.0.1:55555/');
        });

        it('should include allowed connection params', () => {
            const service = createServiceInfo({
                name: 'svc',
                displayName: 'svc',
                serviceName: 'svc',
                namespace: 'default',
                type: 'ClusterIP',
                port: 10260,
                connectionParams: 'directConnection=true&tls=true',
            });

            const connStr: string = buildPortForwardConnectionString(service, 10260);
            expect(connStr).toContain('127.0.0.1:10260');
            expect(connStr).toContain('directConnection=true');
            expect(connStr).toContain('tls=true');
        });

        it('should strip disallowed connection params', () => {
            const service = createServiceInfo({
                name: 'svc',
                displayName: 'svc',
                serviceName: 'svc',
                namespace: 'default',
                type: 'ClusterIP',
                port: 10260,
                connectionParams: 'directConnection=true&password=leaked',
            });

            const connStr: string = buildPortForwardConnectionString(service, 10260);
            expect(connStr).toContain('directConnection=true');
            expect(connStr).not.toContain('password');
            expect(connStr).not.toContain('leaked');
        });
    });

    describe('inferClusterProvider', () => {
        it('should detect AKS from server URL with region', () => {
            const result = inferClusterProvider(
                'https://my-cluster-dns-abc123.hcp.eastus.azmk8s.io:443',
                'aks-prod',
                'aks-prod',
            );
            expect(result.provider).toBe('AKS');
            expect(result.region).toBe('eastus');
        });

        it('should detect AKS from server URL without hcp prefix', () => {
            const result = inferClusterProvider('https://my-cluster.westus2.azmk8s.io:443', 'ctx', 'cluster');
            expect(result.provider).toBe('AKS');
            expect(result.region).toBe('westus2');
        });

        it('should detect EKS from server URL', () => {
            const result = inferClusterProvider('https://ABC123.gr7.us-east-1.eks.amazonaws.com', 'ctx', 'cluster');
            expect(result.provider).toBe('EKS');
            expect(result.region).toBe('us-east-1');
        });

        it('should detect GKE from server URL', () => {
            const result = inferClusterProvider(
                'https://35.200.100.50',
                'gke_my-project_us-central1_my-cluster',
                'gke_my-project_us-central1_my-cluster',
            );
            // GKE IP-based server URL doesn't match, but name pattern doesn't either
            // GKE detection relies on googleapis.com or gke.io in the URL
            expect(result.provider).toBeUndefined();
        });

        it('should detect GKE from container.googleapis.com', () => {
            const result = inferClusterProvider(
                'https://container.googleapis.com/v1/projects/my-proj/locations/us-central1-a/clusters/my-cluster',
                'ctx',
                'cluster',
            );
            expect(result.provider).toBe('GKE');
        });

        it('should detect kind from context name prefix', () => {
            const result = inferClusterProvider('https://127.0.0.1:6443', 'kind-documentdb-dev', 'kind-documentdb-dev');
            expect(result.provider).toBe('kind');
        });

        it('should detect kind from cluster name prefix', () => {
            const result = inferClusterProvider('https://127.0.0.1:45678', 'my-ctx', 'kind-my-cluster');
            expect(result.provider).toBe('kind');
        });

        it('should detect minikube', () => {
            const result = inferClusterProvider('https://192.168.49.2:8443', 'minikube', 'minikube');
            expect(result.provider).toBe('minikube');
        });

        it('should detect k3s', () => {
            const result = inferClusterProvider('https://10.0.0.1:6443', 'k3s-default', 'k3s-cluster');
            expect(result.provider).toBe('k3s');
        });

        it('should detect Docker Desktop', () => {
            const result = inferClusterProvider(
                'https://kubernetes.docker.internal:6443',
                'docker-desktop',
                'docker-desktop',
            );
            expect(result.provider).toBe('Docker Desktop');
        });

        it('should return empty for unknown provider', () => {
            const result = inferClusterProvider('https://10.0.0.1:6443', 'my-cluster', 'my-cluster');
            expect(result.provider).toBeUndefined();
            expect(result.region).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // service-discovery-heuristics
    // -------------------------------------------------------------------------
    describe('listDocumentDBServices - service discovery heuristics', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listDocumentDBServices } = require('./kubernetesClient');

        it('should include an annotated service on a non-standard port', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: {
                                name: 'custom-docdb',
                                namespace: 'default',
                                annotations: { [DISCOVERY_ANNOTATION]: 'true' },
                            },
                            spec: {
                                type: 'ClusterIP',
                                clusterIP: '10.0.0.5',
                                ports: [{ port: 8888, targetPort: 8888 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('custom-docdb');
            expect(services[0].port).toBe(8888);
            expect(services[0].sourceKind).toBe('generic');
        });

        it('should include a service labelled for discovery on a non-standard port', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: {
                                name: 'labelled-docdb',
                                namespace: 'default',
                                labels: { [DISCOVERY_ANNOTATION]: 'true' },
                            },
                            spec: {
                                type: 'ClusterIP',
                                clusterIP: '10.0.0.6',
                                ports: [{ port: 9999, targetPort: 9999 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('labelled-docdb');
            expect(services[0].port).toBe(9999);
        });

        it('should include a service on port 27017 without opt-in annotation', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mongo-27017', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27017, targetPort: 27017 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('mongo-27017');
            expect(services[0].port).toBe(27017);
        });

        it('should preserve the service port name for generic remapped ClusterIP services', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'generic-docdb', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [
                                    { name: 'metrics', port: 9090, targetPort: 9090 },
                                    { name: 'documentdb', port: 27017, targetPort: 10260 },
                                ],
                            },
                        },
                    ],
                }),
            };

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0]).toMatchObject({
                sourceKind: 'generic',
                name: 'generic-docdb',
                port: 27017,
                portName: 'documentdb',
            });
        });

        it('should include a service on port 27018 without opt-in annotation', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mongo-27018', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27018, targetPort: 27018 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('mongo-27018');
        });

        it('should include a service on port 27019 without opt-in annotation', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mongo-27019', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27019, targetPort: 27019 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('mongo-27019');
        });

        it('should exclude an unrelated service on port 80 without opt-in', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'nginx', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 80, targetPort: 80 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(0);
        });

        it('should not duplicate a DKO-backed service through generic fallback even when port matches', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            // This is the DKO backing service — must not appear as generic too.
                            metadata: { name: 'documentdb-service-mydb', namespace: 'default' },
                            spec: {
                                type: 'LoadBalancer',
                                ports: [{ port: 10260, targetPort: 10260 }],
                            },
                        },
                    ],
                }),
            };
            const mockKubeConfig = {
                makeApiClient: jest.fn().mockReturnValue({
                    listNamespacedCustomObject: jest.fn().mockResolvedValue({
                        items: [{ metadata: { name: 'mydb' }, spec: {}, status: {} }],
                    }),
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default', mockKubeConfig);
            expect(services).toHaveLength(1);
            expect(services[0].sourceKind).toBe('dko');
        });

        it('should store credentialSecretName from annotation on a generic service', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: {
                                name: 'my-docdb',
                                namespace: 'prod',
                                annotations: {
                                    [DISCOVERY_ANNOTATION]: 'true',
                                    [CREDENTIAL_SECRET_ANNOTATION]: 'my-db-secret',
                                },
                            },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27017, targetPort: 27017 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'prod');
            expect(services).toHaveLength(1);
            expect(services[0].credentialSecretName).toBe('my-db-secret');
        });

        it('should not store credentialSecretName when the annotation value is not a valid Kubernetes name', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: {
                                name: 'my-docdb',
                                namespace: 'default',
                                annotations: {
                                    [DISCOVERY_ANNOTATION]: 'true',
                                    [CREDENTIAL_SECRET_ANNOTATION]: 'Invalid Name!',
                                },
                            },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27017 }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].credentialSecretName).toBeUndefined();
        });

        it('should exclude an annotated service whose only port is UDP', async () => {
            // UDP ports must be ignored; if no TCP port remains the service is excluded.
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: {
                                name: 'udp-only-svc',
                                namespace: 'default',
                                annotations: { [DISCOVERY_ANNOTATION]: 'true' },
                            },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27017, protocol: 'UDP' }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(0);
        });

        it('should exclude a port-matched service whose only port is UDP (no annotation)', async () => {
            // A service on a known port but with UDP protocol must be excluded from heuristic discovery.
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'udp-27017', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 27017, protocol: 'UDP' }],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(0);
        });

        it('should include a service where one port is TCP 27017 and another is UDP', async () => {
            // When a service has mixed protocols, the TCP port should still qualify it for discovery.
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mixed-proto-svc', namespace: 'default' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [
                                    { port: 27017, protocol: 'UDP' },
                                    { port: 27017, protocol: 'TCP' },
                                ],
                            },
                        },
                    ],
                }),
            };
            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].name).toBe('mixed-proto-svc');
        });
    });

    // -------------------------------------------------------------------------
    // credential-secret-resolution (generic services)
    // -------------------------------------------------------------------------
    describe('resolveGenericServiceCredentials', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveGenericServiceCredentials } = require('./kubernetesClient');

        it('should resolve credentials from a valid secret', async () => {
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        username: Buffer.from('admin').toString('base64'),
                        password: Buffer.from('pass123').toString('base64'),
                    },
                }),
            };
            const result = await resolveGenericServiceCredentials(mockCoreApi, 'default', 'my-secret');
            expect(result).toBeDefined();
            expect(result!.username).toBe('admin');
            expect(result!.password).toBe('pass123');
            expect(mockCoreApi.readNamespacedSecret).toHaveBeenCalledWith({ name: 'my-secret', namespace: 'default' });
        });

        it('should read the secret from the namespace provided (same-namespace enforcement)', async () => {
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: {
                        username: Buffer.from('user').toString('base64'),
                        password: Buffer.from('pwd').toString('base64'),
                    },
                }),
            };
            await resolveGenericServiceCredentials(mockCoreApi, 'prod-namespace', 'my-secret');
            expect(mockCoreApi.readNamespacedSecret).toHaveBeenCalledWith({
                name: 'my-secret',
                namespace: 'prod-namespace',
            });
        });

        it('should return undefined and skip API call for an invalid secret name', async () => {
            const mockCoreApi = { readNamespacedSecret: jest.fn() };
            const result = await resolveGenericServiceCredentials(mockCoreApi, 'default', 'Invalid Name!');
            expect(result).toBeUndefined();
            expect(mockCoreApi.readNamespacedSecret).not.toHaveBeenCalled();
        });

        it('should return undefined when the secret is not found', async () => {
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockRejectedValue(new Error('Not Found')),
            };
            const result = await resolveGenericServiceCredentials(mockCoreApi, 'default', 'missing-secret');
            expect(result).toBeUndefined();
        });

        it('should return undefined when the secret lacks username or password', async () => {
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({
                    data: { token: Buffer.from('abc').toString('base64') },
                }),
            };
            const result = await resolveGenericServiceCredentials(mockCoreApi, 'default', 'incomplete-secret');
            expect(result).toBeUndefined();
        });

        it('should return undefined when the secret data is empty', async () => {
            const mockCoreApi = {
                readNamespacedSecret: jest.fn().mockResolvedValue({ data: {} }),
            };
            const result = await resolveGenericServiceCredentials(mockCoreApi, 'default', 'empty-secret');
            expect(result).toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // isValidKubernetesSecretName
    // -------------------------------------------------------------------------
    describe('isValidKubernetesSecretName', () => {
        it('should accept valid simple names', () => {
            expect(isValidKubernetesSecretName('my-secret')).toBe(true);
            expect(isValidKubernetesSecretName('secret123')).toBe(true);
            expect(isValidKubernetesSecretName('a')).toBe(true);
        });

        it('should accept names with dots (DNS subdomain)', () => {
            expect(isValidKubernetesSecretName('my.secret')).toBe(true);
            expect(isValidKubernetesSecretName('secret.v1')).toBe(true);
        });

        it('should reject names with uppercase letters', () => {
            expect(isValidKubernetesSecretName('MySecret')).toBe(false);
        });

        it('should reject names starting or ending with hyphens or dots', () => {
            expect(isValidKubernetesSecretName('-secret')).toBe(false);
            expect(isValidKubernetesSecretName('secret-')).toBe(false);
            expect(isValidKubernetesSecretName('.secret')).toBe(false);
            expect(isValidKubernetesSecretName('secret.')).toBe(false);
        });

        it('should reject names with spaces or special characters', () => {
            expect(isValidKubernetesSecretName('my secret')).toBe(false);
            expect(isValidKubernetesSecretName('my@secret')).toBe(false);
            expect(isValidKubernetesSecretName('Invalid Name!')).toBe(false);
        });

        it('should reject empty string', () => {
            expect(isValidKubernetesSecretName('')).toBe(false);
        });

        it('should reject names longer than 253 characters total', () => {
            // Build a valid 254-char name (labels ≤ 63 separated by dots) — must be rejected
            const tooLong =
                'a'.repeat(62) + '.' + 'a'.repeat(62) + '.' + 'a'.repeat(62) + '.' + 'a'.repeat(62) + '.' + 'aa'; // 62*4 + 4 + 2 = 254
            expect(isValidKubernetesSecretName(tooLong)).toBe(false);
            // A valid multi-label name within 253 chars is accepted
            const validLong = 'a'.repeat(62) + '.' + 'a'.repeat(62) + '.' + 'a'.repeat(62) + '.' + 'a'.repeat(62); // 62*4 + 3 = 251
            expect(isValidKubernetesSecretName(validLong)).toBe(true);
        });

        it('should reject names with consecutive dots (empty label)', () => {
            // 'a..b' splits into ['a', '', 'b'] — the empty label must be rejected
            expect(isValidKubernetesSecretName('a..b')).toBe(false);
            expect(isValidKubernetesSecretName('..secret')).toBe(false);
        });

        it('should reject labels longer than 63 characters', () => {
            // 64-character label exceeds the DNS label limit
            const longLabel = 'a'.repeat(64);
            expect(isValidKubernetesSecretName(longLabel)).toBe(false);
            expect(isValidKubernetesSecretName(`${longLabel}.other`)).toBe(false);
            // 63-character label is exactly at the limit — should be accepted
            expect(isValidKubernetesSecretName('a'.repeat(63))).toBe(true);
        });

        it('should accept valid multi-segment dotted names', () => {
            expect(isValidKubernetesSecretName('my.secret.v1')).toBe(true);
            expect(isValidKubernetesSecretName('app.db.credentials')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // nodeport-loadbalancer-safety
    // -------------------------------------------------------------------------
    describe('resolveServiceEndpoint - NodePort and LoadBalancer address safety', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveServiceEndpoint } = require('./kubernetesClient');

        it('should resolve NodePort with ExternalIP and no warning', async () => {
            const service = createServiceInfo({ type: 'NodePort', port: 27017, nodePort: 30017 });
            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [
                        {
                            status: {
                                addresses: [
                                    { type: 'ExternalIP', address: '1.2.3.4' },
                                    { type: 'InternalIP', address: '10.0.0.1' },
                                ],
                            },
                        },
                    ],
                }),
            };
            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:30017/');
                expect(endpoint.warning).toBeUndefined();
            }
        });

        it('should resolve NodePort with InternalIP and include an uncertainty warning', async () => {
            const service = createServiceInfo({ type: 'NodePort', port: 27017, nodePort: 30017 });
            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [{ status: { addresses: [{ type: 'InternalIP', address: '10.0.0.1' }] } }],
                }),
            };
            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://10.0.0.1:30017/');
                expect(endpoint.warning).toBeDefined();
                expect(endpoint.warning).toContain('InternalIP');
            }
        });

        it('should prefer ExternalIP over InternalIP across different nodes', async () => {
            const service = createServiceInfo({ type: 'NodePort', port: 27017, nodePort: 30017 });
            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [
                        { status: { addresses: [{ type: 'InternalIP', address: '10.0.0.1' }] } },
                        {
                            status: {
                                addresses: [
                                    { type: 'InternalIP', address: '10.0.0.2' },
                                    { type: 'ExternalIP', address: '8.8.8.8' },
                                ],
                            },
                        },
                    ],
                }),
            };
            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toContain('8.8.8.8');
                expect(endpoint.warning).toBeUndefined();
            }
        });

        it('should return ready with uncertainty warning when LoadBalancer NodePort fallback uses InternalIP', async () => {
            const service = createServiceInfo({
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
                nodePort: 30192,
            });
            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [{ status: { addresses: [{ type: 'InternalIP', address: '172.18.0.2' }] } }],
                }),
            };
            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toBe('mongodb://172.18.0.2:30192/');
                expect(endpoint.warning).toBeDefined();
                expect(endpoint.warning).toContain('InternalIP');
            }
        });

        it('should return ready without warning when LoadBalancer NodePort fallback uses ExternalIP', async () => {
            const service = createServiceInfo({
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
                nodePort: 30192,
            });
            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [
                        {
                            status: {
                                addresses: [
                                    { type: 'ExternalIP', address: '5.5.5.5' },
                                    { type: 'InternalIP', address: '172.18.0.2' },
                                ],
                            },
                        },
                    ],
                }),
            };
            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.kind).toBe('ready');
            if (endpoint.kind === 'ready') {
                expect(endpoint.connectionString).toContain('5.5.5.5');
                expect(endpoint.warning).toBeUndefined();
            }
        });
    });
});
