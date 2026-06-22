/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Orchestrates provisioning + lifecycle of the single managed local DocumentDB
 * instance for the Quick Start POC (WI-1).
 *
 * Design note (deviation from plan D13, recorded in the plan's Deviation Log):
 * the plan suggested composing the repo's `Task` framework. The `Task` base
 * class is single-use (its `start()` throws once it has run, and its progress
 * model is numeric 0-100 driving a VS Code notification) which fits neither the
 * Retry requirement nor the in-webview *stage checklist* model (D3). A standalone
 * service with a per-attempt `AbortSignal` + an `EventEmitter` status sink
 * satisfies every functional requirement the reviewers raised (cancellation,
 * fresh-per-attempt, no single-use breakage) with less ceremony — and D13
 * explicitly permits a standalone service. Provisioning is exposed as an async
 * generator of {@link StageEvent}s, consumed directly by the tRPC subscription.
 */

import * as vscode from 'vscode';
import { connectToClient } from '../../documentdb/connectToClient';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ext } from '../../extensionVariables';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { ContainerRuntime, getQuickStartOutputChannel } from './ContainerRuntime';
import { composeConnectionString, generateCredentials } from './quickStartCredentials';
import {
    type InstanceMetadata,
    InstanceState,
    type ProvisionStage,
    QUICK_START_ALIAS,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_CONTAINER_NAME,
    QUICK_START_IMAGE,
    QUICK_START_LABEL_KEY,
    QUICK_START_PORT,
    type QuickStartStatus,
    type StageEvent,
} from './quickStartTypes';

/** Stable cache key for CredentialCache / ClustersClient (single instance, POC). */
export const QUICK_START_CLUSTER_ID = 'quickstart-local-documentdb';

const SECRET_KEY = 'documentdb.quickstart.connectionString';
const READINESS_TIMEOUT_MS = 180_000;
const APP_NAME = 'DocumentDB-QuickStart';
const EMULATOR_CONFIG: EmulatorConfiguration = { isEmulator: true, disableEmulatorSecurity: true };

function errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function stageEvent(stage: ProvisionStage, status: StageEvent['status'], message?: string, error?: string): StageEvent {
    return { stage, status, message, error };
}

