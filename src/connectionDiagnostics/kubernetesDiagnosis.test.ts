/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DiagnosticsEvent, type DiagnosticsRun } from '@documentdb-js/connection-diagnostics';
import { CoreV1Api, PortForward } from '@kubernetes/client-node';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { MongoClient } from 'mongodb';
import * as net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { ensureKubernetesPortForward } from '../plugins/service-kubernetes/ensureKubernetesPortForward';
import { resetKubernetesClustersForTests } from '../plugins/service-kubernetes/KubernetesErrorExplainer';
import { KubernetesReachabilityProvider } from '../plugins/service-kubernetes/KubernetesReachabilityProvider';
import {
    KUBERNETES_PORT_FORWARD_METADATA_PROPERTY,
    type KubernetesPortForwardMetadata,
} from '../plugins/service-kubernetes/portForwardMetadata';
import { PortForwardTunnelManager } from '../plugins/service-kubernetes/portForwardTunnel';
import { addInlineSource, resetSourceStoreCacheForMigration } from '../plugins/service-kubernetes/sources/sourceStore';
import { ConnectionReachabilityService } from '../services/connectionReachabilityService';
import { StorageService } from '../services/storageService';
import { describeFinding } from './findingMessages';
import { PanelRowProjector } from './panelRows';
import { deriveResult } from './result';
import { getPlannedDiagnosticsChecks, runConnectionDiagnostics } from './runConnectionDiagnostics';
import { type FindingCode } from './types';

const globalStateBacking = new Map<string, unknown>();
const secretStorageBacking = new Map<string, string>();

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    callWithTelemetryAndErrorHandling: async <T>(
        _name: string,
        callback: (context: IActionContext) => Promise<T>,
    ): Promise<T> =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
        } as unknown as IActionContext),
}));
vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            extensionMode: 1,
            extension: { id: 'kubernetes-diagnosis-test', packageJSON: { version: '1.0.0' } },
            subscriptions: [],
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined =>
                    globalStateBacking.has(key) ? (globalStateBacking.get(key) as T) : defaultValue,
                update: async (key: string, value: unknown): Promise<void> => {
                    if (value === undefined) {
                        globalStateBacking.delete(key);
                    } else {
                        globalStateBacking.set(key, value);
                    }
                },
                keys: (): string[] => [...globalStateBacking.keys()],
            },
        },
        secretStorage: {
            get: async (key: string): Promise<string | undefined> => secretStorageBacking.get(key),
            store: async (key: string, value: string): Promise<void> => {
                secretStorageBacking.set(key, value);
            },
            onDidChange: (): { dispose(): void } => ({ dispose(): void {} }),
        },
        outputChannel: { info: vi.fn(), appendLine: vi.fn(), error: vi.fn(), warn: vi.fn() },
    },
}));

async function unusedLoopbackPort(): Promise<number> {
    const server = net.createServer();
    try {
        await new Promise<void>((resolve, reject): void => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Expected a loopback TCP address');
        }
        return address.port;
    } finally {
        await new Promise<void>((resolve, reject): void => {
            server.close((error): void => (error ? reject(error) : resolve()));
        });
    }
}

async function loopbackAcceptsConnection(port: number): Promise<boolean> {
    const socket = new net.Socket();
    const closed = new Promise<void>((resolve): void => {
        socket.once('close', (): void => resolve());
    });
    try {
        return await new Promise<boolean>((resolve, reject): void => {
            socket.once('connect', (): void => resolve(true));
            socket.once('error', (error: NodeJS.ErrnoException): void => {
                if (error.code === 'ECONNREFUSED') {
                    resolve(false);
                } else {
                    reject(error);
                }
            });
            socket.setTimeout(1000, (): void => reject(new Error('Loopback connection did not settle')));
            socket.connect(port, '127.0.0.1');
        });
    } finally {
        socket.destroy();
        await closed;
    }
}

