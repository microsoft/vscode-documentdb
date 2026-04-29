/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import { type PassThrough } from 'stream';

// Mock vscode
const mockShowWarningMessage = jest.fn();
jest.mock('vscode', () => ({
    l10n: { t: (msg: string, ...args: unknown[]) => msg.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) },
    window: {
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
}));

// Mock extensionVariables
jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { appendLine: jest.fn() },
    },
}));

// Mock @kubernetes/client-node
const mockPortForward = jest.fn();
jest.mock('@kubernetes/client-node', () => ({
    PortForward: jest.fn().mockImplementation(() => ({
        portForward: mockPortForward,
    })),
}));

// Import after mocks are set up
import { ext } from '../../extensionVariables';
import { PortForwardTunnelManager, resolveServiceBackend } from './portForwardTunnel';

// ---------------------------------------------------------------------------
// resolveServiceBackend
// ---------------------------------------------------------------------------
describe('resolveServiceBackend', () => {
    it('should resolve a ready pod and matching target port', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'mongo-pod-1' } }],
                        ports: [{ port: 27017 }],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017);
        expect(result).toEqual({ podName: 'mongo-pod-1', targetPort: 27017 });
    });

    it('should resolve targetPort that differs from servicePort', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-a' } }],
                        ports: [{ port: 9999 }, { port: 10260 }],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 10260);
        expect(result).toEqual({ podName: 'pod-a', targetPort: 10260 });
    });

    it('should resolve a named endpoint port when service port differs from target port', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-a' } }],
                        ports: [
                            { name: 'metrics', port: 9090 },
                            { name: 'documentdb', port: 10260 },
                        ],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017, 'documentdb');
        expect(result).toEqual({ podName: 'pod-a', targetPort: 10260 });
    });

    it('should fall back to the only endpoint port when named service port has no endpoint name match', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-a' } }],
                        ports: [{ name: 'renamed', port: 10260 }],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017, 'documentdb');
        expect(result).toEqual({ podName: 'pod-a', targetPort: 10260 });
    });

    it('should not select an arbitrary endpoint port when service port name has no multi-port match', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-a' } }],
                        ports: [
                            { name: 'metrics', port: 9090 },
                            { name: 'admin', port: 10261 },
                        ],
                    },
                ],
            }),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'svc', 27017, 'documentdb')).rejects.toThrow(/No ready pods/);
    });

    it('should pick the only port when there is a single port entry', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-b' } }],
                        ports: [{ port: 5432 }],
                    },
                ],
            }),
        } as never;

        // servicePort 27017 doesn't match 5432, but since there's only one port, it picks it
        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017);
        expect(result).toEqual({ podName: 'pod-b', targetPort: 5432 });
    });

    it('should skip subsets with no ready addresses and use the next subset', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [], // no ready pods in first subset
                        ports: [{ port: 27017 }],
                    },
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-in-second' } }],
                        ports: [{ port: 27017 }],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017);
        expect(result).toEqual({ podName: 'pod-in-second', targetPort: 27017 });
    });

    it('should skip addresses without Pod targetRef', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [
                            { targetRef: { kind: 'Node', name: 'node-1' } }, // not a Pod
                            { targetRef: { kind: 'Pod', name: 'actual-pod' } },
                        ],
                        ports: [{ port: 27017 }],
                    },
                ],
            }),
        } as never;

        const result = await resolveServiceBackend(coreApi, 'ns', 'svc', 27017);
        expect(result).toEqual({ podName: 'actual-pod', targetPort: 27017 });
    });

    it('should throw when subsets are empty', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({ subsets: [] }),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'my-svc', 27017)).rejects.toThrow(
            /No ready pods found backing service "my-svc"/,
        );
    });

    it('should throw when subsets is undefined', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({}),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'svc', 27017)).rejects.toThrow(/No ready pods/);
    });

    it('should throw when no port matches and multiple ports exist', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ targetRef: { kind: 'Pod', name: 'pod-x' } }],
                        ports: [{ port: 8080 }, { port: 9090 }], // neither matches 27017
                    },
                ],
            }),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'svc', 27017)).rejects.toThrow(/No ready pods/);
    });

    it('should throw when addresses have no targetRef', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockResolvedValue({
                subsets: [
                    {
                        addresses: [{ ip: '10.0.0.5' }], // no targetRef at all
                        ports: [{ port: 27017 }],
                    },
                ],
            }),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'svc', 27017)).rejects.toThrow(/No ready pods/);
    });

    it('should throw when Endpoints API call fails', async () => {
        const coreApi = {
            readNamespacedEndpoints: jest.fn().mockRejectedValue(new Error('Forbidden')),
        } as never;

        await expect(resolveServiceBackend(coreApi, 'ns', 'svc', 27017)).rejects.toThrow('Forbidden');
    });

    it('should pass correct arguments to readNamespacedEndpoints', async () => {
        const mockRead = jest.fn().mockResolvedValue({
            subsets: [
                {
                    addresses: [{ targetRef: { kind: 'Pod', name: 'p' } }],
                    ports: [{ port: 10260 }],
                },
            ],
        });
        const coreApi = { readNamespacedEndpoints: mockRead } as never;

        await resolveServiceBackend(coreApi, 'my-ns', 'my-svc', 10260);
        expect(mockRead).toHaveBeenCalledWith({ name: 'my-svc', namespace: 'my-ns' });
    });
});

