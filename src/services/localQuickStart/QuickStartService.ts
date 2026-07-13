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

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { MongoClient } from 'mongodb';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ext } from '../../extensionVariables';
import {
    ContainerRuntime,
    getBoundHostPort,
    getQuickStartOutputChannel,
    type IContainerRuntime,
    isRunning,
} from './ContainerRuntime';
import { composeConnectionString, generateCredentials, type GeneratedCredentials } from './quickStartCredentials';
import {
    DEFAULT_INSTANCE_DISPLAY_NAME,
    isProvisioningLeaseFresh,
    type QuickStartInstanceRecord,
    readRegistry,
    removeInstanceRecord,
    updateRegistry,
    upsertInstanceRecord,
} from './quickStartRegistry';
import {
    type AdvancedQuickStartOptions,
    clusterId,
    containerName,
    DEFAULT_ALIAS,
    imageRefKey,
    type InstanceMetadata,
    InstanceState,
    type InstanceStatus,
    LEGACY_IMAGE_REF_KEY,
    LEGACY_SECRET_KEY,
    type ProvisionStage,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_DATA_PATH,
    QUICK_START_IMAGE,
    QUICK_START_LABEL_KEY,
    QUICK_START_PORT,
    QUICK_START_PORT_BAND_END,
    type QuickStartStatus,
    resolveQuickStartImage,
    secretKey,
    type StageEvent,
    volumeName,
} from './quickStartTypes';

/** Stable cache key for CredentialCache / ClustersClient (the default instance). Ephemeral. */
export const QUICK_START_CLUSTER_ID = clusterId(DEFAULT_ALIAS);

/**
 * Surfaced (design §12) when a labelled container + on-disk volume exist but the stored credentials
 * are gone, so the cluster can't be opened. Reconcile NEVER removes it (a lost secret does not prove
 * the volume is disposable — R2); the user decides (Delete for a clean slate, or restore the secret).
 */
function credentialUnavailableMessage(): string {
    return l10n.t(
        'DocumentDB Local has data on disk but its saved credentials are missing, so it cannot be opened. Use "Delete Container" to remove it and start fresh (this erases the data).',
    );
}
const READINESS_TIMEOUT_MS = 180_000;
/** Per-attempt server-selection timeout so a Cancel is observed within ~3s. */
const PROBE_SERVER_SELECTION_TIMEOUT_MS = 3_000;
/**
 * The image ships a native init script + sample-data directory (see
 * `Dockerfile_documentdb_local`). We run that script ONCE via `docker exec` after
 * the gateway is ready, instead of baking `--init-data true` into the run args:
 * the baked flag re-runs the init on every Stop/Start, hits a duplicate-key error,
 * and crashes the container (`set -e`). Exec-once keeps restarts safe while loading
 * the same `sampledb` (users/products/orders/analytics). `-P` is the container's
 * internal gateway port (always {@link QUICK_START_PORT} inside the container,
 * independent of the bound host port).
 */
const SAMPLE_DATA_INIT_SCRIPT = '/home/documentdb/gateway/scripts/init_documentdb_data.sh';
const SAMPLE_DATA_DIR = '/home/documentdb/gateway/sample-data';
/** Database the native init script creates; used to make seeding idempotent (§8.4). */
const SAMPLE_DATA_DB = 'sampledb';
/**
 * After a `docker start`, a container that re-runs a failing entrypoint reports
 * "running" for a moment before exiting, so a single immediate inspect can be a
 * false positive. We poll {@link START_CONFIRM_ATTEMPTS} times to require it stays up.
 */
const START_CONFIRM_ATTEMPTS = 3;
const START_CONFIRM_INTERVAL_MS = 1_500;

function errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Thrown by {@link QuickStartServiceImpl.waitForReadiness} when the wire-protocol probe
 * exhausts its window. Distinguished from other failures so a readiness timeout can KEEP
 * the running container (it may just need more time) and offer "Wait longer" (§9.1), rather
 * than tearing everything down like a pull/create/start failure.
 */
class ReadinessTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReadinessTimeoutError';
    }
}

/**
 * Everything a "Wait longer" resume needs to finish adopting a container whose database was
 * still initializing when the initial readiness window elapsed. Retained across the timeout
 * (the container is kept running) and cleared on success / discard / a new provision.
 */
interface PendingReadiness {
    /** The instance this pending readiness belongs to (WI-2). */
    readonly alias: string;
    readonly displayName: string;
    readonly containerId: string;
    readonly connectionString: string;
    readonly boundPort: number;
    readonly username: string;
    readonly password: string;
    readonly imageRef: string;
    readonly sampleDataRequested: boolean;
    /** A fresh (non-reusing) attempt owns its half-initialized volume, so a discard may wipe it. */
    readonly reusing: boolean;
}

/**
 * Per-alias runtime state (WI-2). Replaces the single-instance fields; every method operates on
 * `stateFor(alias)`. Until WI-3/4/5 pass a real alias, callers use `DEFAULT_ALIAS`, so the machine
 * behaves as single-instance.
 */
interface InstanceRuntimeState {
    readonly alias: string;
    displayName: string;
    port?: number;
    metadata?: InstanceMetadata;
    state: InstanceState;
    provisioning: boolean;
    lifecycleBusy: boolean;
    missing: boolean;
    pendingReadiness?: PendingReadiness;
    errorMessage?: string;
}

/**
 * Resolve the credentials for a fresh provision: honor custom Advanced credentials
 * when BOTH a username and password are supplied (whitespace-only is treated as not
 * supplied), otherwise auto-generate. (Callers only use this on a non-reusing provision;
 * a Missing-recreate reuses stored creds.)
 */
function resolveProvisionCredentials(options?: AdvancedQuickStartOptions): GeneratedCredentials {
    const username = options?.username?.trim();
    const password = options?.password?.trim();
    if (username && password) {
        return { username, password };
    }
    return generateCredentials();
}

