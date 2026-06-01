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

    function hasTunnel(overrides?: {
        sourceId?: string;
        localPort?: number;
        serviceName?: string;
        contextName?: string;
        namespace?: string;
    }): boolean {
        return manager.hasTunnel(
            overrides?.sourceId ?? 'default',
            overrides?.contextName ?? 'test-ctx',
            overrides?.namespace ?? 'default',
            overrides?.serviceName ?? 'test-svc',
            overrides?.localPort ?? 0,
        );
    }

    function stopTunnel(overrides?: {
        sourceId?: string;
        localPort?: number;
        serviceName?: string;
        contextName?: string;
        namespace?: string;
    }): boolean {
        return manager.stopTunnel(
            overrides?.sourceId ?? 'default',
            overrides?.contextName ?? 'test-ctx',
            overrides?.namespace ?? 'default',
            overrides?.serviceName ?? 'test-svc',
            overrides?.localPort ?? 0,
        );
    }

    // --- Lifecycle ---

    it('should start a tunnel on a free port', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const result = await manager.startTunnel(createMockParams());
        expect(result.outcome).toBe('started');
        expect(hasTunnel()).toBe(true);
    });

    it('should return reused for the same source and service key', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const params = createMockParams();
        await manager.startTunnel(params);
        const result = await manager.startTunnel(params);
        expect(result.outcome).toBe('reused');
        expect(hasTunnel()).toBe(true);
    });

    it('should start independent tunnels for identical service keys from different sourceIds', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });

        const first = await manager.startTunnel(createMockParams({ sourceId: 'source-a' }));
        const second = await manager.startTunnel(createMockParams({ sourceId: 'source-b' }));

        expect(first.outcome).toBe('started');
        expect(second.outcome).toBe('started');
        expect(hasTunnel({ sourceId: 'source-a' })).toBe(true);
        expect(hasTunnel({ sourceId: 'source-b' })).toBe(true);
        expect(
            manager
                .listTunnels()
                .map((t) => t.sourceId)
                .sort(),
        ).toEqual(['source-a', 'source-b']);
    });

    it('should not share a pending tunnel start across different sourceIds', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });

        const firstStart = manager.startTunnel(createMockParams({ sourceId: 'source-a' }));
        const secondStart = manager.startTunnel(createMockParams({ sourceId: 'source-b' }));

        await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([
            { outcome: 'started' },
            { outcome: 'started' },
        ]);
        expect(hasTunnel({ sourceId: 'source-a' })).toBe(true);
        expect(hasTunnel({ sourceId: 'source-b' })).toBe(true);
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
            expect(hasTunnel({ localPort: port })).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should allow different tunnels for different services', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        expect(hasTunnel({ serviceName: 'svc-a' })).toBe(true);
        expect(hasTunnel({ serviceName: 'svc-b' })).toBe(true);
    });

    it('should distinguish tunnels by context name', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ contextName: 'ctx-1' }));
        await manager.startTunnel(createMockParams({ contextName: 'ctx-2' }));
        expect(hasTunnel({ contextName: 'ctx-1' })).toBe(true);
        expect(hasTunnel({ contextName: 'ctx-2' })).toBe(true);
    });

    it('should distinguish tunnels by namespace', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ namespace: 'ns-a' }));
        await manager.startTunnel(createMockParams({ namespace: 'ns-b' }));
        expect(hasTunnel({ namespace: 'ns-a' })).toBe(true);
        expect(hasTunnel({ namespace: 'ns-b' })).toBe(true);
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
        expect(info.sourceId).toBe('default');
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
        const stopped = stopTunnel({ serviceName: 'svc-target' });
        expect(stopped).toBe(true);
        expect(hasTunnel({ serviceName: 'svc-target' })).toBe(false);
    });

    it('should return false when stopping a non-existent tunnel', () => {
        const stopped = stopTunnel({
            sourceId: 'no-source',
            contextName: 'no-ctx',
            namespace: 'no-ns',
            serviceName: 'no-svc',
            localPort: 9999,
        });
        expect(stopped).toBe(false);
    });

    it('should only stop the targeted tunnel and leave others running', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        stopTunnel({ serviceName: 'svc-a' });
        expect(hasTunnel({ serviceName: 'svc-a' })).toBe(false);
        expect(hasTunnel({ serviceName: 'svc-b' })).toBe(true);
    });

    it('should stop only the targeted source when service identity is otherwise identical', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'source-a' }));
        await manager.startTunnel(createMockParams({ sourceId: 'source-b' }));

        const stopped = stopTunnel({ sourceId: 'source-a' });

        expect(stopped).toBe(true);
        expect(hasTunnel({ sourceId: 'source-a' })).toBe(false);
        expect(hasTunnel({ sourceId: 'source-b' })).toBe(true);
    });

    it('should log when a single tunnel is stopped', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-log' }));
        stopTunnel({ serviceName: 'svc-log' });
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('svc-log'));
    });

    it('should stop all tunnels', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ serviceName: 'svc-a' }));
        await manager.startTunnel(createMockParams({ serviceName: 'svc-b' }));
        manager.stopAll();
        expect(hasTunnel({ serviceName: 'svc-a' })).toBe(false);
        expect(hasTunnel({ serviceName: 'svc-b' })).toBe(false);
    });

    it('stopTunnelsForSource closes only tunnels opened against the matching sourceId', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'src-keep', serviceName: 'svc-keep' }));
        await manager.startTunnel(createMockParams({ sourceId: 'src-drop', serviceName: 'svc-drop' }));

        const closed = manager.stopTunnelsForSource('src-drop');

        expect(closed).toBe(1);
        expect(hasTunnel({ sourceId: 'src-keep', serviceName: 'svc-keep' })).toBe(true);
        expect(hasTunnel({ sourceId: 'src-drop', serviceName: 'svc-drop' })).toBe(false);
    });

    it('stopTunnelsForSource closes the matching source even when another source has the same service identity', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'src-keep' }));
        await manager.startTunnel(createMockParams({ sourceId: 'src-drop' }));

        const closed = manager.stopTunnelsForSource('src-drop');

        expect(closed).toBe(1);
        expect(hasTunnel({ sourceId: 'src-keep' })).toBe(true);
        expect(hasTunnel({ sourceId: 'src-drop' })).toBe(false);
    });

    it('stopTunnelsForSource is a no-op when no tunnels match the sourceId', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        await manager.startTunnel(createMockParams({ sourceId: 'src-a', serviceName: 'svc-a' }));

        const closed = manager.stopTunnelsForSource('src-other');

        expect(closed).toBe(0);
        expect(hasTunnel({ sourceId: 'src-a', serviceName: 'svc-a' })).toBe(true);
    });

    it('should cancel a pending start when stopAll is called before listen completes', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const start = manager.startTunnel(createMockParams());

        manager.stopAll();

        await expect(start).rejects.toThrow(/cancelled/);
        expect(hasTunnel()).toBe(false);
    });

    it('should cancel a pending start when stopTunnel is called for that key', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const start = manager.startTunnel(createMockParams({ serviceName: 'pending-svc' }));

        const stopped = stopTunnel({ serviceName: 'pending-svc' });

        expect(stopped).toBe(true);
        await expect(start).rejects.toThrow(/cancelled/);
        expect(hasTunnel({ serviceName: 'pending-svc' })).toBe(false);
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
            expect(hasTunnel({ localPort: port })).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should silently retry EADDRINUSE once before prompting the user', async () => {
        // Simulates a port held by a previous extension instance (e.g.,
        // "Reload Window" while the old extension host is still tearing
        // down its TCP listener) that gets released a few hundred ms
        // later. The new code should bind successfully on the retry
        // without surfacing the "Use existing" prompt at all.
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        // Schedule the blocker to release BEFORE the retry window (750ms)
        // elapses. The first listen attempt fails; the retry succeeds.
        setTimeout(() => blockingServer.close(), 100);

        try {
            const result = await manager.startTunnel(createMockParams({ localPort: port }));
            expect(result.outcome).toBe('started');
            // Critically, the user is NOT prompted — the retry handled it.
            expect(mockShowWarningMessage).not.toHaveBeenCalled();
            expect(hasTunnel({ localPort: port })).toBe(true);
        } finally {
            // blockingServer is already closed by the setTimeout above; close
            // again is a safe no-op.
            blockingServer.close();
        }
    });

    it('should bail out of the EADDRINUSE retry window when the start is cancelled', async () => {
        // Simulates the user (or a sibling code path) invoking stopAll() /
        // stopTunnel() while we're mid-way through the 750ms retry sleep.
        // The fix must not show the misleading "Use existing" prompt for a
        // start the caller has already abandoned — the retry path must
        // observe the invalidation and throw the cancellation error.
        //
        // The complementary case of a cancellation landing while the
        // "Use existing" prompt itself is open is covered by the next test.
        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        // Cancel the start partway through the retry delay. The blocking
        // server stays up so the second listen() would also fail — without
        // the invalidation check the user would be prompted.
        setTimeout(() => manager.stopAll(), 200);

        try {
            await expect(manager.startTunnel(createMockParams({ localPort: port }))).rejects.toThrow(
                /cancelled because Kubernetes configuration changed/,
            );
            expect(mockShowWarningMessage).not.toHaveBeenCalled();
            expect(hasTunnel({ localPort: port })).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should bail out when the start is cancelled while the "Use existing" prompt is open', async () => {
        // Cancellation that lands while the user is staring at the prompt
        // must NOT honour their eventual click — returning externalAssumed
        // for an abandoned start would route the caller (wizard / discovery
        // flow) at a tunnel nobody asked for.
        //
        // Test structure: we synchronize on the prompt actually being
        // invoked (via a promise the mock resolves on first call) instead
        // of sleeping a fixed wall-clock duration, so the test does NOT
        // depend on the implementation's retry-sleep being any specific
        // length and cannot flake on a loaded CI worker.
        let promptInvoked!: () => void;
        const promptInvokedPromise = new Promise<void>((resolve) => {
            promptInvoked = resolve;
        });
        let resolvePrompt: ((value: string) => void) | undefined;
        mockShowWarningMessage.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    resolvePrompt = resolve;
                    promptInvoked();
                }),
        );

        const blockingServer = net.createServer();
        const port = await new Promise<number>((resolve) => {
            blockingServer.listen(0, '127.0.0.1', () => {
                resolve((blockingServer.address() as net.AddressInfo).port);
            });
        });

        try {
            const tunnelPromise = manager.startTunnel(createMockParams({ localPort: port }));

            // Wait until the implementation has actually reached the prompt
            // (whatever that takes — the retry sleep may change). No fixed
            // wall-clock dependency.
            await promptInvokedPromise;
            expect(mockShowWarningMessage).toHaveBeenCalledTimes(1);

            // Now cancel — analogous to stopAll() landing mid-prompt.
            manager.stopAll();

            // Simulate the user clicking "Use existing" AFTER the cancel.
            expect(resolvePrompt).toBeDefined();
            resolvePrompt!('Use existing');

            await expect(tunnelPromise).rejects.toThrow(/cancelled because Kubernetes configuration changed/);
            // Critically: no tunnel registered, no externalAssumed result.
            expect(hasTunnel({ localPort: port })).toBe(false);
        } finally {
            blockingServer.close();
        }
    });

    it('should report a managed port conflict instead of reusing a tunnel from a different sourceId', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });
        const port = await new Promise<number>((resolve) => {
            const tmp = net.createServer();
            tmp.listen(0, '127.0.0.1', () => {
                const freePort = (tmp.address() as net.AddressInfo).port;
                tmp.close(() => resolve(freePort));
            });
        });

        await manager.startTunnel(createMockParams({ sourceId: 'source-a', localPort: port }));

        await expect(manager.startTunnel(createMockParams({ sourceId: 'source-b', localPort: port }))).rejects.toThrow(
            /already used by Kubernetes tunnel/,
        );

        expect(hasTunnel({ sourceId: 'source-a', localPort: port })).toBe(true);
        expect(hasTunnel({ sourceId: 'source-b', localPort: port })).toBe(false);
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
        expect(hasTunnel({ serviceName: 'svc-a', localPort: port })).toBe(true);
        expect(hasTunnel({ serviceName: 'svc-b', localPort: port })).toBe(false);
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
        expect(hasTunnel()).toBe(false);
    });

    it('should reset singleton on dispose', async () => {
        const instance1 = PortForwardTunnelManager.getInstance();
        instance1.dispose();
        const instance2 = PortForwardTunnelManager.getInstance();
        expect(instance2).not.toBe(instance1);
    });

    // --- hasTunnel ---

    it('should return false for non-existent tunnel', () => {
        expect(
            hasTunnel({
                sourceId: 'no-source',
                contextName: 'no-ctx',
                namespace: 'no-ns',
                serviceName: 'no-svc',
                localPort: 12345,
            }),
        ).toBe(false);
    });

    // --- Connection handling (integration-style) ---

    it('should resolve pod and forward when a TCP client connects', async () => {
        mockPortForward.mockResolvedValue({ on: jest.fn(), close: jest.fn() });

        const params = createMockParams({ localPort: 0 });
        await manager.startTunnel(params);

        // Port 0 means OS-assigned; verifies tunnel server was created successfully
        expect(hasTunnel()).toBe(true);
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