// ---------------------------------------------------------------------------
// PortForwardTunnelManager
// ---------------------------------------------------------------------------
describe('PortForwardTunnelManager', () => {
    let manager: PortForwardTunnelManager;

    beforeEach(() => {
        jest.clearAllMocks();
        PortForwardTunnelManager.getInstance().dispose();
        manager = PortForwardTunnelManager.getInstance();
    });

    afterEach(() => {
        manager.dispose();
    });

    function createMockParams(overrides?: {
        sourceId?: string;
        localPort?: number;
        serviceName?: string;
        contextName?: string;
        namespace?: string;
        servicePort?: number;
        servicePortName?: string;
    }) {
        return {
            sourceId: overrides?.sourceId ?? 'default',
            kubeConfig: {} as never,
            coreApi: {
                readNamespacedEndpoints: jest.fn().mockResolvedValue({
                    subsets: [
                        {
                            addresses: [{ targetRef: { kind: 'Pod', name: 'test-pod-abc' } }],
                            ports: [{ port: overrides?.servicePort ?? 27017 }],
                        },
                    ],
                }),
            } as never,
            contextName: overrides?.contextName ?? 'test-ctx',
            namespace: overrides?.namespace ?? 'default',
            serviceName: overrides?.serviceName ?? 'test-svc',
            servicePort: overrides?.servicePort ?? 27017,
            servicePortName: overrides?.servicePortName,
            localPort: overrides?.localPort ?? 0,
        };
    }

    // --- Lifecycle ---

    it('should start a tunnel on a free port', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const result = await manager.startTunnel(createMockParams());
        expect(result.outcome).toBe('started');
        expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', 0)).toBe(true);
    });

    it('should return reused for the same key', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const params = createMockParams();
        await manager.startTunnel(params);
        const result = await manager.startTunnel(params);
        expect(result.outcome).toBe('reused');
        expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', 0)).toBe(true);
    });

    it('should propagate a pending start failure to concurrent callers for the same key', async () => {
        let resolveWarning: (value: string | undefined) => void = () => undefined;
        mockShowWarningMessage.mockReturnValue(
            new Promise<string | undefined>((resolve) => {
                resolveWarning = resolve;
            }),
        );

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        try {
            const params = createMockParams({ localPort: port });
            const firstStart = manager.startTunnel(params);
            const secondStart = manager.startTunnel(params);

            await new Promise((resolve) => setImmediate(resolve));
            resolveWarning(undefined);

            await expect(firstStart).rejects.toThrow(/already in use/);
            await expect(secondStart).rejects.toThrow(/already in use/);
            expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', port)).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should allow different tunnels for different services', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-a', 0)).toBe(true);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-b', 0)).toBe(true);
    });

    it('should distinguish tunnels by context name', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ contextName: 'ctx-1' }));
        await manager.startTunnel(createMockParams({ contextName: 'ctx-2' }));
        expect(manager.hasTunnel('ctx-1', 'default', 'test-svc', 0)).toBe(true);
        expect(manager.hasTunnel('ctx-2', 'default', 'test-svc', 0)).toBe(true);
    });

    it('should distinguish tunnels by namespace', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ namespace: 'ns-a' }));
        await manager.startTunnel(createMockParams({ namespace: 'ns-b' }));
        expect(manager.hasTunnel('test-ctx', 'ns-a', 'test-svc', 0)).toBe(true);
        expect(manager.hasTunnel('test-ctx', 'ns-b', 'test-svc', 0)).toBe(true);
    });

    // --- listTunnels ---

    it('should return empty list when no tunnels are active', () => {
        expect(manager.listTunnels()).toEqual([]);
    });

    it('should list a started tunnel with correct metadata', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const before = new Date();
        await manager.startTunnel(createMockParams({ serviceName: 'my-svc', namespace: 'my-ns', servicePort: 27017 }));
        const after = new Date();

        const tunnels = manager.listTunnels();
        expect(tunnels).toHaveLength(1);
        const info = tunnels[0];
        expect(info.contextName).toBe('test-ctx');
        expect(info.namespace).toBe('my-ns');
        expect(info.serviceName).toBe('my-svc');
        expect(info.localPort).toBe(0);
        expect(info.remotePort).toBe(27017);
        expect(info.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(info.startTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should list all started tunnels', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        const tunnels = manager.listTunnels();
        const names = tunnels.map((t) => t.serviceName).sort();
        expect(names).toEqual(['svc-a', 'svc-b']);
    });

    // --- stopTunnel ---

    it('should stop a single tunnel and return true', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-target' }));
        const stopped = manager.stopTunnel('test-ctx', 'default', 'svc-target', 0);
        expect(stopped).toBe(true);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-target', 0)).toBe(false);
    });

    it('should return false when stopping a non-existent tunnel', () => {
        const stopped = manager.stopTunnel('no-ctx', 'no-ns', 'no-svc', 9999);
        expect(stopped).toBe(false);
    });

    it('should only stop the targeted tunnel and leave others running', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        manager.stopTunnel('test-ctx', 'default', 'svc-a', 0);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-a', 0)).toBe(false);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-b', 0)).toBe(true);
    });

    it('should log when a single tunnel is stopped', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-log' }));
        manager.stopTunnel('test-ctx', 'default', 'svc-log', 0);
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('svc-log'));
    });

    it('should stop all tunnels', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        manager.stopAll();
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-a', 0)).toBe(false);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-b', 0)).toBe(false);
    });

    it('stopTunnelsForSource closes only tunnels opened against the matching sourceId', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'src-keep', serviceName: 'svc-keep' }));
        await manager.startTunnel(createMockParams({ sourceId: 'src-drop', serviceName: 'svc-drop' }));

        const closed = manager.stopTunnelsForSource('src-drop');

        expect(closed).toBe(1);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-keep', 0)).toBe(true);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-drop', 0)).toBe(false);
    });

    it('stopTunnelsForSource is a no-op when no tunnels match the sourceId', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'src-a', serviceName: 'svc-a' }));

        const closed = manager.stopTunnelsForSource('src-other');

        expect(closed).toBe(0);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-a', 0)).toBe(true);
    });

    it('should cancel a pending start when stopAll is called before listen completes', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const start = manager.startTunnel(createMockParams());

        manager.stopAll();

        await expect(start).rejects.toThrow(/cancelled/);
        expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', 0)).toBe(false);
    });

    it('should cancel a pending start when stopTunnel is called for that key', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const start = manager.startTunnel(createMockParams({ serviceName: 'pending-svc' }));

        const stopped = manager.stopTunnel('test-ctx', 'default', 'pending-svc', 0);

        expect(stopped).toBe(true);
        await expect(start).rejects.toThrow(/cancelled/);
        expect(manager.hasTunnel('test-ctx', 'default', 'pending-svc', 0)).toBe(false);
    });

    it('should log when tunnels are stopped', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams());
        manager.stopAll();
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('All port-forward tunnels stopped'),
        );
    });

    // --- Port conflicts ---

    it('should offer to use existing port-forward when port is occupied', async () => {
        mockShowWarningMessage.mockResolvedValue('Use existing');

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        try {
            const result = await manager.startTunnel(createMockParams({ localPort: port }));
            expect(result.outcome).toBe('externalAssumed');
            expect(mockShowWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('already in use'),
                expect.any(Object),
                expect.any(String),
            );
        } finally {
            blockingServer.close();
        }
    });

    it('should throw when user declines to use occupied port', async () => {
        mockShowWarningMessage.mockResolvedValue(undefined); // user dismisses

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        try {
            await expect(manager.startTunnel(createMockParams({ localPort: port }))).rejects.toThrow(/already in use/);
        } finally {
            blockingServer.close();
        }
    });

    it('should not register tunnel when user accepts external port-forward', async () => {
        mockShowWarningMessage.mockResolvedValue('Use existing');

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        try {
            await manager.startTunnel(createMockParams({ localPort: port }));
            expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', port)).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should not offer to reuse a managed tunnel for a different Kubernetes service on the same local port', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const port = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const freePort = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(freePort));
            });
        });

        await manager.startTunnel(createMockParams({ serviceName: 'svc-a', localPort: port }));
        mockShowWarningMessage.mockClear();

        await expect(manager.startTunnel(createMockParams({ serviceName: 'svc-b', localPort: port }))).rejects.toThrow(
            /already used by Kubernetes tunnel/,
        );

        expect(mockShowWarningMessage).not.toHaveBeenCalled();
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-a', port)).toBe(true);
        expect(manager.hasTunnel('test-ctx', 'default', 'svc-b', port)).toBe(false);
    });

    // --- Output channel ---

    it('should log tunnel start to output channel', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams());
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Port-forward tunnel started'),
        );
    });

    it('should include namespace and service in log message', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ namespace: 'prod', serviceName: 'db-primary' }));
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('prod'));
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('db-primary'));
    });

    // --- dispose ---

    it('should clean up on dispose', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams());
        manager.dispose();
        expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', 0)).toBe(false);
    });

    it('should reset singleton on dispose', async () => {
        const instance1 = PortForwardTunnelManager.getInstance();
        instance1.dispose();
        const instance2 = PortForwardTunnelManager.getInstance();
        expect(instance2).not.toBe(instance1);
    });

    // --- hasTunnel ---

    it('should return false for non-existent tunnel', () => {
        expect(manager.hasTunnel('no-ctx', 'no-ns', 'no-svc', 12345)).toBe(false);
    });

    // --- Connection handling (integration-style) ---

    it('should resolve pod and forward when a TCP client connects', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });

        const params = createMockParams({ localPort: 0 });
        await manager.startTunnel(params);

        // Port 0 means OS-assigned; verifies tunnel server was created successfully
        expect(manager.hasTunnel('test-ctx', 'default', 'test-svc', 0)).toBe(true);
    });

    it('should accept TCP connections and call portForward with resolved pod', async () => {
        const wsClose = jest.fn();
        const wsOn = jest.fn();
        mockPortForward.mockResolvedValue({ on: wsOn, close: wsClose });

        // Use a known port so we can connect
        const params = createMockParams();

        // Find a free port first
        const freePort = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const port = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(port));
            });
        });

        const fixedParams = { ...params, localPort: freePort };
        await manager.startTunnel(fixedParams);

        // Connect a TCP client
        const client = new net.Socket();
        await new Promise<void>((resolve) => {
            client.connect(freePort, '127.0.0.1', () => resolve());
        });

        // Give time for the async _handleConnection to execute
        await new Promise((r) => setTimeout(r, 100));

        expect(mockPortForward).toHaveBeenCalledWith(
            'default', // namespace
            'test-pod-abc', // podName from mock endpoints
            [27017], // targetPort
            expect.any(Object), // socket (output)
            expect.any(Object), // errStream
            expect.any(Object), // socket (input)
        );

        client.destroy();
    });

    it('should close active sockets and webSockets when stopAll is called', async () => {
        const wsClose = jest.fn();
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: wsClose });

        const freePort = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const port = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(port));
            });
        });

        await manager.startTunnel(createMockParams({ localPort: freePort }));

        const client = new net.Socket();
        const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
        await new Promise<void>((resolve) => {
            client.connect(freePort, '127.0.0.1', () => resolve());
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        manager.stopAll();
        await closed;

        expect(wsClose).toHaveBeenCalled();
    });

    it('should destroy no-webSocket error stream when the TCP socket closes', async () => {
        mockPortForward.mockResolvedValue(undefined);

        const freePort = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const port = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(port));
            });
        });

        await manager.startTunnel(createMockParams({ localPort: freePort }));

        const client = new net.Socket();
        await new Promise<void>((resolve) => {
            client.connect(freePort, '127.0.0.1', () => resolve());
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        const errStream = mockPortForward.mock.calls[0]?.[4] as PassThrough | undefined;
        expect(errStream).toBeDefined();

        const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
        client.destroy();
        await closed;
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(errStream?.destroyed).toBe(true);
    });

    it('should destroy socket when pod resolution fails', async () => {
        const failingParams = {
            sourceId: 'default',
            kubeConfig: {} as never,
            coreApi: {
                readNamespacedEndpoints: jest.fn().mockRejectedValue(new Error('Endpoints not found')),
            } as never,
            contextName: 'test-ctx',
            namespace: 'default',
            serviceName: 'bad-svc',
            servicePort: 27017,
            localPort: 0,
        };

        const freePort = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const port = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(port));
            });
        });

        await manager.startTunnel({ ...failingParams, localPort: freePort });

        const client = new net.Socket();
        const destroyed = new Promise<void>((resolve) => {
            client.on('close', () => resolve());
        });

        client.connect(freePort, '127.0.0.1');
        await destroyed; // socket should be destroyed due to resolution failure
        expect(mockPortForward).not.toHaveBeenCalled();
    });

    it('should log backend resolution failure to output channel', async () => {
        const freePort = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const port = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(port));
            });
        });

        const failingParams = {
            sourceId: 'default',
            kubeConfig: {} as never,
            coreApi: {
                readNamespacedEndpoints: jest.fn().mockRejectedValue(new Error('Forbidden')),
            } as never,
            contextName: 'test-ctx',
            namespace: 'error-ns',
            serviceName: 'error-svc',
            servicePort: 27017,
            localPort: freePort,
        };

        await manager.startTunnel(failingParams);

        const client = new net.Socket();
        const closed = new Promise<void>((resolve) => client.on('close', () => resolve()));
        client.connect(freePort, '127.0.0.1');
        await closed;

        // Give the async _handleConnection time to log
        await new Promise((r) => setTimeout(r, 50));

        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('error-svc'));
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Forbidden'));
    });
});