/** Cancellable delay that rejects if the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
            },
            { once: true },
        );
    });
}

class QuickStartServiceImpl {
    private state: InstanceState = InstanceState.NotInstalled;
    private metadata: InstanceMetadata | undefined;
    private errorMessage: string | undefined;
    private provisioning = false;

    private readonly statusEmitter = new vscode.EventEmitter<void>();
    /** Fires whenever the managed-instance status changes (drives the tree). */
    public readonly onDidChangeStatus = this.statusEmitter.event;

    public getStatus(): QuickStartStatus {
        return { state: this.state, metadata: this.metadata, errorMessage: this.errorMessage };
    }

    public get isBusy(): boolean {
        return this.provisioning;
    }

    public dispose(): void {
        this.statusEmitter.dispose();
    }

    private setStatus(state: InstanceState, metadata?: InstanceMetadata, errorMessage?: string): void {
        this.state = state;
        if (metadata !== undefined) {
            this.metadata = metadata;
        }
        this.errorMessage = errorMessage;
        this.statusEmitter.fire();
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new Error('aborted');
        }
    }

    /**
     * Provision the managed instance, yielding one {@link StageEvent} per
     * transition. Cancellation is via `signal`: a pull-phase cancel removes
     * nothing (no container exists yet); a create/start-phase cancel removes the
     * container by id (decision D12). All cleanup runs in `finally` so it also
     * fires when the consumer unsubscribes (iterator `return()`).
     */
    public async *provision(signal: AbortSignal): AsyncGenerator<StageEvent> {
        if (this.provisioning) {
            return;
        }
        this.provisioning = true;

        const channel = getQuickStartOutputChannel();
        const credentials = generateCredentials();
        const secrets: string[] = [credentials.password];
        const cts = new vscode.CancellationTokenSource();
        const onAbort = (): void => cts.cancel();
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            cts.cancel();
        }

        let containerId: string | undefined;
        let containerCreated = false;
        let success = false;

        try {
            this.setStatus(InstanceState.Provisioning, undefined, undefined);

            // --- checking ---
            yield stageEvent('checking', 'active', 'Checking Docker…');
            const readiness = await ContainerRuntime.isDockerReady();
            this.throwIfAborted(signal);
            if (!readiness.cliInstalled || !readiness.daemonReachable) {
                const message = !readiness.cliInstalled
                    ? 'Docker CLI was not found on your PATH. Install Docker and retry.'
                    : 'Docker is installed but the daemon is not reachable. Start Docker and retry.';
                this.setStatus(InstanceState.Error, undefined, message);
                yield stageEvent('checking', 'error', message, message);
                return;
            }

            // Remove a pre-existing managed container so the run starts clean (it is
            // labelled as ours, D9). Then verify the port is free (design §8.3).
            const existing = await this.findManagedContainer();
            if (existing) {
                channel.appendLine(`Removing existing Quick Start container ${existing.id} for a clean run…`);
                await ContainerRuntime.removeContainer(existing.id).catch(() => undefined);
            }
            const portFree = await ContainerRuntime.isPortFree(QUICK_START_PORT);
            this.throwIfAborted(signal);
            if (!portFree) {
                const message = `Port ${QUICK_START_PORT} is already in use. Free it and retry.`;
                this.setStatus(InstanceState.Error, undefined, message);
                yield stageEvent('checking', 'error', message, message);
                return;
            }
            yield stageEvent('checking', 'done');

            // --- pulling ---
            yield stageEvent('pulling', 'active', 'Pulling the official image…');
            await ContainerRuntime.pullImage(QUICK_START_IMAGE, cts.token);
            this.throwIfAborted(signal);
            yield stageEvent('pulling', 'done');

            // --- creating (docker run -d creates and starts) ---
            yield stageEvent('creating', 'active', 'Creating container…');
            containerId = await ContainerRuntime.createAndRunContainer(
                {
                    imageRef: QUICK_START_IMAGE,
                    name: QUICK_START_CONTAINER_NAME,
                    labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: QUICK_START_ALIAS },
                    hostPort: QUICK_START_PORT,
                    containerPort: QUICK_START_PORT,
                    command: ['--username', credentials.username, '--password', credentials.password],
                },
                secrets,
                cts.token,
            );
            containerCreated = true;
            if (!containerId) {
                const item = await ContainerRuntime.inspectContainer(QUICK_START_CONTAINER_NAME);
                containerId = item?.id ?? QUICK_START_CONTAINER_NAME;
            }
            this.throwIfAborted(signal);
            yield stageEvent('creating', 'done');

            // --- starting (confirm running, read bound port, follow logs) ---
            yield stageEvent('starting', 'active', 'Starting container…');
            const inspected = await ContainerRuntime.inspectContainer(containerId);
            const boundPort = (inspected && ContainerRuntime.getBoundHostPort(inspected)) || QUICK_START_PORT;
            // Stream container logs to the channel during the wait (compensates for -dt detach, D2).
            void ContainerRuntime.followLogs(containerId, secrets, cts.token);
            yield stageEvent('starting', 'done');

            // --- waiting (wire-protocol readiness, D7) ---
            yield stageEvent('waiting', 'active', 'Waiting for DocumentDB to accept connections…');
            const connectionString = composeConnectionString(credentials.username, credentials.password, boundPort);
            await this.waitForReadiness(connectionString, signal);
            this.throwIfAborted(signal);

            // --- success ---
            await ext.secretStorage.store(SECRET_KEY, connectionString);
            const metadata: InstanceMetadata = {
                containerId,
                alias: QUICK_START_ALIAS,
                boundPort,
                clusterId: QUICK_START_CLUSTER_ID,
                connectionString,
                username: credentials.username,
            };
            this.setStatus(InstanceState.Running, metadata, undefined);
            success = true;
            yield stageEvent('waiting', 'done');
            yield stageEvent('done', 'done', `DocumentDB Local is running on localhost:${boundPort}.`);
        } catch (error) {
            const aborted = signal.aborted;
            const message = aborted ? 'Setup was cancelled.' : errMessage(error);
            if (!aborted) {
                this.setStatus(InstanceState.Error, undefined, message);
            }
            // This yield is delivered on the error path; on unsubscribe (return())
            // the generator skips straight to `finally`.
            yield stageEvent('error', 'error', message, aborted ? undefined : message);
        } finally {
            // Cleanup (D12): only when we did not succeed AND a container exists.
            if (!success && containerCreated && containerId) {
                channel.appendLine(`Cleaning up container ${containerId}…`);
                await ContainerRuntime.stopContainer(containerId).catch(() => undefined);
                await ContainerRuntime.removeContainer(containerId).catch(() => undefined);
            }
            if (!success) {
                // Aborted via return() leaves us Provisioning — settle the state.
                this.setStatus(signal.aborted ? InstanceState.NotInstalled : this.state, undefined, this.errorMessage);
            }
            signal.removeEventListener('abort', onAbort);
            cts.dispose();
            this.provisioning = false;
        }
    }

    /** Probe the wire protocol until the DB answers `ping`, up to {@link READINESS_TIMEOUT_MS}. */
    private async waitForReadiness(connectionString: string, signal: AbortSignal): Promise<void> {
        const deadline = Date.now() + READINESS_TIMEOUT_MS;
        let attempt = 0;
        let lastError: unknown;
        while (Date.now() < deadline) {
            this.throwIfAborted(signal);
            try {
                const client = await connectToClient(connectionString, APP_NAME, EMULATOR_CONFIG);
                try {
                    await client.db('admin').command({ ping: 1 });
                    return;
                } finally {
                    await client.close().catch(() => undefined);
                }
            } catch (error) {
                lastError = error;
            }
            attempt += 1;
            const backoff = Math.min(3000, 500 + attempt * 250);
            await delay(backoff, signal);
        }
        throw new Error(
            `Timed out waiting for DocumentDB to accept connections.${lastError ? ` (${errMessage(lastError)})` : ''}`,
        );
    }

    private async findManagedContainer(): Promise<{ id: string } | undefined> {
        const list = await ContainerRuntime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' }).catch(() => []);
        return list[0];
    }

    /**
     * Activation reconciliation (risk-review item): after a window reload the
     * in-memory state is lost while the container keeps running. Detect the
     * labelled container; if we still hold its credentials, re-adopt it so the
     * inline tree node reappears; otherwise remove it for a clean slate so it
     * doesn't block the next port bind.
     */
    public async reconcile(): Promise<void> {
        try {
            const container = await this.findManagedContainer();
            if (!container) {
                this.setStatus(InstanceState.NotInstalled);
                return;
            }
            const stored = await ext.secretStorage.get(SECRET_KEY);
            if (!stored) {
                getQuickStartOutputChannel().appendLine(
                    'Removing an orphaned Quick Start container (no stored credentials) for a clean slate…',
                );
                await ContainerRuntime.removeContainer(container.id).catch(() => undefined);
                this.setStatus(InstanceState.NotInstalled);
                return;
            }
            const inspected = await ContainerRuntime.inspectContainer(container.id);
            const boundPort = (inspected && ContainerRuntime.getBoundHostPort(inspected)) || QUICK_START_PORT;
            const running = ContainerRuntime.isRunning(inspected);
            let username = '';
            try {
                username = new DocumentDBConnectionString(stored).username;
            } catch {
                username = '';
            }
            this.setStatus(running ? InstanceState.Running : InstanceState.Stopped, {
                containerId: container.id,
                alias: QUICK_START_ALIAS,
                boundPort,
                clusterId: QUICK_START_CLUSTER_ID,
                connectionString: stored,
                username,
            });
        } catch {
            // Reconciliation is best-effort; never block activation.
        }
    }
}

/** Singleton Quick Start service. */
export const QuickStartService = new QuickStartServiceImpl();
