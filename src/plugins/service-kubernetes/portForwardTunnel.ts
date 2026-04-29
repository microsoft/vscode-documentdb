/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CoreV1Api, type KubeConfig, type PortForward } from '@kubernetes/client-node';
import * as net from 'net';
import { PassThrough } from 'stream';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';

interface TunnelParams {
    /**
     * Stable id of the {@link KubeconfigSourceRecord} this tunnel was opened
     * against. Stored so {@link PortForwardTunnelManager.stopTunnelsForSource}
     * can selectively close just the tunnels for a removed source instead of
     * closing every active tunnel in the extension.
     */
    readonly sourceId: string;
    readonly kubeConfig: KubeConfig;
    readonly coreApi: CoreV1Api;
    readonly contextName: string;
    readonly namespace: string;
    readonly serviceName: string;
    readonly servicePort: number;
    readonly servicePortName?: string;
    readonly localPort: number;
}

export type TunnelStartResult =
    | { readonly outcome: 'started' }
    | { readonly outcome: 'reused' }
    | { readonly outcome: 'externalAssumed' };

/**
 * Metadata for an active port-forward tunnel. Safe to expose to callers;
 * contains no secrets or credentials.
 */
export interface TunnelInfo {
    readonly contextName: string;
    readonly namespace: string;
    readonly serviceName: string;
    readonly localPort: number;
    readonly remotePort: number;
    readonly startTime: Date;
}

interface ActiveTunnel {
    readonly server: net.Server;
    readonly params: TunnelParams;
    readonly startTime: Date;
    readonly sockets: Set<net.Socket>;
    readonly webSockets: Set<TunnelWebSocket>;
    readonly errorStreams: Set<PassThrough>;
}

interface TunnelWebSocket {
    on(event: 'close' | 'error', listener: () => void): unknown;
    close(): void;
}

/**
 * Resolves a Service to a ready backend pod and the actual target port
 * using the core Endpoints API (available on all K8s versions).
 *
 * @internal Exported for testing; not part of the public API.
 */
export async function resolveServiceBackend(
    coreApi: CoreV1Api,
    namespace: string,
    serviceName: string,
    servicePort: number,
    servicePortName?: string,
): Promise<{ podName: string; targetPort: number }> {
    const endpoints = await coreApi.readNamespacedEndpoints({ name: serviceName, namespace });
    const subsets = endpoints.subsets ?? [];

    for (const subset of subsets) {
        const addresses = subset.addresses ?? [];
        const ports = subset.ports ?? [];

        const matchingPort =
            servicePortName !== undefined
                ? (ports.find((p) => p.port !== undefined && p.name === servicePortName) ??
                  (ports.length === 1 ? ports[0] : undefined))
                : ports.find((p) => p.port !== undefined && (p.port === servicePort || ports.length === 1));
        if (!matchingPort?.port) {
            continue;
        }

        const readyAddr = addresses.find((addr) => addr.targetRef?.kind === 'Pod' && addr.targetRef.name);
        if (readyAddr?.targetRef?.name) {
            return {
                podName: readyAddr.targetRef.name,
                targetPort: matchingPort.port,
            };
        }
    }

    throw new Error(
        vscode.l10n.t(
            'No ready pods found backing service "{0}" in namespace "{1}". Check that the service has running pods.',
            serviceName,
            namespace,
        ),
    );
}

/**
 * Manages port-forward tunnels to Kubernetes ClusterIP services.
 *
 * Each tunnel is a local TCP server on 127.0.0.1 that forwards connections
 * to a backing pod via the Kubernetes API. Pod resolution happens per-connection
 * so the tunnel survives pod recycling.
 */
export class PortForwardTunnelManager implements vscode.Disposable {
    private static _instance: PortForwardTunnelManager | undefined;
    private readonly _activeTunnels = new Map<string, ActiveTunnel>();
    /** Shares concurrent startTunnel calls for the same key, including failures. */
    private readonly _pendingStarts = new Map<string, Promise<TunnelStartResult>>();
    private readonly _pendingStartParams = new Map<string, TunnelParams>();
    private readonly _keyStopGenerations = new Map<string, number>();
    private _stopAllGeneration = 0;

    static getInstance(): PortForwardTunnelManager {
        if (!PortForwardTunnelManager._instance) {
            PortForwardTunnelManager._instance = new PortForwardTunnelManager();
        }
        return PortForwardTunnelManager._instance;
    }

