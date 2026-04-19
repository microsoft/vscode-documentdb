/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOCUMENTDB_PORTS } from './config';
import { getContexts, type KubeServiceEndpoint, type KubeServiceInfo } from './kubernetesClient';

// Mock @kubernetes/client-node
const mockLoadFromFile = jest.fn();
const mockGetContexts = jest.fn();
const mockGetCluster = jest.fn();
const mockSetCurrentContext = jest.fn();
const mockMakeApiClient = jest.fn();

const mockLoadFromDefault = jest.fn();

jest.mock('@kubernetes/client-node', () => ({
    KubeConfig: jest.fn().mockImplementation(() => ({
        loadFromFile: mockLoadFromFile,
        loadFromDefault: mockLoadFromDefault,
        getContexts: mockGetContexts,
        getCluster: mockGetCluster,
        setCurrentContext: mockSetCurrentContext,
        makeApiClient: mockMakeApiClient,
    })),
    CoreV1Api: jest.fn(),
    CustomObjectsApi: jest.fn(),
}));

describe('kubernetesClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

        it('should return only services on DocumentDB ports', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mongo-svc' },
                            spec: {
                                type: 'ClusterIP',
                                clusterIP: '10.0.0.1',
                                ports: [{ port: 27017, targetPort: 27017 }],
                            },
                        },
                        {
                            metadata: { name: 'web-svc' },
                            spec: {
                                type: 'ClusterIP',
                                ports: [{ port: 8080, targetPort: 8080 }],
                            },
                        },
                        {
                            metadata: { name: 'mongo-alt' },
                            spec: {
                                type: 'NodePort',
                                ports: [{ port: 27018, targetPort: 27018, nodePort: 30018 }],
                            },
                        },
                    ],
                }),
            };

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');

            expect(services).toHaveLength(2);
            expect(services[0].name).toBe('mongo-alt');
            expect(services[1].name).toBe('mongo-svc');
            // web-svc on port 8080 should be filtered out
            expect(services.find((s: KubeServiceInfo) => s.name === 'web-svc')).toBeUndefined();
        });

        it('should return empty array for namespace with no matching services', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'nginx' },
                            spec: { type: 'ClusterIP', ports: [{ port: 80 }] },
                        },
                    ],
                }),
            };

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(0);
        });

        it('should extract LoadBalancer external address', async () => {
            const mockCoreApi = {
                listNamespacedService: jest.fn().mockResolvedValue({
                    items: [
                        {
                            metadata: { name: 'mongo-lb' },
                            spec: {
                                type: 'LoadBalancer',
                                ports: [{ port: 27017, targetPort: 27017 }],
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

            const services: KubeServiceInfo[] = await listDocumentDBServices(mockCoreApi, 'default');
            expect(services).toHaveLength(1);
            expect(services[0].externalAddress).toBe('1.2.3.4');
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
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
        });

        it('should return unreachable for LoadBalancer without external IP and no nodePort', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(false);
            expect(endpoint.unreachableReason).toContain('not yet assigned');
        });

        it('should fall back to NodePort for LoadBalancer without external IP', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: undefined,
                nodePort: 30192,
            };

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
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://172.18.0.2:30192/');
        });

        it('should resolve NodePort with node address', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-np',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                nodePort: 30017,
            };

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
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://192.168.1.10:30017/');
        });

        it('should resolve ClusterIP to localhost for port-forwarding', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-cip',
                namespace: 'default',
                type: 'ClusterIP',
                port: 27017,
                clusterIP: '10.0.0.1',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://localhost:27017/');
        });

        it('should return unreachable for ExternalName service', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-ext',
                namespace: 'default',
                type: 'ExternalName',
                port: 27017,
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(false);
            expect(endpoint.unreachableReason).toContain('ExternalName');
        });

        it('should return unreachable for unknown/unsupported service type', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-headless',
                namespace: 'default',
                type: 'Headless',
                port: 27017,
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(false);
            expect(endpoint.unreachableReason).toContain('Headless');
        });

        it('should return unreachable for NodePort without nodePort assigned', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-np-noport',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                // nodePort intentionally omitted
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(false);
            expect(endpoint.unreachableReason).toContain('node address');
        });

        it('should return unreachable for NodePort when no nodes are available', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-np-nonodes',
                namespace: 'default',
                type: 'NodePort',
                port: 27017,
                nodePort: 30017,
            };

            const mockCoreApi = {
                listNode: jest.fn().mockResolvedValue({
                    items: [],
                }),
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, mockCoreApi);
            expect(endpoint.isReachable).toBe(false);
            expect(endpoint.unreachableReason).toContain('node address');
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
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'directConnection=true&tls=true',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/?directConnection=true&tls=true');
        });

        it('should strip disallowed connection parameters', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'foo=bar&password=leaked',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
            expect(endpoint.connectionString).not.toContain('foo');
            expect(endpoint.connectionString).not.toContain('password');
            expect(endpoint.connectionString).not.toContain('leaked');
        });

        it('should keep only valid parameters from a mix of valid and invalid', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'tls=true&evil=inject&replicaSet=rs0&password=secret',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            expect(endpoint.connectionString).toContain('tls=true');
            expect(endpoint.connectionString).toContain('replicaSet=rs0');
            expect(endpoint.connectionString).not.toContain('evil');
            expect(endpoint.connectionString).not.toContain('password');
            expect(endpoint.connectionString).not.toContain('secret');
        });

        it('should not append ? suffix when connectionParams is empty', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: '',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
            expect(endpoint.connectionString).not.toContain('?');
        });

        it('should not append ? suffix when connectionParams contains only invalid keys', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                connectionParams: 'badKey=badValue&anotherBad=true',
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
            expect(endpoint.connectionString).not.toContain('?');
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

            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '10.0.0.1',
                connectionParams: allAllowed,
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.isReachable).toBe(true);
            const url = endpoint.connectionString!;
            expect(url).toContain('tls=true');
            expect(url).toContain('tlsAllowInvalidCertificates=true');
            expect(url).toContain('replicaSet=rs0');
            expect(url).toContain('authSource=admin');
            expect(url).toContain('authMechanism=SCRAM-SHA-256');
            expect(url).toContain('directConnection=true');
            expect(url).toContain('retryWrites=true');
            expect(url).toContain('w=majority');
            expect(url).toContain('readPreference=secondary');
        });

        it('should not include connectionParams when service has no connectionParams set', async () => {
            const service: KubeServiceInfo = {
                name: 'mongo-lb',
                namespace: 'default',
                type: 'LoadBalancer',
                port: 27017,
                externalAddress: '1.2.3.4',
                // connectionParams intentionally omitted (undefined)
            };

            const endpoint: KubeServiceEndpoint = await resolveServiceEndpoint(service, {});
            expect(endpoint.connectionString).toBe('mongodb://1.2.3.4:27017/');
            expect(endpoint.connectionString).not.toContain('?');
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
});