describe('TDD: Kubernetes diagnosis', (): void => {
    let metadata: KubernetesPortForwardMetadata;
    let manager: PortForwardTunnelManager;

    beforeEach(async (): Promise<void> => {
        vi.clearAllMocks();
        globalStateBacking.clear();
        secretStorageBacking.clear();
        StorageService._resetForTests();
        resetSourceStoreCacheForMigration();
        resetKubernetesClustersForTests();
        ConnectionReachabilityService.resetForTests();
        ConnectionReachabilityService.registerProvider(new KubernetesReachabilityProvider());
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn((_key: string, defaultValue?: unknown): unknown => defaultValue),
        } as unknown as vscode.WorkspaceConfiguration);
        const source = await addInlineSource(
            JSON.stringify({
                apiVersion: 'v1',
                kind: 'Config',
                clusters: [{ name: 'fixture-cluster', cluster: { server: 'https://127.0.0.1:6443' } }],
                users: [{ name: 'fixture-user', user: {} }],
                contexts: [
                    {
                        name: 'fixture-context',
                        context: { cluster: 'fixture-cluster', user: 'fixture-user' },
                    },
                ],
                'current-context': 'fixture-context',
            }),
        );
        metadata = {
            kind: 'kubernetesClusterIpPortForward',
            sourceId: source.id,
            contextName: 'fixture-context',
            namespace: 'fixture-namespace',
            serviceName: 'fixture-service',
            servicePort: 27017,
            servicePortName: 'documentdb',
            localPort: await unusedLoopbackPort(),
        };
        manager = PortForwardTunnelManager.getInstance();
        vi.spyOn(CoreV1Api.prototype, 'readNamespacedEndpoints').mockResolvedValue({
            subsets: [
                {
                    addresses: [{ ip: '10.0.0.2', targetRef: { kind: 'Pod', name: 'fixture-pod' } }],
                    ports: [{ name: 'documentdb', port: 10260 }],
                },
            ],
        });
        vi.spyOn(PortForward.prototype, 'portForward').mockRejectedValue(new Error('Unexpected forwarding request'));
        vi.spyOn(MongoClient.prototype, 'connect').mockRejectedValue(new Error('Unexpected authentication attempt'));
        vi.spyOn(manager, 'startTunnel');
    });

    afterEach(async (): Promise<void> => {
        try {
            manager?.dispose();
            if (metadata) {
                expect(await loopbackAcceptsConnection(metadata.localPort)).toBe(false);
            }
        } finally {
            ConnectionReachabilityService.resetForTests();
            resetKubernetesClustersForTests();
            resetSourceStoreCacheForMigration();
            StorageService._resetForTests();
            globalStateBacking.clear();
            secretStorageBacking.clear();
            vi.restoreAllMocks();
        }
    });

    async function diagnosePreparationFailure(
        reason: 'sourceUnreachable' | 'noReadyBackend',
        title: string,
    ): Promise<DiagnosticsRun<FindingCode>> {
        const events: DiagnosticsEvent<FindingCode>[] = [];
        const projector = new PanelRowProjector(describeFinding, getPlannedDiagnosticsChecks());
        const run = await runConnectionDiagnostics({
            target: {
                clusterId: 'saved-kubernetes-connection',
                displayName: 'Saved Kubernetes connection',
                sourceView: 'connections',
                // Known saved credentials exercise preparation, not the discovery credential read.
                getCredentials: vi.fn().mockResolvedValue({
                    connectionString: `mongodb://127.0.0.1:${metadata.localPort}/?tls=true`,
                    availableAuthMethods: [AuthMethodId.NativeAuth],
                    selectedAuthMethod: AuthMethodId.NativeAuth,
                    nativeAuthConfig: { connectionUser: 'saved-user', connectionPassword: 'saved-password' },
                    connectionProperties: { [KUBERNETES_PORT_FORWARD_METADATA_PROPERTY]: metadata },
                }),
            },
            entryPoint: 'contextMenu',
            runTrigger: 'initial',
            runIndex: 1,
            diagnosticsSessionId: 'kubernetes-diagnosis-session',
            timeoutProfile: 'default',
            signal: new AbortController().signal,
            onEvent(event): void {
                events.push(event);
                projector.apply(event);
            },
        });

        for (const id of ['resolveTarget', 'connectionString', 'credentials']) {
            expect(run.results.find((result): boolean => result.checkId === id)).toMatchObject({ status: 'pass' });
        }
        expect(run.targets).toEqual([{ host: '127.0.0.1', port: metadata.localPort, source: 'uri' }]);
        expect(CoreV1Api.prototype.readNamespacedEndpoints).toHaveBeenCalledExactlyOnceWith({
            name: metadata.serviceName,
            namespace: metadata.namespace,
        });
        expect(run.results.find((result): boolean => result.checkId === 'prepare')).toMatchObject({
            status: 'fail',
            findings: [{ code: 'prepare.failed', data: { providerId: 'kubernetes-port-forward', reason } }],
        });
        for (const id of ['srv', 'dns', 'tcp', 'tls', 'hello', 'authenticate']) {
            expect(run.results.find((result): boolean => result.checkId === id)).toMatchObject({
                status: 'skipped',
                durationMs: 0,
                findings: [],
                skippedBecause: {
                    reason: ['srv', 'dns', 'authenticate'].includes(id) ? 'dependencyFailed' : 'dependencySkipped',
                    checkId: 'prepare',
                },
            });
            expect(events.some((event): boolean => event.type === 'checkStarted' && event.checkId === id)).toBe(false);
        }
        expect(MongoClient.prototype.connect).not.toHaveBeenCalled();
        expect(PortForward.prototype.portForward).not.toHaveBeenCalled();
        expect(run.coverage.timedOut).toEqual([]);
        const result = deriveResult(run.results, describeFinding);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'connectionSettings',
            headline: { checkId: 'prepare', code: 'prepare.failed', title },
            firewallHint: false,
        });
        expect(result.headline?.code).not.toMatch(/^tls\./);
        expect(result.headline?.code).not.toBe('auth.credentialsUnavailable');
        expect(projector.rows().find((row): boolean => row.id === 'connectionSettings')).toMatchObject({
            status: 'error',
            segments: [
                { kind: 'finding', title },
                { kind: 'preparationFailed', providerId: 'kubernetes-port-forward' },
            ],
        });
        return run;
    }

    it('reports an API request failure before creating a fresh loopback tunnel', async (): Promise<void> => {
        vi.mocked(CoreV1Api.prototype.readNamespacedEndpoints).mockRejectedValue(
            Object.assign(new Error('Kubernetes API connection refused'), { code: 'ECONNREFUSED' }),
        );

        await diagnosePreparationFailure('sourceUnreachable', 'Kubernetes API unreachable');

        expect(manager.startTunnel).not.toHaveBeenCalled();
        expect(manager.listTunnels()).toEqual([]);
        expect(await loopbackAcceptsConnection(metadata.localPort)).toBe(false);
    });

    it('reports an API request failure without closing an existing shared loopback tunnel', async (): Promise<void> => {
        await expect(ensureKubernetesPortForward(metadata)).resolves.toEqual({ outcome: 'started' });
        expect(CoreV1Api.prototype.readNamespacedEndpoints).not.toHaveBeenCalled();
        const sharedTunnel = manager.listTunnels();
        expect(sharedTunnel).toHaveLength(1);
        vi.mocked(manager.startTunnel).mockClear();
        vi.mocked(CoreV1Api.prototype.readNamespacedEndpoints).mockRejectedValue(
            Object.assign(new Error('Kubernetes API connection refused'), { code: 'ECONNREFUSED' }),
        );

        await diagnosePreparationFailure('sourceUnreachable', 'Kubernetes API unreachable');

        expect(manager.startTunnel).not.toHaveBeenCalled();
        expect(manager.listTunnels()).toEqual(sharedTunnel);
        // A TCP handshake witnesses the listener; it sends no database request.
        expect(await loopbackAcceptsConnection(metadata.localPort)).toBe(true);
        expect(CoreV1Api.prototype.readNamespacedEndpoints).toHaveBeenCalledTimes(2);
        expect(PortForward.prototype.portForward).not.toHaveBeenCalled();
    });

    it('reports empty ready endpoints without blaming TLS or creating a tunnel', async (): Promise<void> => {
        vi.mocked(CoreV1Api.prototype.readNamespacedEndpoints).mockResolvedValue({ subsets: [] });

        await diagnosePreparationFailure('noReadyBackend', 'No ready pods behind the service');

        expect(manager.startTunnel).not.toHaveBeenCalled();
        expect(manager.listTunnels()).toEqual([]);
        expect(await loopbackAcceptsConnection(metadata.localPort)).toBe(false);
    });
});