    /**
     * Returns true if a tunnel already exists for the given parameters.
     */
    hasTunnel(contextName: string, namespace: string, serviceName: string, localPort: number): boolean {
        return this._activeTunnels.has(this._buildKey(contextName, namespace, serviceName, localPort));
    }

    /**
     * Returns metadata for all currently active tunnels.
     */
    listTunnels(): TunnelInfo[] {
        return [...this._activeTunnels.values()].map((t) => ({
            contextName: t.params.contextName,
            namespace: t.params.namespace,
            serviceName: t.params.serviceName,
            localPort: t.params.localPort,
            remotePort: t.params.servicePort,
            startTime: t.startTime,
        }));
    }

    /**
     * Stops a single tunnel identified by its key parameters.
     * Returns true if a tunnel was found and stopped, false if not found.
     */
    stopTunnel(contextName: string, namespace: string, serviceName: string, localPort: number): boolean {
        const key = this._buildKey(contextName, namespace, serviceName, localPort);
        const hadPendingStart = this._pendingStarts.has(key);
        this._invalidateKey(key);
        this._pendingStarts.delete(key);
        this._pendingStartParams.delete(key);

        const tunnel = this._activeTunnels.get(key);
        if (!tunnel) {
            return hadPendingStart;
        }
        this._closeTunnel(key, tunnel);
        ext.outputChannel.appendLine(
            vscode.l10n.t(
                'Port-forward tunnel stopped: 127.0.0.1:{0} -> {1}/{2}:{3}',
                String(localPort),
                namespace,
                serviceName,
                String(tunnel.params.servicePort),
            ),
        );
        return true;
    }

    /**
     * Starts a port-forward tunnel. Returns the outcome so callers can
     * show appropriate notifications.
     *
     * - `started`: A new tunnel was created.
     * - `reused`: A tunnel for this service/port was already active.
     * - `externalAssumed`: The port was occupied by an external process
     *   (e.g., `kubectl port-forward`) and the user chose to use it as-is.
     *
     * @throws Error if the port is occupied and the user declines to use it,
     *         or if binding fails for a reason other than EADDRINUSE.
     */
    async startTunnel(params: TunnelParams): Promise<TunnelStartResult> {
        const key = this._buildKey(params.contextName, params.namespace, params.serviceName, params.localPort);

        if (this._activeTunnels.has(key)) {
            return { outcome: 'reused' };
        }

        const activePortConflict = this._findActiveTunnelByLocalPort(params.localPort);
        if (activePortConflict) {
            throw createManagedPortConflictError(activePortConflict.params, params);
        }

        const pendingStart = this._pendingStarts.get(key);
        if (pendingStart) {
            const result = await pendingStart;
            return result.outcome === 'started' ? { outcome: 'reused' } : result;
        }

        const pendingPortConflict = this._findPendingStartByLocalPort(key, params.localPort);
        if (pendingPortConflict) {
            throw createManagedPortConflictError(pendingPortConflict, params);
        }

        const startPromise = this._doStartTunnel(key, params, {
            stopAllGeneration: this._stopAllGeneration,
            keyStopGeneration: this._getKeyStopGeneration(key),
        });
        this._pendingStarts.set(key, startPromise);
        this._pendingStartParams.set(key, params);
        try {
            return await startPromise;
        } finally {
            this._pendingStarts.delete(key);
            this._pendingStartParams.delete(key);
        }
    }

    /**
     * Stops all active tunnels (e.g., when credentials are reconfigured).
     */
    stopAll(): void {
        this._stopAllGeneration++;
        this._pendingStarts.clear();
        this._pendingStartParams.clear();

        const keys = [...this._activeTunnels.keys()];
        for (const key of keys) {
            const tunnel = this._activeTunnels.get(key);
            if (tunnel) {
                this._closeTunnel(key, tunnel);
            }
        }

        ext.outputChannel.appendLine(vscode.l10n.t('All port-forward tunnels stopped.'));
    }