function stageEvent(
    stage: ProvisionStage,
    status: StageEvent['status'],
    message?: string,
    error?: string,
    boundPort?: number,
    timedOut?: boolean,
): StageEvent {
    return { stage, status, message, error, boundPort, timedOut };
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

export class QuickStartServiceImpl {
    /** Per-alias runtime state (WI-2). See {@link InstanceRuntimeState}. */
    private readonly instances = new Map<string, InstanceRuntimeState>();

    /** Lazily get (creating a NotInstalled default for) an alias's runtime state. */
    private stateFor(alias: string): InstanceRuntimeState {
        let entry = this.instances.get(alias);
        if (!entry) {
            entry = {
                alias,
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                state: InstanceState.NotInstalled,
                provisioning: false,
                lifecycleBusy: false,
                missing: false,
            };
            this.instances.set(alias, entry);
        }
        return entry;
    }

    private readonly statusEmitter = new vscode.EventEmitter<void>();
    /** Fires whenever the managed-instance status changes (drives the tree). */
    public readonly onDidChangeStatus = this.statusEmitter.event;

    /**
     * @param runtime Docker IO surface (WI-0). Defaults to the shared {@link ContainerRuntime}
     * singleton; tests inject a mock so the state machine runs with no real daemon.
     */
    constructor(private readonly runtime: IContainerRuntime = ContainerRuntime) {}

    public getStatus(alias: string = DEFAULT_ALIAS): QuickStartStatus {
        const entry = this.stateFor(alias);
        return {
            state: entry.state,
            metadata: entry.metadata,
            errorMessage: entry.errorMessage,
            missing: entry.missing,
            // Only "resumable" once the provision/resume has settled (not mid-wait): pendingReadiness
            // is set BEFORE the probe, so gating on the busy flags keeps a reopened panel from
            // offering "Wait longer" while setup is still actively running (gpt-5.5).
            canResumeReadiness: !entry.provisioning && !entry.lifecycleBusy && entry.pendingReadiness !== undefined,
        };
    }

    /** Snapshot of every known instance for the tree (WI-3), ordered DEFAULT first then by alias. */
    public listStatuses(): InstanceStatus[] {
        this.stateFor(DEFAULT_ALIAS); // ensure the default is always represented
        const entries = [...this.instances.values()].sort((a, b) => {
            if (a.alias === b.alias) {
                return 0;
            }
            if (a.alias === DEFAULT_ALIAS) {
                return -1;
            }
            if (b.alias === DEFAULT_ALIAS) {
                return 1;
            }
            return a.alias.localeCompare(b.alias);
        });
        return entries.map((entry) => this.toInstanceStatus(entry));
    }

    private toInstanceStatus(entry: InstanceRuntimeState): InstanceStatus {
        return {
            alias: entry.alias,
            displayName: entry.displayName,
            state: entry.state,
            missing: entry.missing,
            port: entry.metadata?.boundPort ?? entry.port,
            errorMessage: entry.errorMessage,
            canResumeReadiness: !entry.provisioning && !entry.lifecycleBusy && entry.pendingReadiness !== undefined,
            metadata: entry.metadata,
        };
    }

    /** Legacy single-instance busy getter (kept for the router until WI-4). */
    public get isBusy(): boolean {
        return this.stateFor(DEFAULT_ALIAS).provisioning;
    }

    /** Alias-scoped busy check (WI-3/4/5). */
    public isBusyFor(alias: string): boolean {
        return this.stateFor(alias).provisioning;
    }

    public dispose(): void {
        this.statusEmitter.dispose();
    }

    private setStatus(alias: string, state: InstanceState, metadata?: InstanceMetadata, errorMessage?: string): void {
        const entry = this.stateFor(alias);
        entry.state = state;
        if (metadata !== undefined) {
            entry.metadata = metadata;
            entry.port = metadata.boundPort;
        }
        entry.errorMessage = errorMessage;
        entry.missing = false;
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
    public async *provision(signal: AbortSignal, options?: AdvancedQuickStartOptions): AsyncGenerator<StageEvent> {
        if (this.stateFor(DEFAULT_ALIAS).provisioning || this.stateFor(DEFAULT_ALIAS).lifecycleBusy) {
            yield stageEvent('error', 'error', 'Setup is already in progress.', 'Setup is already in progress.');
            return;
        }
        this.stateFor(DEFAULT_ALIAS).provisioning = true;
        // Starting a fresh run supersedes any container left running by a prior readiness
        // timeout — drop its retained "Wait longer" state (the run below removes the container).
        this.stateFor(DEFAULT_ALIAS).pendingReadiness = undefined;
        // The alias this provision targets. WI-2c derives the container/volume/keys from it (still
        // DEFAULT, so behavior is unchanged); WI-2e allocates a fresh alias here for `+ New`.
        const alias = DEFAULT_ALIAS;
        const channel = getQuickStartOutputChannel();
        // Decide reuse from LIVE durable state, not the in-memory Missing flag: whenever we
        // still hold the instance's stored credentials (SecretStorage), a data volume bound to
        // them may exist on disk — even after the container was removed externally or across a
        // window reload that cleared in-memory state (§6.1, §12). Adopt those credentials and
        // KEEP the volume rather than wiping it; the stored credentials are what opens the
        // volume's cluster, so freshly generated ones would fail against existing data. Only
        // when NO credentials are recoverable is a clean wipe safe (the volume could not be
        // opened anyway). This makes a true fresh provision the explicit Delete-then-recreate
        // path, so running setup again can never silently destroy an existing data volume.
        const reusable = await this.getReusableCredentials(alias);
        const reusing = reusable !== undefined;
        const credentials = reusable ?? resolveProvisionCredentials(options);
        const secrets: string[] = [credentials.password];

        // Advanced overrides (P1-4). When reusing an existing instance we keep its data volume,
        // so custom credentials AND a custom image tag are intentionally IGNORED: the stored
        // credentials are required to open the volume's cluster, and recreating onto it with a
        // different (especially older) image version could leave the on-disk cluster unusable.
        // The original image is reused — from in-memory metadata, falling back to the durable
        // globalState record (survives a window reload), then the default if neither is known.
        const usedCustomCreds = !reusing && !!(options?.username?.trim() && options?.password?.trim());
        const imageRef = reusing
            ? (this.stateFor(DEFAULT_ALIAS).metadata?.imageRef ??
              ext.context.globalState.get<string>(imageRefKey(alias)) ??
              (alias === DEFAULT_ALIAS ? ext.context.globalState.get<string>(LEGACY_IMAGE_REF_KEY) : undefined) ??
              QUICK_START_IMAGE)
            : resolveQuickStartImage(options?.imageTag);
        const usedCustomImage = !reusing && imageRef !== QUICK_START_IMAGE;
        const explicitPort = typeof options?.port === 'number' ? options.port : undefined;
        const sampleDataRequested = options?.loadSampleData !== false;
        const cts = new vscode.CancellationTokenSource();
        const onAbort = (): void => cts.cancel();
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            cts.cancel();
        }

        let containerId: string | undefined;
        let containerCreated = false;
        let createAttempted = false;
        let envFilePath: string | undefined;
        let success = false;
        let portFallback = false;
        let readinessTimedOut = false;
        // The terminal StageEvent (timeout OR hard error) is buffered and yielded AFTER `finally`
        // runs, so by the time the webview shows "Wait longer" / "Retry" the service flags
        // (provisioning/lifecycleBusy) are already clean — otherwise a fast click could hit the
        // "already in progress" guard (opus-4.7).
        let terminalEvent: StageEvent | undefined;
        const provisionStartedAt = Date.now();

        try {
            this.setStatus(DEFAULT_ALIAS, InstanceState.Provisioning, undefined, undefined);

            // --- checking ---
            yield stageEvent('checking', 'active', 'Checking Docker…');
            const readiness = await this.runtime.isDockerReady();
            this.throwIfAborted(signal);
            if (!readiness.cliInstalled || !readiness.daemonReachable) {
                const message = !readiness.cliInstalled
                    ? 'Docker CLI was not found on your PATH. Install Docker and retry.'
                    : 'Docker is installed but the daemon is not reachable. Start Docker and retry.';
                this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, message);
                yield stageEvent('checking', 'error', message, message);
                return;
            }

            // Remove a pre-existing managed container so the run starts clean (it is labelled as
            // ours, D9). When NOT reusing (no recoverable credentials) also drop any stale data
            // volume, so the new credentials initialize a clean cluster. When reusing, the volume is
            // intentionally KEPT so existing data survives the recreate.
            const existing = await this.findManagedContainer(alias);
            // RR4 / §5.2 volume-wipe gate: NEVER silently destroy an existing instance's data when we
            // can't recover its credentials. A credential-unavailable instance (a managed container
            // and/or a durable `ready` record, but no readable secret) must be explicitly Deleted —
            // not wiped by a Set-up/recreate click. Only a truly-fresh alias (no managed container AND
            // no `ready` record) may reach the wipe below (where it is a safe no-op / clean slate). A
            // dead failed-attempt orphan has NO managed container (provision's `finally` removed it)
            // and no `ready` record, so retrying it still works.
            if (!reusing) {
                const hasReadyRecord = readRegistry(ext.context.globalState).instances.some(
                    (record) => record.alias === alias && record.phase === 'ready',
                );
                if (existing || hasReadyRecord) {
                    this.setStatus(alias, InstanceState.CredentialsMissing, undefined, credentialUnavailableMessage());
                    yield stageEvent(
                        'checking',
                        'error',
                        credentialUnavailableMessage(),
                        credentialUnavailableMessage(),
                    );
                    return;
                }
            }
            if (existing) {
                channel.appendLine(`Removing existing Quick Start container ${existing.id} for a clean run…`);
                await this.runtime.removeContainer(existing.id).catch(() => undefined);
            }
            if (!reusing) {
                await this.runtime.removeVolume(volumeName(alias)).catch(() => undefined);
            }

            // Pick a host port (design §8.3). An explicit Advanced port is honored exactly:
            // a conflict ERRORS (never auto-relocated, P0-2). Otherwise prefer the canonical
            // port and fall back to a random free port in the band, noting the substitution.
            let chosenPort: number;
            let portFallbackNote: string | undefined;
            if (explicitPort !== undefined) {
                if (!(await this.runtime.isPortFree(explicitPort))) {
                    const message = `Port ${explicitPort} is already in use. Choose a different port or free it, then retry.`;
                    this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, message);
                    yield stageEvent('checking', 'error', message, message);
                    return;
                }
                this.throwIfAborted(signal);
                chosenPort = explicitPort;
            } else {
                const available = await this.runtime.findAvailablePort(QUICK_START_PORT);
                this.throwIfAborted(signal);
                if (available === undefined) {
                    const message = `Ports ${QUICK_START_PORT}-${QUICK_START_PORT_BAND_END - 1} are all in use. Free one and retry.`;
                    this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, message);
                    yield stageEvent('checking', 'error', message, message);
                    return;
                }
                chosenPort = available;
                if (chosenPort !== QUICK_START_PORT) {
                    portFallback = true;
                    portFallbackNote = l10n.t(
                        'Port {0} was busy, using {1} instead.',
                        String(QUICK_START_PORT),
                        String(chosenPort),
                    );
                    channel.appendLine(portFallbackNote);
                }
            }
            yield stageEvent('checking', 'done', portFallbackNote);

            // --- pulling ---
            yield stageEvent('pulling', 'active', 'Pulling the official image…');
            await this.runtime.pullImage(imageRef, cts.token);
            this.throwIfAborted(signal);
            yield stageEvent('pulling', 'done');

            // --- creating (docker run -d creates and starts) ---
            yield stageEvent('creating', 'active', 'Creating container…');
            createAttempted = true;
            // Write credentials to a temp env-file (deleted in finally) so they never
            // appear on the docker CLI / host process list (design §8.2). The image
            // reads USERNAME/PASSWORD from the environment.
            envFilePath = await this.writeEnvFile(credentials.username, credentials.password);
            containerId = await this.runtime.createAndRunContainer(
                {
                    imageRef: imageRef,
                    name: containerName(alias),
                    labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: alias },
                    hostPort: chosenPort,
                    containerPort: QUICK_START_PORT,
                    // Persist data across recreation (§8/§11).
                    volumeName: volumeName(alias),
                    dataPath: QUICK_START_DATA_PATH,
                    // Credentials via env-file (§8.2), not CLI args. We also do NOT bake
                    // `--init-data true`: it re-runs the sample-data init on every
                    // Stop/Start and crashes on duplicate keys; sample data is seeded
                    // once, post-readiness, via `docker exec` (see seedSampleData).
                    environmentFiles: [envFilePath],
                },
                secrets,
                cts.token,
            );
            containerCreated = true;
            if (!containerId) {
                const item = await this.runtime.inspectContainer(containerName(alias));
                containerId = item?.id ?? containerName(alias);
            }
            this.throwIfAborted(signal);
            yield stageEvent('creating', 'done');

            // --- starting (confirm running, read bound port, follow logs) ---
            yield stageEvent('starting', 'active', 'Starting container…');
            const inspected = await this.runtime.inspectContainer(containerId);
            // Fall back to the port we actually requested (not the canonical default) if the
            // inspect can't report the binding, so a custom port stays correct in the success
            // message + stored connection string.
            const boundPort = (inspected && getBoundHostPort(inspected)) || chosenPort;
            // Stream container logs to the channel during the wait (compensates for -dt detach, D2).
            void this.runtime.followLogs(containerId, secrets, cts.token);
            yield stageEvent('starting', 'done');

            // --- waiting (wire-protocol readiness, D7) ---
            yield stageEvent('waiting', 'active', 'Waiting for DocumentDB to accept connections…');
            const connectionString = composeConnectionString(credentials.username, credentials.password, boundPort);
            // Retain everything a "Wait longer" resume needs BEFORE probing, so a readiness
            // timeout can keep this running container and finish adoption later (§9.1).
            const pending: PendingReadiness = {
                alias,
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                containerId,
                connectionString,
                boundPort,
                username: credentials.username,
                password: credentials.password,
                imageRef,
                sampleDataRequested,
                reusing,
            };
            this.stateFor(DEFAULT_ALIAS).pendingReadiness = pending;
            await this.waitForReadiness(connectionString, signal);
            this.throwIfAborted(signal);

            // --- success (seed sample data, store creds, adopt as Running) ---
            await this.finalizeReadyInstance(pending, cts.token, signal);
            success = true;
            yield stageEvent('waiting', 'done');
            yield stageEvent(
                'done',
                'done',
                `DocumentDB Local is running on localhost:${boundPort}.`,
                undefined,
                boundPort,
            );
        } catch (error) {
            const aborted = signal.aborted;
            const message = aborted ? 'Setup was cancelled.' : errMessage(error);
            if (!aborted && error instanceof ReadinessTimeoutError && containerCreated && containerId) {
                // The container is running but the database did not accept connections within the
                // window — it may still be initializing. KEEP it running (finally skips teardown)
                // and surface the on-timeout actions (§9.1); the retained pendingReadiness lets a
                // "Wait longer" resume finish adoption. The instance sits in Error until then. The
                // event is buffered and emitted after `finally` (see below) so the flags are clean.
                readinessTimedOut = true;
                this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, message);
                terminalEvent = stageEvent('waiting', 'error', message, message, undefined, /* timedOut */ true);
            } else {
                // Any other failure (or cancel) discards the attempt — drop the retained state so a
                // stale timeout can't offer "Wait longer" against a container we're about to remove.
                this.stateFor(DEFAULT_ALIAS).pendingReadiness = undefined;
                if (!aborted) {
                    this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, message);
                }
                // Buffered and emitted after `finally` (like the timeout event) so a Retry click
                // driven by this event can't race the still-set `provisioning` guard either
                // (opus-4.7). On unsubscribe/return() the post-finally yield is simply skipped.
                terminalEvent = stageEvent('error', 'error', message, aborted ? undefined : message);
            }
        } finally {
            // Stop the followLogs stream (started with cts.token). Disposing alone
            // does NOT signal cancellation — only cancel() stops `docker logs -f`.
            cts.cancel();
            if (!success && !readinessTimedOut) {
                // Cleanup (D12): when a container exists, stop+remove it.
                if (containerCreated && containerId) {
                    channel.appendLine(`Cleaning up container ${containerId}…`);
                    await this.runtime.stopContainer(containerId).catch(() => undefined);
                    await this.runtime.removeContainer(containerId).catch(() => undefined);
                } else if (createAttempted && !containerId) {
                    // The CLI may have been killed after the daemon created the
                    // container but before its id was captured — sweep by label.
                    const orphan = await this.findManagedContainer();
                    if (orphan) {
                        channel.appendLine(`Removing orphaned container ${orphan.id}…`);
                        await this.runtime.removeContainer(orphan.id).catch(() => undefined);
                    }
                }
                // Interrupted before settling (cancel / unsubscribe) → reset state.
                // The error path already settled to `Error` in `catch`.
                if (this.stateFor(DEFAULT_ALIAS).state === InstanceState.Provisioning) {
                    this.setStatus(DEFAULT_ALIAS, InstanceState.NotInstalled, undefined, undefined);
                }
            }
            signal.removeEventListener('abort', onAbort);
            cts.dispose();
            // Delete the temp env-file (it carried the password in plaintext, §8.2).
            if (envFilePath) {
                await fs.rm(envFilePath, { force: true }).catch(() => undefined);
            }
            // Provisioning outcome telemetry (design §14): result + whether we reused a
            // prior volume/creds + whether a port fallback was used + total duration, plus
            // which Advanced overrides were exercised (booleans only — never names/ports/creds).
            const provisionResult = success
                ? 'success'
                : signal.aborted
                  ? 'cancelled'
                  : readinessTimedOut
                    ? 'timeout'
                    : 'error';
            void callWithTelemetryAndErrorHandling('documentDB.quickstart.provision', (telemetryContext) => {
                telemetryContext.errorHandling.suppressDisplay = true;
                telemetryContext.telemetry.properties.provisionResult = provisionResult;
                telemetryContext.telemetry.properties.reused = String(reusing);
                telemetryContext.telemetry.properties.portFallback = String(portFallback);
                telemetryContext.telemetry.properties.customPort = String(explicitPort !== undefined);
                telemetryContext.telemetry.properties.customCreds = String(usedCustomCreds);
                telemetryContext.telemetry.properties.customImage = String(usedCustomImage);
                telemetryContext.telemetry.properties.sampleData = String(sampleDataRequested);
                telemetryContext.telemetry.measurements.provisionMs = Date.now() - provisionStartedAt;
            });
            this.stateFor(DEFAULT_ALIAS).provisioning = false;
        }
        // Emitted only now — after `finally` cleared `provisioning` — so a "Wait longer" / "Start
        // over" / "Retry" click triggered by this event never races the still-running guard.
        if (terminalEvent) {
            yield terminalEvent;
        }
    }

    /**
     * Finish adopting a container whose database has accepted connections: seed sample data
     * (best-effort, once), persist credentials + the durable image record, refresh the client
     * cache, and mark the instance Running. Shared by {@link provision} and
     * {@link resumeReadiness} so both settle a ready instance identically. Clears
     * {@link pendingReadiness}. Does NOT yield — callers own the terminal StageEvents and the
     * `success` flag so their `finally` teardown ordering is preserved.
     */
    private async finalizeReadyInstance(
        pending: PendingReadiness,
        token: vscode.CancellationToken,
        signal: AbortSignal,
    ): Promise<void> {
        // Seed the image's built-in sample data ONCE — only when requested (Advanced "Load
        // sample data", default on) and not already present (idempotent, so recreating onto an
        // existing volume doesn't re-run the init and hit duplicate keys). Best-effort.
        if (pending.sampleDataRequested && !(await this.sampleDataExists(pending.connectionString))) {
            await this.seedSampleData(pending.containerId, [pending.password], token);
        }
        this.throwIfAborted(signal);
        await ext.secretStorage.store(secretKey(pending.alias), pending.connectionString);
        // Durably remember the image this instance's volume was created with, so a recreate
        // after a window reload (in-memory metadata gone) keeps the same image.
        await ext.context.globalState.update(imageRefKey(pending.alias), pending.imageRef);
        // Make the registry authoritative: this instance is now ready on its bound port.
        // (WI-2 reads the registry to enumerate instances.)
        await upsertInstanceRecord(ext.context.globalState, {
            alias: pending.alias,
            displayName: pending.displayName,
            port: pending.boundPort,
            phase: 'ready',
        });
        // Drop any stale client cached under this id (e.g. from a prior run with different
        // credentials) so the next browse uses the fresh credentials.
        await ClustersClient.deleteClient(clusterId(pending.alias)).catch(() => undefined);
        this.populateCredentialCache(pending.alias, pending.connectionString, pending.username, pending.password);
        this.setStatus(
            pending.alias,
            InstanceState.Running,
            {
                containerId: pending.containerId,
                alias: pending.alias,
                boundPort: pending.boundPort,
                clusterId: clusterId(pending.alias),
                connectionString: pending.connectionString,
                username: pending.username,
                imageRef: pending.imageRef,
            },
            undefined,
        );
        this.stateFor(pending.alias).pendingReadiness = undefined;
    }

    /**
     * "Wait longer" (§9.1): re-probe the container retained from a readiness timeout for another
     * window and finish adoption if it becomes ready — WITHOUT tearing it down and re-pulling.
     * On another timeout the container is kept and the on-timeout actions are surfaced again; on
     * a hard error the container is still kept so the user can retry or Start over.
     */
    public async *resumeReadiness(signal: AbortSignal): AsyncGenerator<StageEvent> {
        const pending = this.stateFor(DEFAULT_ALIAS).pendingReadiness;
        if (!pending) {
            yield stageEvent('error', 'error', 'There is nothing to resume.', 'There is nothing to resume.');
            return;
        }
        if (this.stateFor(DEFAULT_ALIAS).provisioning || this.stateFor(DEFAULT_ALIAS).lifecycleBusy) {
            // A prior resume/provision may still be unwinding (its abort can take a few seconds to
            // observe). Carry the timed-out affordance so the webview keeps the Wait longer / Start
            // over view instead of flipping to the generic error (opus-4.8) — the container and
            // `pendingReadiness` are still retained.
            yield stageEvent(
                'error',
                'error',
                'A setup operation is already in progress.',
                'in progress',
                undefined,
                true,
            );
            return;
        }
        this.stateFor(DEFAULT_ALIAS).provisioning = true;
        const cts = new vscode.CancellationTokenSource();
        const onAbort = (): void => cts.cancel();
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            cts.cancel();
        }
        const resumeStartedAt = Date.now();
        let finalized = false;
        let terminalEvent: StageEvent | undefined;
        let resumeResult: 'success' | 'timeout' | 'cancelled' | 'error' = 'error';
        try {
            this.setStatus(DEFAULT_ALIAS, InstanceState.Provisioning, undefined, undefined);
            yield stageEvent('waiting', 'active', 'Waiting for DocumentDB to accept connections…');
            // Stream the container's logs during THIS wait so "View Docker output" shows the live
            // startup rather than only the stale first-attempt output (opus-4.8).
            void this.runtime.followLogs(pending.containerId, [pending.password], cts.token);
            await this.waitForReadiness(pending.connectionString, signal);
            this.throwIfAborted(signal);
            await this.finalizeReadyInstance(pending, cts.token, signal);
            finalized = true;
            resumeResult = 'success';
            yield stageEvent('waiting', 'done');
            terminalEvent = stageEvent(
                'done',
                'done',
                `DocumentDB Local is running on localhost:${pending.boundPort}.`,
                undefined,
                pending.boundPort,
            );
        } catch (error) {
            // Keep offering the on-timeout actions only when the container is genuinely still just
            // initializing (another timeout) or the user cancelled the wait. A hard failure inside
            // finalize (e.g. secretStorage) is a real error — surface it instead of a misleading
            // "keep waiting" loop (opus-4.6 / gpt-5.5). `finalized` defensively guards the
            // (transport-impossible) case of a throw after adoption already succeeded.
            const aborted = signal.aborted;
            const isTimeout = error instanceof ReadinessTimeoutError;
            const timedOut = !finalized && (isTimeout || aborted);
            resumeResult = aborted ? 'cancelled' : isTimeout ? 'timeout' : 'error';
            const message = aborted
                ? 'Still initializing. Keep waiting, view the logs, or start over.'
                : errMessage(error);
            if (!finalized) {
                this.setStatus(DEFAULT_ALIAS, InstanceState.Error, undefined, aborted ? undefined : message);
            }
            // A hard finalize error is NOT a timeout — drop the retained state so reopening the
            // panel shows the real error (via a fresh setup) rather than a misleading "Wait longer"
            // (gpt-5.5). Timeout/cancel keep pendingReadiness so the container stays resumable.
            if (!timedOut) {
                this.stateFor(DEFAULT_ALIAS).pendingReadiness = undefined;
            }
            terminalEvent = stageEvent('waiting', 'error', message, aborted ? undefined : message, undefined, timedOut);
        } finally {
            signal.removeEventListener('abort', onAbort);
            // Stop the followLogs stream (started with cts.token) before disposing.
            cts.cancel();
            cts.dispose();
            this.stateFor(DEFAULT_ALIAS).provisioning = false;
            // §14: resume outcome — booleans/enum + duration only, never names/ports/creds.
            void callWithTelemetryAndErrorHandling('documentDB.quickstart.resumeReadiness', (telemetryContext) => {
                telemetryContext.errorHandling.suppressDisplay = true;
                telemetryContext.telemetry.properties.resumeResult = resumeResult;
                telemetryContext.telemetry.measurements.resumeMs = Date.now() - resumeStartedAt;
            });
        }
        // Emitted after `finally` cleared `provisioning`, so a follow-up Wait longer / Start over
        // click triggered by this event never races the still-running guard (opus-4.7).
        if (terminalEvent) {
            yield terminalEvent;
        }
    }

    /**
     * "Start over" from a readiness timeout (§9.1): remove the container retained by the timeout
     * and, for a fresh (non-reusing) attempt, wipe its half-initialized data volume for a clean
     * slate. A reusing attempt's volume holds the user's existing data, so it is kept. Returns to
     * NotInstalled so the user can run setup again. Returns `false` (a no-op) when nothing is
     * discardable yet — e.g. a just-cancelled resume is still unwinding — so the webview can keep
     * the timed-out actions instead of dropping to review with the container still running.
     */
    public async discardTimedOutInstance(): Promise<boolean> {
        const entry = this.stateFor(DEFAULT_ALIAS);
        // Guard BEFORE mutating: if a provision/lifecycle op is running, leave the retained
        // state untouched (clearing it here would orphan the still-running container).
        if (entry.provisioning || entry.lifecycleBusy || !entry.pendingReadiness) {
            return false;
        }
        const pending = entry.pendingReadiness;
        entry.pendingReadiness = undefined;
        entry.lifecycleBusy = true;
        try {
            await this.runtime.stopContainer(pending.containerId).catch(() => undefined);
            await this.runtime.removeContainer(pending.containerId).catch(() => undefined);
            if (!pending.reusing) {
                await this.runtime.removeVolume(volumeName(pending.alias)).catch(() => undefined);
            }
            this.setStatus(DEFAULT_ALIAS, InstanceState.NotInstalled, undefined, undefined);
            return true;
        } finally {
            entry.lifecycleBusy = false;
        }
    }

    /** Probe the wire protocol until the DB answers `ping`, up to {@link READINESS_TIMEOUT_MS}. */
    private async waitForReadiness(connectionString: string, signal: AbortSignal): Promise<void> {
        const deadline = Date.now() + READINESS_TIMEOUT_MS;
        let attempt = 0;
        let lastError: unknown;
        while (Date.now() < deadline) {
            this.throwIfAborted(signal);
            // A bounded per-attempt timeout keeps Cancel responsive (~3s) — the
            // connection string already carries tls/allow-invalid for the local image.
            const client = new MongoClient(connectionString, {
                serverSelectionTimeoutMS: PROBE_SERVER_SELECTION_TIMEOUT_MS,
                tlsAllowInvalidCertificates: true,
            });
            try {
                await client.connect();
                await client.db('admin').command({ ping: 1 });
                return;
            } catch (error) {
                lastError = error;
            } finally {
                await client.close().catch(() => undefined);
            }
            attempt += 1;
            const backoff = Math.min(3000, 500 + attempt * 250);
            await delay(backoff, signal);
        }
        throw new ReadinessTimeoutError(
            `Timed out waiting for DocumentDB to accept connections.${lastError ? ` (${errMessage(lastError)})` : ''}`,
        );
    }

    /**
     * Seed the image's built-in sample data ONCE by running its native init
     * script inside the container (`docker exec`). Best-effort and non-fatal: the
     * instance is fully usable without sample data, so any failure is logged to the
     * Quick Start channel and swallowed rather than failing provisioning.
     *
     * The credentials are referenced from the CONTAINER's own environment
     * (`$USERNAME`/`$PASSWORD`, set via the `--env-file` at run) inside the `sh -c`
     * script, so they never appear on the HOST docker CLI argv / process list (§8.2) and
     * are never subject to host-shell quoting or expansion (e.g. Windows `cmd.exe`
     * `%VAR%`). {@link ContainerRuntime.execShellInContainer} strong-quotes the script so
     * the host shell passes the `$VAR` references through verbatim and the container's own
     * shell performs the expansion. The interpolated values are all constants — no user
     * input reaches the script.
     */
    private async seedSampleData(
        containerId: string,
        secrets: ReadonlyArray<string>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        try {
            const script = `${SAMPLE_DATA_INIT_SCRIPT} -H localhost -P ${QUICK_START_PORT} -u "$USERNAME" -p "$PASSWORD" -d ${SAMPLE_DATA_DIR}`;
            await this.runtime.execShellInContainer(containerId, script, secrets, token);
        } catch (error) {
            getQuickStartOutputChannel().appendLine(`Sample data load skipped: ${errMessage(error)}`);
        }
    }

    /**
     * Whether the sample database is already present, so seeding can be skipped
     * (idempotent — a recreate onto an existing volume must not re-run the init).
     */
    private async sampleDataExists(connectionString: string): Promise<boolean> {
        const client = new MongoClient(connectionString, {
            serverSelectionTimeoutMS: PROBE_SERVER_SELECTION_TIMEOUT_MS,
            tlsAllowInvalidCertificates: true,
        });
        try {
            await client.connect();
            const dbs = await client.db().admin().listDatabases();
            return dbs.databases.some((db) => db.name === SAMPLE_DATA_DB);
        } catch {
            return false;
        } finally {
            await client.close().catch(() => undefined);
        }
    }

    /**
     * True when a provision would REUSE an existing instance rather than create a fresh one:
     * i.e. usable stored credentials exist (so the data volume is kept and any custom
     * credentials / image tag would be ignored). Mirrors the `reusing` decision in
     * {@link provision} so the webview can hide the credential/image inputs and show the
     * recreate summary whenever — and only when — the service will actually reuse, regardless
     * of the in-memory `Missing` badge. Public so the `getDockerStatus` query can surface it.
     */
    public async willReuseExistingInstance(): Promise<boolean> {
        return (await this.getReusableCredentials()) !== undefined;
    }

    /**
     * Recover the stored credentials of a Missing instance so a recreate reuses
     * them against the existing data volume (§6.1). Returns undefined if no usable
     * stored connection string exists (caller then generates fresh credentials).
     */
    /**
     * Read the default instance's stored connection string, falling back to the legacy flat key.
     * Belt-and-suspenders: the activation migration (§6) normally copies the legacy value to the
     * alias-keyed secret BEFORE any read, but if a destructive path ever ran pre-migration this
     * prevents a spurious "no credentials → wipe" (R1).
     */
    private async readStoredConnectionString(alias: string = DEFAULT_ALIAS): Promise<string | undefined> {
        const stored = await ext.secretStorage.get(secretKey(alias));
        if (stored !== undefined) {
            return stored;
        }
        // The legacy flat key only ever held the DEFAULT instance's pre-alias credentials.
        return alias === DEFAULT_ALIAS ? await ext.secretStorage.get(LEGACY_SECRET_KEY) : undefined;
    }

    private async getReusableCredentials(alias: string = DEFAULT_ALIAS): Promise<GeneratedCredentials | undefined> {
        try {
            const stored = await this.readStoredConnectionString(alias);
            if (!stored) {
                return undefined;
            }
            const parsed = new DocumentDBConnectionString(stored);
            const username = parsed.username;
            const password = parsed.password;
            if (!username || !password) {
                return undefined;
            }
            return { username, password };
        } catch {
            return undefined;
        }
    }

    /**
     * Write credentials to a temp `--env-file` (mode 600) so they are passed to the
     * container off the command line / process list (§8.2). The caller deletes it in
     * a `finally`. The `--env-file` format is line-based `KEY=VALUE` with no quoting,
     * so a newline (or other control char) in a value would inject extra environment
     * variables. Auto-generated credentials use the URL-safe alphabet; custom Advanced
     * credentials are control-char-validated at the router boundary, and this guard is
     * the defense-in-depth backstop.
     */
    private async writeEnvFile(username: string, password: string): Promise<string> {
        // eslint-disable-next-line no-control-regex
        const hasControlChar = /[\u0000-\u001f\u007f]/;
        if (hasControlChar.test(username) || hasControlChar.test(password)) {
            throw new Error('Credentials must not contain control characters.');
        }
        const filePath = path.join(os.tmpdir(), `documentdb-quickstart-${crypto.randomBytes(8).toString('hex')}.env`);
        await fs.writeFile(filePath, `USERNAME=${username}\nPASSWORD=${password}\n`, { mode: 0o600 });
        return filePath;
    }

    private async findManagedContainer(alias: string = DEFAULT_ALIAS): Promise<{ id: string } | undefined> {
        const list = await this.runtime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' }).catch(() => []);
        return list.find((container: { id: string; labels?: Record<string, string> }) =>
            this.aliasMatches(container.labels?.[QUICK_START_ALIAS_LABEL_KEY], alias),
        );
    }

    /**
     * A container belongs to `alias` when its `vscode.documentdb.alias` label equals `alias`. A
     * pre-alias-label *legacy* container (no/empty alias label) belongs to the DEFAULT instance, so
     * an existing single instance is still found/adopted with no rename (WI-2c, behavior-preserving).
     */
    private aliasMatches(aliasLabelValue: string | undefined, alias: string): boolean {
        if (aliasLabelValue === alias) {
            return true;
        }
        return alias === DEFAULT_ALIAS && (aliasLabelValue === undefined || aliasLabelValue === '');
    }

    /**
     * Pre-populate the in-memory CredentialCache so the inline tree cluster item
     * connects without re-prompting. `DocumentDBClusterItem.getChildren` takes the
     * cached path when `CredentialCache.hasCredentials(clusterId)` is true.
     */
    private populateCredentialCache(alias: string, connectionString: string, username: string, password: string): void {
        CredentialCache.setAuthCredentials(
            clusterId(alias),
            AuthMethodId.NativeAuth,
            connectionString,
            { connectionUser: username, connectionPassword: password },
            { isEmulator: true, disableEmulatorSecurity: true },
        );
    }

    /**
     * Ownership predicate (design §9/§13.1): true only when an already-inspected container carries
     * the Quick Start label AND matches `alias`. Never touch a container that fails this — even if
     * the id/name matches — so we can only ever act on containers the extension created (#9). Pure
     * (no Docker I/O) so callers that already hold an inspect result don't inspect twice.
     */
    private isOwnedContainer(item: Awaited<ReturnType<IContainerRuntime['inspectContainer']>>, alias: string): boolean {
        return (
            !!item &&
            item.labels?.[QUICK_START_LABEL_KEY] === '1' &&
            this.aliasMatches(item.labels?.[QUICK_START_ALIAS_LABEL_KEY], alias)
        );
    }

    /**
     * Guard a lifecycle op (start/stop/restart) on `id`: confirm the container still exists, is
     * OURS (label-checked, D9/§9), and is in one of `allowed` live states. On any mismatch it
     * refreshes the tree and shows a message, then returns false so the caller aborts. A single
     * inspect distinguishes the three failure modes so none is a silent no-op (UX review #2):
     *
     *  - **missing** (removed outside VS Code): refresh to the `Missing` badge — which itself
     *    carries Recreate/Delete — and tell the user, instead of early-returning silently while a
     *    stale "Stopped" row lingers.
     *  - **foreign** (the id no longer carries our label — e.g. a different container reused it):
     *    refuse; we never act on a container we did not create.
     *  - **wrong live state** (another window already started/stopped it): the multi-window
     *    "changed in another window" refresh.
     */
    private async ensureActionable(
        id: string,
        alias: string,
        allowed: ReadonlyArray<'running' | 'stopped'>,
    ): Promise<boolean> {
        const item = await this.runtime.inspectContainer(id);
        const entry = this.stateFor(alias);
        if (!item) {
            // Missing: deleted/pruned outside VS Code. Mark it Missing directly (the tree row then
            // offers recreate-on-click + Delete) and surface a message so the click is not a silent
            // no-op. We set the flag here rather than via refreshLiveState(), which intentionally
            // skips the currently lifecycle-busy alias — so during this op refreshLiveState() would be
            // a no-op. Recreate reuses the existing data volume, so the data is preserved.
            entry.missing = true;
            this.statusEmitter.fire();
            void vscode.window.showInformationMessage(
                l10n.t(
                    'The DocumentDB Local container was removed outside VS Code. Click the instance to recreate it (your data is preserved), or use "Delete Container" to remove it and its data.',
                ),
            );
            return false;
        }
        if (!this.isOwnedContainer(item, alias)) {
            // The stored id/name resolves to a container the extension did NOT create (D9 / #9 —
            // metadata.containerId can be the container NAME, which a foreign container may later
            // take). Never act on it, and never mark it as our Missing instance (that would route it
            // into Delete). Just warn and refuse; deleteContainer re-verifies ownership before any
            // removal as a second line of defense.
            void vscode.window.showWarningMessage(
                l10n.t(
                    'The DocumentDB Local container can no longer be managed because it was created outside the extension. Remove it with Docker if you no longer need it.',
                ),
            );
            return false;
        }
        const live: 'running' | 'stopped' = isRunning(item) ? 'running' : 'stopped';
        if (!allowed.includes(live)) {
            // Multi-window drift: another window already started/stopped it. Correct the state
            // immediately (setStatus clears missing + fires) and tell the user.
            this.setStatus(alias, live === 'running' ? InstanceState.Running : InstanceState.Stopped);
            void vscode.window.showInformationMessage(
                l10n.t(
                    'The DocumentDB Local instance changed in another window (now {0}). The view has been refreshed.',
                    live === 'running' ? l10n.t('running') : l10n.t('stopped'),
                ),
            );
            return false;
        }
        return true;
    }

    /** Start a stopped instance (design §11). */
    public async start(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, async () => {
            const id = this.stateFor(alias).metadata?.containerId;
            if (!id || !(await this.ensureActionable(id, alias, ['stopped']))) {
                return;
            }
            this.setStatus(alias, InstanceState.Starting);
            await this.runtime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(alias, InstanceState.Running);
            } else {
                this.setStatus(
                    alias,
                    InstanceState.Error,
                    undefined,
                    'The container started but exited shortly after. Check the Quick Start logs.',
                );
            }
        });
    }

    /** Stop a running instance (design §11). */
    public async stop(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, async () => {
            const id = this.stateFor(alias).metadata?.containerId;
            if (!id || !(await this.ensureActionable(id, alias, ['running']))) {
                return;
            }
            this.setStatus(alias, InstanceState.Stopping);
            await this.runtime.stopContainer(id);
            this.setStatus(alias, InstanceState.Stopped);
        });
    }

    /** Restart (stop + start) a running instance (design §11). */
    public async restart(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, async () => {
            const id = this.stateFor(alias).metadata?.containerId;
            if (!id || !(await this.ensureActionable(id, alias, ['running', 'stopped']))) {
                return;
            }
            this.setStatus(alias, InstanceState.Stopping);
            await this.runtime.stopContainer(id).catch(() => undefined);
            this.setStatus(alias, InstanceState.Starting);
            await this.runtime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(alias, InstanceState.Running);
            } else {
                this.setStatus(
                    alias,
                    InstanceState.Error,
                    undefined,
                    'The container restarted but exited shortly after. Check the Quick Start logs.',
                );
            }
        });
    }

    /**
     * After a `docker start`, confirm the container is still running a few seconds
     * later. A container that re-runs a failing entrypoint reports "running" for a
     * moment before exiting, so a single immediate inspect can be a false positive.
     */
    private async confirmStaysRunning(id: string): Promise<boolean> {
        for (let attempt = 0; attempt < START_CONFIRM_ATTEMPTS; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, START_CONFIRM_INTERVAL_MS));
            const inspected = await this.runtime.inspectContainer(id);
            if (!isRunning(inspected)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Remove the container, its data volume, and all stored metadata/credentials
     * (design §11 "Delete Container"). In v1 this is the full clean slate, since the
     * data-preserving "Reset" split is a v1.2 item; data is still preserved across
     * Stop/Start/Restart and an external-loss `Missing` → recreate (which keeps the
     * volume). Returns to NotInstalled.
     */
    public async deleteContainer(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, async () => {
            const entry = this.stateFor(alias);
            // Prefer in-memory metadata; fall back to a live lookup so Delete also removes the
            // container of a surfaced Missing / credential-unavailable instance (no metadata after
            // a reload, or when reconcile surfaced it without adopting).
            const id = entry.metadata?.containerId ?? (await this.findManagedContainer(alias))?.id;
            if (id) {
                // Hard #9 precondition: re-inspect and remove the container ONLY if it still carries
                // our label/alias — on EVERY path, including a `missing` one. metadata.containerId can
                // be a container NAME that a foreign container may later resolve to, so the old
                // `entry.missing` bypass could have removed a container the extension never created.
                const item = await this.runtime.inspectContainer(id);
                if (item) {
                    if (!this.isOwnedContainer(item, alias)) {
                        // A container we did not create now holds this id/name. Never remove it or its
                        // (possibly shared) volume — abort and let the user manage it themselves.
                        void vscode.window.showWarningMessage(
                            l10n.t(
                                'The DocumentDB Local container was not removed because it was created outside the extension. Remove it with Docker if you no longer need it.',
                            ),
                        );
                        return;
                    }
                    await this.runtime.removeContainer(id).catch(() => undefined);
                }
                // item === undefined ⇒ the container is already gone; nothing to remove. Fall through
                // to clear OUR data volume + records (the clean-slate Delete of a Missing instance).
            }
            // Explicit Delete is a full clean slate: drop the data volume too. The volume name is
            // derived from our alias, so it is ours by construction.
            await this.runtime.removeVolume(volumeName(alias)).catch(() => undefined);
            try {
                await ext.secretStorage.delete(secretKey(alias));
                // Also purge the legacy flat keys (default instance only): if an activation migration
                // failed and left them behind, an explicit Delete must still be a full clean slate (no
                // stale legacy credentials/image survive to be silently reused by a provision — opus47-N1).
                if (alias === DEFAULT_ALIAS) {
                    await ext.secretStorage.delete(LEGACY_SECRET_KEY);
                }
            } catch {
                // ignore — best-effort cleanup
            }
            await ext.context.globalState.update(imageRefKey(alias), undefined);
            if (alias === DEFAULT_ALIAS) {
                await ext.context.globalState.update(LEGACY_IMAGE_REF_KEY, undefined);
            }
            // Drop the registry record too — an explicit Delete is a full clean slate, so the
            // instance no longer appears when the tree enumerates the registry (WI-2).
            await removeInstanceRecord(ext.context.globalState, alias);
            await ClustersClient.deleteClient(clusterId(alias)).catch(() => undefined);
            CredentialCache.deleteCredentials(clusterId(alias));
            entry.metadata = undefined;
            this.setStatus(alias, InstanceState.NotInstalled);
        });
    }

    /**
     * Re-check live Docker state for the managed instance (cheap multi-window /
     * external-change freshness, design §12). Sets the `Missing` badge when we
     * hold metadata but Docker no longer has the container.
     */
    public async refreshLiveState(): Promise<void> {
        // Refresh every in-memory alias (the DEFAULT is always present). Per-alias inspect keeps the
        // consumed default path identical to the single-instance behavior; scavenge is NEVER done here
        // (reconcile/activation only) and an in-flight alias is never clobbered.
        for (const alias of new Set<string>([DEFAULT_ALIAS, ...this.instances.keys()])) {
            const entry = this.stateFor(alias);
            // Skip in-flight aliases — a busy sibling must NOT skip the others. Also skip a
            // CredentialsMissing instance: it is a terminal, user-actionable state (Delete to start
            // over) whose stale metadata must never be re-inspected back to Running/Stopped.
            if (
                entry.provisioning ||
                entry.lifecycleBusy ||
                !entry.metadata ||
                entry.state === InstanceState.CredentialsMissing
            ) {
                continue;
            }
            try {
                const containerId = entry.metadata.containerId;
                const inspected = await this.runtime.inspectContainer(containerId);
                // A concurrent deleteContainer/re-adopt may have cleared or replaced this alias's
                // metadata while we awaited — bail rather than write a stale result onto it.
                if (entry.metadata?.containerId !== containerId) {
                    continue;
                }
                if (!inspected) {
                    // Container is gone — keep metadata so the user can recreate.
                    entry.missing = true;
                    this.statusEmitter.fire();
                    continue;
                }
                const nextState = isRunning(inspected) ? InstanceState.Running : InstanceState.Stopped;
                if (entry.missing || entry.state !== nextState) {
                    this.setStatus(alias, nextState);
                }
            } catch {
                // Best-effort freshness; never throw into the tree render.
            }
        }
    }

    private async runLifecycle(alias: string, op: () => Promise<void>): Promise<void> {
        const entry = this.stateFor(alias);
        if (entry.provisioning || entry.lifecycleBusy) {
            return;
        }
        entry.lifecycleBusy = true;
        try {
            await op();
        } catch (error) {
            this.setStatus(alias, InstanceState.Error, undefined, errMessage(error));
        } finally {
            entry.lifecycleBusy = false;
        }
    }

    /**
     * Activation reconciliation (design §12 / risk-review): after a window reload the in-memory state
     * is lost while containers keep running. Enumerate every known instance — the union of the durable
     * registry and the live labelled containers (grouped by the `vscode.documentdb.alias` label; an
     * absent/empty label is the DEFAULT instance) — and rebuild each alias's state. A credential-less
     * labelled container is SURFACED, never removed (R2); a stale pre-create reservation (crashed host)
     * is scavenged; a ready record whose container vanished becomes Missing (recoverable via recreate).
     */
    public async reconcile(): Promise<void> {
        try {
            const containers = (await this.runtime
                .listByLabel({ [QUICK_START_LABEL_KEY]: '1' })
                .catch(() => [])) as Array<{
                id: string;
                createdAt?: Date;
                labels?: Record<string, string>;
            }>;
            const registry = readRegistry(ext.context.globalState);
            const now = Date.now();

            // Group live containers by alias (absent/empty alias label ⇒ DEFAULT).
            const liveByAlias = new Map<string, Array<{ id: string; createdAt?: Date }>>();
            for (const container of containers) {
                const alias = container.labels?.[QUICK_START_ALIAS_LABEL_KEY] || DEFAULT_ALIAS;
                const bucket = liveByAlias.get(alias);
                if (bucket) {
                    bucket.push(container);
                } else {
                    liveByAlias.set(alias, [container]);
                }
            }

            // The DEFAULT always exists; also reconcile every registry record and every live alias.
            const aliases = new Set<string>([
                DEFAULT_ALIAS,
                ...registry.instances.map((record) => record.alias),
                ...liveByAlias.keys(),
            ]);
            const scavenge = new Set<string>();
            for (const alias of aliases) {
                const record = registry.instances.find((existing) => existing.alias === alias);
                const outcome = await this.reconcileAlias(alias, record, liveByAlias.get(alias) ?? [], now);
                if (outcome.scavenge) {
                    scavenge.add(alias);
                }
            }

            // Drop stale pre-create reservations in one locked write. Scavenge fires ONLY here
            // (activation), never in the per-render refreshLiveState. (Adopted instances promote their
            // own record to `ready` inside adoptContainer.) Re-validate staleness INSIDE the lock so a
            // record that a concurrent finalize/adopt just promoted to `ready` (or refreshed the lease
            // on) is never dropped — only remove one that is still a stale `provisioning` reservation.
            if (scavenge.size > 0) {
                await updateRegistry(ext.context.globalState, (reg) => {
                    const scavengeNow = Date.now();
                    reg.instances = reg.instances.filter(
                        (record) =>
                            !(
                                scavenge.has(record.alias) &&
                                record.phase === 'provisioning' &&
                                !isProvisioningLeaseFresh(record, scavengeNow)
                            ),
                    );
                });
            }
        } catch {
            // Reconciliation is best-effort; never block activation.
        }
    }

    /**
     * Reconcile one alias against its durable `record` and live `containers`. Returns registry
     * side-effects for the caller to apply under the lock. NEVER removes a labelled container (R2/R3)
     * and NEVER touches a volume.
     */
    private async reconcileAlias(
        alias: string,
        record: QuickStartInstanceRecord | undefined,
        containers: Array<{ id: string; createdAt?: Date }>,
        now: number,
    ): Promise<{ scavenge?: boolean }> {
        const winner = this.pickManagedContainer(alias, containers);
        const freshLease = record !== undefined && isProvisioningLeaseFresh(record, now);

        if (winner) {
            const stored = await this.readStoredConnectionString(alias);
            if (stored) {
                // Case 1: credentials recoverable ⇒ adopt (running→Running, exited→Stopped).
                await this.adoptContainer(alias, record, winner.id, stored);
                return {};
            }
            if (freshLease) {
                // A fresh in-flight container whose secret isn't written yet is Provisioning — never
                // credential-unavailable.
                this.setStatus(alias, InstanceState.Provisioning);
                return {};
            }
            // Case 4: labelled container + no recoverable secret + no fresh lease ⇒ surface as
            // credential-unavailable. NEVER remove it and NEVER touch its volume (R2).
            getQuickStartOutputChannel().appendLine(
                `DocumentDB Local instance "${alias}" is present but its stored credentials are missing; surfacing as credential-unavailable (not removed).`,
            );
            this.setStatus(alias, InstanceState.CredentialsMissing, undefined, credentialUnavailableMessage());
            return {};
        }

        // No live container.
        if (freshLease) {
            // Case 2: a create is genuinely in flight (its container isn't listed yet).
            this.setStatus(alias, InstanceState.Provisioning);
            return {};
        }
        if (record?.phase === 'provisioning') {
            // Stale pre-create reservation (crashed host): nothing was created ⇒ scavenge + clear.
            this.setStatus(alias, InstanceState.NotInstalled);
            return { scavenge: true };
        }
        if (record?.phase === 'ready') {
            // Case 3: a known ready instance whose container vanished ⇒ Missing (recoverable via a
            // recreate that reuses the volume). Keep the record so the tree still renders it.
            const entry = this.stateFor(alias);
            entry.missing = true;
            entry.state = InstanceState.Stopped;
            entry.port = record.port;
            entry.errorMessage = undefined;
            this.statusEmitter.fire();
            return {};
        }
        // No record and no container (only the always-present DEFAULT reaches here) ⇒ NotInstalled.
        this.setStatus(alias, InstanceState.NotInstalled);
        return {};
    }

    /**
     * Adopt a live container as `alias`'s instance and promote its durable record to `ready` (clearing
     * any stale provisioning lease). Populates the credential cache only while running. The registry
     * port is authoritative for a stopped instance (`docker ps -a` omits its binding); a running one
     * writes its live bound port.
     */
    private async adoptContainer(
        alias: string,
        record: QuickStartInstanceRecord | undefined,
        containerId: string,
        stored: string,
    ): Promise<void> {
        const inspected = await this.runtime.inspectContainer(containerId);
        const running = isRunning(inspected);
        const boundPort = (inspected && getBoundHostPort(inspected)) || record?.port || QUICK_START_PORT;
        let username = '';
        let password = '';
        try {
            const parsed = new DocumentDBConnectionString(stored);
            username = parsed.username;
            password = parsed.password;
        } catch {
            username = '';
        }
        if (running) {
            this.populateCredentialCache(alias, stored, username, password);
        }
        const adoptedImageRef = inspected?.image?.originalName;
        // Backfill the durable image record from the adopted container, so a recreate AFTER this
        // container is later removed + the window reloads still reuses the original image — even for an
        // instance we only adopted (never provisioned in-process). Never clear an existing value.
        if (adoptedImageRef) {
            await ext.context.globalState.update(imageRefKey(alias), adoptedImageRef);
        }
        // Make the registry authoritative + clear any stale provisioning lease: an adopted container
        // whose credentials we hold IS ready (so a later container-loss becomes Missing, not scavenged).
        await upsertInstanceRecord(ext.context.globalState, {
            alias,
            displayName: record?.displayName ?? (alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias),
            port: running ? boundPort : (record?.port ?? boundPort),
            phase: 'ready',
        });
        this.setStatus(alias, running ? InstanceState.Running : InstanceState.Stopped, {
            containerId,
            alias,
            boundPort,
            clusterId: clusterId(alias),
            connectionString: stored,
            username,
            // Recover the image the volume's cluster was created with, so a later recreate reuses it.
            imageRef: adoptedImageRef,
        });
    }

    /**
     * Deterministic winner among an alias's live containers: the most-recently-created one. Duplicates
     * (rare — a cross-window double-create) are logged and LEFT in place (never force-removed — R3).
     */
    private pickManagedContainer(
        alias: string,
        containers: Array<{ id: string; createdAt?: Date }>,
    ): { id: string } | undefined {
        if (containers.length <= 1) {
            return containers[0];
        }
        const sorted = [...containers].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
        getQuickStartOutputChannel().appendLine(
            `Found ${containers.length} containers for DocumentDB Local instance "${alias}"; adopting the most recent (${sorted[0].id}) and leaving the rest.`,
        );
        return sorted[0];
    }
}

/** Singleton Quick Start service. */
export const QuickStartService = new QuickStartServiceImpl();