    /**
     * Stops every active tunnel and aborts every pending start that was opened
     * against the given kubeconfig source. Tunnels for other sources are left
     * untouched. Used when a source is removed via the manage UI / right-click
     * menu so unrelated K8s connections in other sources keep working.
     *
     * @returns the number of active tunnels that were closed.
     */
    stopTunnelsForSource(sourceId: string): number {
        let closed = 0;

        // Cancel any pending starts that belong to this source. Their stop
        // generation gets bumped so the in-flight start resolves to a no-op.
        const pendingKeys = [...this._pendingStartParams.entries()]
            .filter(([, params]) => params.sourceId === sourceId)
            .map(([key]) => key);
        for (const key of pendingKeys) {
            this._invalidateKey(key);
            this._pendingStarts.delete(key);
            this._pendingStartParams.delete(key);
        }

        const keys = [...this._activeTunnels.keys()];
        for (const key of keys) {
            const tunnel = this._activeTunnels.get(key);
            if (!tunnel || tunnel.params.sourceId !== sourceId) {
                continue;
            }
            this._invalidateKey(key);
            this._closeTunnel(key, tunnel);
            closed++;
        }

        if (closed > 0 || pendingKeys.length > 0) {
            ext.outputChannel.appendLine(
                vscode.l10n.t(
                    'Stopped {0} port-forward tunnel(s) for kubeconfig source "{1}".',
                    String(closed),
                    sourceId,
                ),
            );
        }
        return closed;
    }

    dispose(): void {
        this.stopAll();
        PortForwardTunnelManager._instance = undefined;
    }

    private async _doStartTunnel(
        key: string,
        params: TunnelParams,
        startGeneration: { readonly stopAllGeneration: number; readonly keyStopGeneration: number },
    ): Promise<TunnelStartResult> {
        const k8s = await import('@kubernetes/client-node');
        const forward = new k8s.PortForward(params.kubeConfig, true);

        const tunnel: ActiveTunnel = {
            server: net.createServer(),
            params,
            startTime: new Date(),
            sockets: new Set<net.Socket>(),
            webSockets: new Set<TunnelWebSocket>(),
            errorStreams: new Set<PassThrough>(),
        };

        const server = tunnel.server;
        server.on('connection', (socket) => {
            void this._handleConnection(socket, forward, params, tunnel);
        });

        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                        reject(
                            new PortInUseError(vscode.l10n.t('Port {0} is already in use.', String(params.localPort))),
                        );
                    } else {
                        reject(err);
                    }
                });

                server.listen(params.localPort, '127.0.0.1', () => {
                    resolve();
                });
            });
        } catch (err) {
            server.close();

            if (err instanceof PortInUseError) {
                const useExisting = vscode.l10n.t('Use existing');
                const choice = await vscode.window.showWarningMessage(
                    vscode.l10n.t(
                        'Port {0} is already in use (perhaps by kubectl port-forward or another tunnel). Connect using the existing port-forward?',
                        String(params.localPort),
                    ),
                    { modal: false },
                    useExisting,
                );

                if (choice === useExisting) {
                    ext.outputChannel.appendLine(
                        vscode.l10n.t(
                            'Using existing port-forward on 127.0.0.1:{0} for {1}/{2}.',
                            String(params.localPort),
                            params.namespace,
                            params.serviceName,
                        ),
                    );
                    return { outcome: 'externalAssumed' };
                }

                throw new Error(
                    vscode.l10n.t(
                        'Port {0} is already in use. Choose a different local port.',
                        String(params.localPort),
                    ),
                );
            }

            throw err;
        }

        // Register immediately after successful listen to avoid window where
        // the server is running but not tracked.
        if (this._isStartInvalidated(key, startGeneration)) {
            this._closeTunnel(key, tunnel);
            throw new Error(
                vscode.l10n.t(
                    'Port-forward tunnel start was cancelled because Kubernetes configuration changed. Try connecting again.',
                ),
            );
        }

        this._activeTunnels.set(key, tunnel);

        ext.outputChannel.appendLine(
            vscode.l10n.t(
                'Port-forward tunnel started: 127.0.0.1:{0} -> {1}/{2}:{3}',
                String(params.localPort),
                params.namespace,
                params.serviceName,
                String(params.servicePort),
            ),
        );

        return { outcome: 'started' };
    }

    private async _handleConnection(
        socket: net.Socket,
        forward: PortForward,
        params: TunnelParams,
        tunnel: ActiveTunnel,
    ): Promise<void> {
        tunnel.sockets.add(socket);

        // Always ensure the socket is destroyed if anything goes wrong,
        // even if the WebSocket is never created.
        const cleanup = (): void => {
            tunnel.sockets.delete(socket);
            if (!socket.destroyed) {
                socket.destroy();
            }
        };

        try {
            const backend = await resolveServiceBackend(
                params.coreApi,
                params.namespace,
                params.serviceName,
                params.servicePort,
                params.servicePortName,
            );

            const errStream = new PassThrough();
            tunnel.errorStreams.add(errStream);
            const cleanupErrorStream = (): void => {
                tunnel.errorStreams.delete(errStream);
                errStream.destroy();
            };

            errStream.once('data', (chunk: Buffer) => {
                ext.outputChannel.appendLine(
                    vscode.l10n.t('Port-forward error channel ({0}): {1}', params.serviceName, chunk.toString('utf-8')),
                );
                cleanupErrorStream();
                cleanup();
            });
            errStream.once('close', () => {
                tunnel.errorStreams.delete(errStream);
            });

            const ws = await forward.portForward(
                params.namespace,
                backend.podName,
                [backend.targetPort],
                socket,
                errStream,
                socket,
            );

            const websocketCandidate: unknown = typeof ws === 'function' ? ws() : ws;

            if (isTunnelWebSocket(websocketCandidate)) {
                const websocket = websocketCandidate;
                tunnel.webSockets.add(websocket);

                const cleanupWebSocket = (): void => {
                    tunnel.webSockets.delete(websocket);
                    cleanupErrorStream();
                    cleanup();
                };

                websocket.on('close', cleanupWebSocket);
                websocket.on('error', cleanupWebSocket);

                socket.on('close', () => {
                    tunnel.sockets.delete(socket);
                    cleanupErrorStream();
                    tunnel.webSockets.delete(websocket);
                    try {
                        websocket.close();
                    } catch {
                        // already closed
                    }
                });
            } else {
                // No WebSocket returned — ensure socket gets cleaned up on close
                socket.on('error', cleanup);
                socket.on('close', () => {
                    cleanupErrorStream();
                    cleanup();
                });
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            ext.outputChannel.appendLine(
                vscode.l10n.t(
                    'Port-forward backend resolution failed for {0}/{1}: {2}',
                    params.namespace,
                    params.serviceName,
                    errMsg,
                ),
            );
            cleanup();
        }
    }

    private _buildKey(contextName: string, namespace: string, serviceName: string, localPort: number): string {
        return `${contextName}/${namespace}/${serviceName}:${String(localPort)}`;
    }

    private _closeTunnel(key: string, tunnel: ActiveTunnel): void {
        this._activeTunnels.delete(key);

        for (const socket of tunnel.sockets) {
            socket.destroy();
        }
        tunnel.sockets.clear();

        for (const webSocket of tunnel.webSockets) {
            try {
                webSocket.close();
            } catch {
                // already closed
            }
        }
        tunnel.webSockets.clear();

        for (const errorStream of tunnel.errorStreams) {
            errorStream.destroy();
        }
        tunnel.errorStreams.clear();

        tunnel.server.close();
    }

    private _invalidateKey(key: string): void {
        this._keyStopGenerations.set(key, this._getKeyStopGeneration(key) + 1);
    }

    private _getKeyStopGeneration(key: string): number {
        return this._keyStopGenerations.get(key) ?? 0;
    }

    private _isStartInvalidated(
        key: string,
        startGeneration: { readonly stopAllGeneration: number; readonly keyStopGeneration: number },
    ): boolean {
        return (
            startGeneration.stopAllGeneration !== this._stopAllGeneration ||
            startGeneration.keyStopGeneration !== this._getKeyStopGeneration(key)
        );
    }

    private _findActiveTunnelByLocalPort(localPort: number): ActiveTunnel | undefined {
        if (localPort === 0) {
            return undefined;
        }

        return [...this._activeTunnels.values()].find((tunnel) => tunnel.params.localPort === localPort);
    }

    private _findPendingStartByLocalPort(currentKey: string, localPort: number): TunnelParams | undefined {
        if (localPort === 0) {
            return undefined;
        }

        for (const [key, params] of this._pendingStartParams) {
            if (key !== currentKey && params.localPort === localPort) {
                return params;
            }
        }

        return undefined;
    }
}

class PortInUseError extends Error {}

function createManagedPortConflictError(existingParams: TunnelParams, requestedParams: TunnelParams): Error {
    return new Error(
        vscode.l10n.t(
            'Local port {0} is already used by Kubernetes tunnel "{1}/{2}". Choose a different local port for "{3}/{4}".',
            String(requestedParams.localPort),
            existingParams.namespace,
            existingParams.serviceName,
            requestedParams.namespace,
            requestedParams.serviceName,
        ),
    );
}

function isTunnelWebSocket(value: unknown): value is TunnelWebSocket {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { readonly on?: unknown; readonly close?: unknown };
    return typeof candidate.on === 'function' && typeof candidate.close === 'function';
}
