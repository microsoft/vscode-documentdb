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
import { meterSilentCatch } from '../../utils/accumulatingTelemetry';
import {
    ContainerRuntime,
    getBoundHostPort,
    getQuickStartOutputChannel,
    type IContainerRuntime,
    isRunning,
} from './ContainerRuntime';
import {
    composeConnectionString,
    generateCredentials,
    type GeneratedCredentials,
    secretVariants,
} from './quickStartCredentials';
import {
    DEFAULT_INSTANCE_DISPLAY_NAME,
    getInstance,
    isProvisioningLeaseFresh,
    listInstances,
    type QuickStartInstanceRecord,
    readConnectionString,
    removeInstance,
    removeInstanceIf,
    scavengeStaleLeases,
    updateInstance,
    upsertInstance,
    writeConnectionString,
} from './quickStartStore';
import {
    type AdvancedQuickStartOptions,
    clusterId,
    containerName,
    DEFAULT_ALIAS,
    type DockerHostEnvironment,
    type DockerReadiness,
    type InstanceMetadata,
    InstanceState,
    type InstanceStatus,
    type PortAvailability,
    type ProvisionStage,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_DATA_PATH,
    QUICK_START_IMAGE,
    QUICK_START_LABEL_KEY,
    QUICK_START_OPERATION_LABEL_KEY,
    QUICK_START_PORT,
    QUICK_START_PORT_SCAN_LIMIT,
    type QuickStartMessage,
    type QuickStartMessageKey,
    type QuickStartStatus,
    resolveQuickStartImage,
    type StageEvent,
    volumeName,
} from './quickStartTypes';

/** Stable cache key for CredentialCache / ClustersClient (the default instance). Ephemeral. */
export const QUICK_START_CLUSTER_ID = clusterId(DEFAULT_ALIAS);

function traceQuickStart(message: string): void {
    ext.outputChannel?.trace(`[LocalQuickStart] ${message}`);
}

/**
 * Docker's "port is already allocated" bind failure, in the wordings the CLI emits. The port is
 * pre-checked before the pull, but the pull can take minutes and something else may claim the port
 * meanwhile (review M5). Matching here turns a raw daemon string into the same actionable copy as
 * the pre-check instead of leaking `Bind for 127.0.0.1:10260 failed: port is already allocated`.
 */
function isPortAllocationFailure(error: unknown): boolean {
    const message = errMessage(error).toLowerCase();
    return (
        message.includes('port is already allocated') ||
        message.includes('address already in use') ||
        (message.includes('bind') && message.includes('failed'))
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

/**
 * Minimum gap between two background live-state probes (review M6). The Connections view refreshes
 * on many unrelated events; without a cooldown the tree would spawn a `docker inspect` per render.
 */
const BACKGROUND_REFRESH_COOLDOWN_MS = 5_000;

function errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function meterQuickStartSilentCatch(location: string): undefined {
    meterSilentCatch(`quickStart_${location}`);
    return undefined;
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
 * Docker was not usable at the `checking` stage. Thrown rather than yielded in place so the
 * failure leaves through the same buffered path as every other terminal failure, and the webview
 * only learns about it once `finally` has cleared the `provisioning` guard.
 */
class DockerNotReadyError extends Error {
    constructor(readonly messageKey: Extract<QuickStartMessageKey, 'dockerCliMissing' | 'dockerDaemonUnreachable'>) {
        super(messageKey);
        this.name = 'DockerNotReadyError';
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
    readonly journeyCorrelationId: string;
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
    error?: QuickStartMessage;
    inFlight?: QuickStartOperation;
}

/** Long-running work the tree renders progress for. */
export type QuickStartOperationKind =
    | 'provisioning'
    | 'starting'
    | 'stopping'
    | 'restarting'
    | 'deleting'
    | 'refreshing';

/**
 * An awaitable handle on in-flight work. The tree hands it to the framework's node-progress state
 * (`ext.state.runWithTemporaryDescription`) instead of rendering its own spinner rows.
 */
export interface QuickStartOperation {
    readonly kind: QuickStartOperationKind;
    readonly promise: Promise<void>;
}

export type QuickStartConnectionPreflightResult =
    | 'ready'
    | 'stopped'
    | 'missing'
    | 'foreign'
    | 'busy'
    | 'unavailable'
    | 'dockerUnreachable';

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
    message?: QuickStartMessage,
    boundPort?: number,
    timedOut?: boolean,
    dockerReadiness?: DockerReadiness,
): StageEvent {
    return { stage, status, message, boundPort, timedOut, dockerReadiness };
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

/** Synchronously readable across restarts, unlike the durable store behind {@link ensureHydrated}. */
const LIKELY_INSTALLED_KEY = 'documentdb.localQuickStart.likelyInstalled';

export class QuickStartServiceImpl {
    /**
     * Per-alias runtime state (WI-2). See {@link InstanceRuntimeState}.
     *
     * SCOPE (review §9.2 Q3): exactly **one** instance is supported today. This map, the `alias`
     * parameter threaded through every public method, {@link reservedPorts} and the `operationId`
     * labels are deliberate seams kept so a second instance is a focused iteration rather than a
     * rewrite — but no UI is built on them, and every caller passes {@link DEFAULT_ALIAS}. When
     * multi-instance is picked up, creating a second instance should most likely start by offering
     * the one that already exists.
     */
    private readonly instances = new Map<string, InstanceRuntimeState>();

    /** First authoritative durable-store/Docker reconciliation, shared by all Quick Start entry points. */
    private hydration: Promise<void> | undefined;
    private reconciliation: Promise<void> | undefined;
    private hydrated = false;
    private dockerReadiness: DockerReadiness | undefined;

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

    private readonly hintSubscription: vscode.Disposable;

    private readonly operationEmitter = new vscode.EventEmitter<void>();
    /**
     * Fires when long-running work starts or finishes. Deliberately separate from
     * {@link onDidChangeStatus}, whose listeners rebuild the whole Connections view.
     */
    public readonly onDidChangeOperation = this.operationEmitter.event;

    /**
     * Publish an awaitable handle for work that is about to start; the returned callback settles it.
     * Callers keep their own `provisioning` / `lifecycleBusy` guards — this only exposes the wait.
     */
    private beginOperation(alias: string, kind: QuickStartOperationKind): () => void {
        const entry = this.stateFor(alias);
        let settle!: () => void;
        const promise = new Promise<void>((resolve) => {
            settle = resolve;
        });
        entry.inFlight = { kind, promise };
        this.operationEmitter.fire();
        return () => {
            if (entry.inFlight?.promise === promise) {
                entry.inFlight = undefined;
            }
            settle();
            this.operationEmitter.fire();
        };
    }

    /** The long-running work currently in flight for `alias`, if any. */
    public getInFlightOperation(alias: string = DEFAULT_ALIAS): QuickStartOperation | undefined {
        const entry = this.stateFor(alias);
        if (entry.inFlight) {
            return entry.inFlight;
        }
        return this.backgroundRefresh ? { kind: 'refreshing', promise: this.backgroundRefresh } : undefined;
    }

    /**
     * @param runtime Docker IO surface (WI-0). Defaults to the shared {@link ContainerRuntime}
     * singleton; tests inject a mock so the state machine runs with no real daemon.
     */
    constructor(private readonly runtime: IContainerRuntime = ContainerRuntime) {
        // Registered first, so the hint is already correct when the tree rebuilds off the same event.
        this.hintSubscription = this.onDidChangeStatus(() => this.syncLikelyInstalledHint());
    }

    /**
     * Best-effort "has an instance ever been set up?", readable synchronously before
     * {@link ensureHydrated} has reached Docker — the tree renders its root row long before then and
     * would otherwise show the not-set-up copy to everyone, only to retract it on first expansion.
     * Wrong only until the next status change corrects it.
     */
    public get isLikelyInstalled(): boolean {
        return ext.context?.globalState.get<boolean>(LIKELY_INSTALLED_KEY) ?? false;
    }

    private syncLikelyInstalledHint(): void {
        const likelyInstalled = this.stateFor(DEFAULT_ALIAS).metadata !== undefined;
        if (likelyInstalled === this.isLikelyInstalled) {
            return;
        }
        void ext.context?.globalState.update(LIKELY_INSTALLED_KEY, likelyInstalled);
    }

    /** Latest Docker host facts collected by setup or deep reconciliation. */
    public getDockerReadinessSnapshot(): DockerReadiness | undefined {
        return this.dockerReadiness;
    }

    /** Check Docker and retain the result for tree presentation. */
    public async checkDockerReadiness(
        request?: Parameters<IContainerRuntime['isDockerReady']>[0],
    ): Promise<DockerReadiness> {
        const readiness = await this.runtime.isDockerReady(request);
        this.dockerReadiness = readiness;
        return readiness;
    }

    public getStatus(alias: string = DEFAULT_ALIAS): QuickStartStatus {
        const entry = this.stateFor(alias);
        return {
            state: entry.state,
            metadata: entry.metadata,
            error: entry.error,
            missing: entry.missing,
            // Known even while provisioning (the port is decided in the wizard, L1/L3), so the tree
            // row can show the real address instead of assuming the canonical port.
            port: entry.metadata?.boundPort ?? entry.port,
            // Only "resumable" once the provision/resume has settled (not mid-wait): pendingReadiness
            // is set BEFORE the probe, so gating on the busy flags keeps a reopened panel from
            // offering "Wait longer" while setup is still actively running (gpt-5.5).
            canResumeReadiness: !entry.provisioning && !entry.lifecycleBusy && entry.pendingReadiness !== undefined,
        };
    }

    /**
     * Snapshot of every known instance for the tree (WI-3), ordered DEFAULT first then by alias.
     *
     * Another multi-instance seam (see {@link instances}): the tree renders a single row today and
     * reads {@link getStatus} instead.
     */
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
            error: entry.error,
            canResumeReadiness: !entry.provisioning && !entry.lifecycleBusy && entry.pendingReadiness !== undefined,
            metadata: entry.metadata,
        };
    }

    /** Default-instance shorthand for {@link isBusyFor} (kept for the router until WI-4). */
    public get isBusy(): boolean {
        return this.isBusyFor(DEFAULT_ALIAS);
    }

    /** Alias-scoped busy check (WI-3/4/5). */
    public isBusyFor(alias: string): boolean {
        return this.stateFor(alias).provisioning;
    }

    public dispose(): void {
        this.hintSubscription.dispose();
        this.statusEmitter.dispose();
        this.operationEmitter.dispose();
    }

    /**
     * Lazily rebuild runtime state from durable storage and Docker. Concurrent callers share the
     * same work, and later callers use the hydrated in-memory state until an explicit reconcile.
     */
    public async ensureHydrated(): Promise<void> {
        if (this.hydrated) {
            return;
        }

        if (!this.hydration) {
            traceQuickStart('Lazy hydration requested; starting deep reconciliation.');
            this.hydration = this.reconcile()
                .then(() => {
                    this.hydrated = true;
                    // Reconcile can settle without a status change (nothing was ever set up), which
                    // would leave a stale hint behind.
                    this.syncLikelyInstalledHint();
                    // Arms the background-probe cooldown: reconcile just produced an authoritative
                    // answer, and the status events it fired re-enter getChildren() once hydration
                    // is done, where an unarmed cooldown would re-inspect the same container.
                    this.lastBackgroundRefreshAt = Date.now();
                    traceQuickStart('Lazy hydration completed.');
                })
                .catch((error: unknown) => {
                    traceQuickStart('Lazy hydration failed; the next Quick Start entry will retry.');
                    throw error;
                })
                .finally(() => {
                    this.hydration = undefined;
                });
        } else {
            traceQuickStart('Lazy hydration joined the in-flight request.');
        }

        await this.hydration;
    }

    /** Whether the initial durable-store/Docker reconciliation has completed. */
    public get isHydrated(): boolean {
        return this.hydrated;
    }

    /** Force an authoritative refresh for an explicit Quick Start refresh action. */
    public async refreshHydratedState(): Promise<void> {
        traceQuickStart('Explicit node refresh requested; starting deep reconciliation.');
        try {
            await this.reconcile();
            this.hydrated = true;
            this.syncLikelyInstalledHint();
            this.lastBackgroundRefreshAt = Date.now();
            traceQuickStart('Explicit node refresh completed.');
        } catch (error) {
            traceQuickStart('Explicit node refresh failed; the next explicit refresh will retry.');
            throw error;
        }
    }

    private setStatus(
        alias: string,
        state: InstanceState,
        metadata?: InstanceMetadata,
        error?: QuickStartMessage,
    ): void {
        const entry = this.stateFor(alias);
        entry.state = state;
        if (metadata !== undefined) {
            entry.metadata = metadata;
            entry.port = metadata.boundPort;
        }
        entry.error = error;
        entry.missing = false;
        this.statusEmitter.fire();
    }

    private throwIfAborted(signal: AbortSignal): void {
        if (signal.aborted) {
            throw new Error('aborted');
        }
    }

    private async runProvisionStage<T>(
        stage: Exclude<ProvisionStage, 'done' | 'error'>,
        journeyCorrelationId: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        // Throwing inside the callback is what records the stage as Failed. The error is captured and
        // re-thrown here rather than via `errorHandling.rethrow`, which the framework ignores for a
        // UserCancelledError — provisioning must never continue past a failed stage.
        let result!: T;
        let operationError: Error | undefined;
        await callWithTelemetryAndErrorHandling('documentDB.quickstart.provision.stage', async (telemetryContext) => {
            telemetryContext.errorHandling.suppressDisplay = true;
            telemetryContext.telemetry.properties.stage = stage;
            telemetryContext.telemetry.properties.journeyCorrelationId = journeyCorrelationId;
            try {
                result = await operation();
            } catch (error) {
                operationError = error instanceof Error ? error : new Error(String(error));
                throw operationError;
            }
        });
        if (operationError !== undefined) {
            throw operationError;
        }
        return result;
    }

    /**
     * Provision the managed instance, yielding one {@link StageEvent} per
     * transition. Cancellation is via `signal`: a pull-phase cancel removes
     * nothing (no container exists yet); a create/start-phase cancel removes the
     * container by id (decision D12). All cleanup runs in `finally` so it also
     * fires when the consumer unsubscribes (iterator `return()`).
     */
    public async *provision(
        signal: AbortSignal,
        options?: AdvancedQuickStartOptions,
        alias: string = DEFAULT_ALIAS,
        journeyCorrelationId: string = crypto.randomUUID(),
    ): AsyncGenerator<StageEvent> {
        if (this.stateFor(alias).provisioning || this.stateFor(alias).lifecycleBusy) {
            yield stageEvent('error', 'error', { key: 'setupAlreadyInProgress' });
            return;
        }
        this.stateFor(alias).provisioning = true;
        const endOperation = this.beginOperation(alias, 'provisioning');
        // Starting a fresh run supersedes any container left running by a prior readiness
        // timeout — drop its retained "Wait longer" state (the run below removes the container).
        this.stateFor(alias).pendingReadiness = undefined;
        const channel = getQuickStartOutputChannel();
        // The user's explicit Configure-step choice (review M4). "Start fresh" is the ONLY way to
        // reach the volume wipe below when an instance already exists; without it, reuse is decided
        // from LIVE durable state, not the in-memory Missing flag: whenever we still hold the
        // instance's stored credentials (SecretStorage), a data volume bound to them may exist on
        // disk — even after the container was removed externally or across a window reload that
        // cleared in-memory state (§6.1, §12). Adopt those credentials and KEEP the volume rather
        // than wiping it; the stored credentials are what opens the volume's cluster, so freshly
        // generated ones would fail against existing data.
        const startFresh = options?.startFresh === true;
        const reusable = startFresh ? undefined : await this.getReusableCredentials(alias);
        const reusing = reusable !== undefined;
        const credentials = reusable ?? resolveProvisionCredentials(options);
        const secrets: string[] = secretVariants(credentials.password);

        // Advanced overrides (P1-4). When reusing an existing instance we keep its data volume,
        // so custom credentials AND a custom image tag are intentionally IGNORED: the stored
        // credentials are required to open the volume's cluster, and recreating onto it with a
        // different (especially older) image version could leave the on-disk cluster unusable.
        // The original image is reused — from in-memory metadata, falling back to the stored record
        // (survives a window reload), then the default if neither is known.
        const usedCustomCreds = !reusing && !!(options?.username?.trim() && options?.password?.trim());
        const imageRef = reusing
            ? (this.stateFor(alias).metadata?.imageRef ?? (await getInstance(alias))?.imageRef ?? QUICK_START_IMAGE)
            : resolveQuickStartImage(options?.imageTag);
        const usedCustomImage = !reusing && imageRef !== QUICK_START_IMAGE;
        const explicitPort = typeof options?.port === 'number' ? options.port : undefined;
        // Always explicit from here on (L3): the wizard suggests and validates the port, so
        // `provision` binds exactly this one and never relocates it.
        const chosenPort = explicitPort ?? QUICK_START_PORT;
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
        let portTaken = false;
        let readinessTimedOut = false;
        // Owner nonce for this run: stamped on the container (H4) and on the provisioning lease (H3),
        // so both the cleanup sweep and the registry reservation are provably this run's own. This is
        // load-bearing today for concurrent windows, not only for the multi-instance seam.
        const operationId = crypto.randomBytes(8).toString('hex');
        let leaseHeld = false;
        // Set once the credentials are persisted BEFORE the readiness wait (H3), together with
        // whatever was stored before, so a failed attempt can restore the previous state exactly.
        let earlySecretStored = false;
        let previousStoredConnectionString: string | undefined;
        let readinessEnvironment: DockerHostEnvironment | undefined;
        let activeDockerStage: Extract<ProvisionStage, 'pulling' | 'creating'> | undefined;
        let provisioningDockerFailureKind: string | undefined;
        // The terminal StageEvent (timeout OR hard error) is buffered and yielded AFTER `finally`
        // runs, so by the time the webview shows "Wait longer" / "Retry" the service flags
        // (provisioning/lifecycleBusy) are already clean — otherwise a fast click could hit the
        // "already in progress" guard (opus-4.7).
        let terminalEvent: StageEvent | undefined;
        const provisionStartedAt = Date.now();

        try {
            this.setStatus(alias, InstanceState.Provisioning, undefined, undefined);
            // Remember the port this attempt will bind so the tree's "Provisioning…" row shows the
            // real address rather than assuming the canonical default (L1).
            this.stateFor(alias).port = chosenPort;

            // --- checking ---
            yield stageEvent('checking', 'active');
            const readiness = await this.runProvisionStage('checking', journeyCorrelationId, async () => {
                const result = await this.checkDockerReadiness();
                this.throwIfAborted(signal);
                const continueAfterIndeterminateReadiness =
                    options?.continueAnyway === true && result.outcome === 'indeterminate';
                if ((!result.cliInstalled || !result.daemonReachable) && !continueAfterIndeterminateReadiness) {
                    throw new DockerNotReadyError(
                        !result.cliInstalled ? 'dockerCliMissing' : 'dockerDaemonUnreachable',
                    );
                }
                return result;
            });
            readinessEnvironment = readiness.environment;

            // Remove a pre-existing managed container so the run starts clean (it is labelled as
            // ours, D9). When NOT reusing (no recoverable credentials) also drop any stale data
            // volume, so the new credentials initialize a clean cluster. When reusing, the volume is
            // intentionally KEPT so existing data survives the recreate.
            const existing = await this.findManagedContainer(alias);
            const hasReadyRecord = (await getInstance(alias))?.phase === 'ready';
            // RR4 / §5.2 volume-wipe gate: NEVER silently destroy an existing instance's data. A
            // credential-unavailable instance (a managed container and/or a durable `ready` record,
            // but no readable secret) must not be wiped by a plain Set-up/recreate click. The wipe
            // below is reachable only for a truly-fresh alias (no managed container AND no `ready`
            // record, where it is a safe no-op) or when the user explicitly chose "Start fresh" in
            // the Configure step. A dead failed-attempt orphan has NO managed container (provision's
            // `finally` removed it) and no `ready` record, so retrying it still works.
            if (!reusing && !startFresh) {
                if (existing || hasReadyRecord) {
                    const credentialsUnavailable: QuickStartMessage = { key: 'credentialsUnavailable' };
                    this.setStatus(alias, InstanceState.CredentialsMissing, undefined, credentialsUnavailable);
                    yield stageEvent('checking', 'error', credentialsUnavailable);
                    return;
                }
            }
            if (existing) {
                channel.appendLine(`Removing existing Quick Start container ${existing.id} for a clean run…`);
                await this.runtime
                    .removeContainer(existing.id)
                    .catch(() => meterQuickStartSilentCatch('provision_removeExistingContainer'));
            }
            if (!reusing) {
                await this.runtime
                    .removeVolume(volumeName(alias))
                    .catch(() => meterQuickStartSilentCatch('provision_removeStaleVolume'));
            }

            // The host port is ALWAYS explicit (review L3, "no magic after execute"): the Configure
            // step suggests a free port, validates it while the user can still react, and sends it.
            // Setup never relocates it — a conflict here is a hard, explained error.
            if (!(await this.runtime.isPortFree(chosenPort))) {
                const message: QuickStartMessage = { key: 'portInUse', port: chosenPort };
                this.setStatus(alias, InstanceState.Error, undefined, message);
                yield stageEvent('checking', 'error', message);
                return;
            }
            this.throwIfAborted(signal);
            yield stageEvent('checking', 'done');

            // Take the durable provisioning lease BEFORE the pull (H3): a host killed anywhere from
            // here to `finalizeReadyInstance` then reconciles as "Provisioning…" (fresh lease) or is
            // scavenged (stale lease) instead of dead-ending. Only for a genuinely fresh alias — for
            // a recreate the existing `ready` record must survive, otherwise a failed recreate would
            // scavenge the record of an instance whose data volume is still on disk.
            if (!hasReadyRecord) {
                leaseHeld = true;
                await this.renewProvisioningLease(alias, operationId, chosenPort);
            }

            // --- pulling ---
            yield stageEvent('pulling', 'active');
            activeDockerStage = 'pulling';
            await this.runProvisionStage('pulling', journeyCorrelationId, async () => {
                await this.runtime.pullImage(imageRef, cts.token);
                this.throwIfAborted(signal);
            });
            activeDockerStage = undefined;
            yield stageEvent('pulling', 'done');

            // --- creating (docker run -d creates and starts) ---
            yield stageEvent('creating', 'active');
            if (leaseHeld) {
                await this.renewProvisioningLease(alias, operationId, chosenPort);
            }
            createAttempted = true;
            // Write credentials to a temp env-file (deleted in finally) so they never
            // appear on the docker CLI / host process list (design §8.2). The image
            // reads USERNAME/PASSWORD from the environment.
            const createdEnvFilePath = await this.writeEnvFile(credentials.username, credentials.password);
            envFilePath = createdEnvFilePath;
            activeDockerStage = 'creating';
            containerId = await this.runProvisionStage('creating', journeyCorrelationId, async () => {
                const createdContainerId = await this.runtime.createAndRunContainer(
                    {
                        imageRef: imageRef,
                        name: containerName(alias),
                        labels: {
                            [QUICK_START_LABEL_KEY]: '1',
                            [QUICK_START_ALIAS_LABEL_KEY]: alias,
                            // Per-run nonce so this run's cleanup sweep can only remove ITS container (H4).
                            [QUICK_START_OPERATION_LABEL_KEY]: operationId,
                        },
                        hostPort: chosenPort,
                        containerPort: QUICK_START_PORT,
                        // Persist data across recreation (§8/§11).
                        volumeName: volumeName(alias),
                        dataPath: QUICK_START_DATA_PATH,
                        // Credentials via env-file (§8.2), not CLI args. We also do NOT bake
                        // `--init-data true`: it re-runs the sample-data init on every
                        // Stop/Start and crashes on duplicate keys; sample data is seeded
                        // once, post-readiness, via `docker exec` (see seedSampleData).
                        environmentFiles: [createdEnvFilePath],
                    },
                    secrets,
                    cts.token,
                );
                this.throwIfAborted(signal);
                return createdContainerId;
            });
            activeDockerStage = undefined;
            containerCreated = true;
            if (!containerId) {
                const item = await this.runtime.inspectContainer(containerName(alias));
                containerId = item?.id ?? containerName(alias);
            }
            const provisionedContainerId = containerId;
            yield stageEvent('creating', 'done');

            // --- starting (confirm running, read bound port, follow logs) ---
            yield stageEvent('starting', 'active');
            const inspected = await this.runProvisionStage('starting', journeyCorrelationId, async () => {
                const result = await this.runtime.inspectContainer(provisionedContainerId);
                this.throwIfAborted(signal);
                return result;
            });
            // Fall back to the port we actually requested (not the canonical default) if the
            // inspect can't report the binding, so a custom port stays correct in the success
            // message + stored connection string.
            const boundPort = (inspected && getBoundHostPort(inspected)) || chosenPort;
            // Stream container logs to the channel during the wait (compensates for -dt detach, D2).
            void this.runtime.followLogs(provisionedContainerId, secrets, cts.token);
            yield stageEvent('starting', 'done');

            // --- waiting (wire-protocol readiness, D7) ---
            yield stageEvent('waiting', 'active');
            const connectionString = composeConnectionString(credentials.username, credentials.password, boundPort);
            // Retain everything a "Wait longer" resume needs BEFORE probing, so a readiness
            // timeout can keep this running container and finish adoption later (§9.1).
            const pending: PendingReadiness = {
                alias,
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                containerId: provisionedContainerId,
                connectionString,
                boundPort,
                username: credentials.username,
                password: credentials.password,
                imageRef,
                sampleDataRequested,
                journeyCorrelationId,
                reusing,
            };
            this.stateFor(alias).pendingReadiness = pending;
            // Persist the credentials BEFORE the readiness wait (H3). The wait alone can run for
            // three minutes, and it used to be the ONLY window in which a reload left a labelled
            // container behind with no recoverable secret — a dead end whose only exit was deleting
            // the volume. With the secret written here, a reload mid-wait reconciles into a normal
            // adoption instead. A failed attempt restores the previous value in `finally`.
            previousStoredConnectionString = await this.readStoredConnectionString(alias);
            await writeConnectionString(alias, connectionString, {
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                port: boundPort,
            });
            earlySecretStored = true;
            if (leaseHeld) {
                await this.renewProvisioningLease(alias, operationId, boundPort);
            }
            await this.runProvisionStage('waiting', journeyCorrelationId, async () => {
                await this.waitForReadiness(connectionString, signal);
                this.throwIfAborted(signal);

                // --- success (seed sample data, store creds, adopt as Running) ---
                await this.finalizeReadyInstance(pending, cts.token, signal);
            });
            success = true;
            yield stageEvent('waiting', 'done');
            yield stageEvent('done', 'done', { key: 'instanceRunning', port: boundPort }, boundPort);
        } catch (error) {
            const aborted = signal.aborted;
            const dockerReadiness =
                !aborted && activeDockerStage ? await this.getProvisioningDockerReadiness() : undefined;
            provisioningDockerFailureKind = dockerReadiness?.failureKind;
            const detail = errMessage(error);
            let message: QuickStartMessage = aborted ? { key: 'setupCancelled' } : { key: 'unexpectedFailure', detail };
            if (!aborted && error instanceof DockerNotReadyError) {
                this.stateFor(alias).pendingReadiness = undefined;
                message = { key: error.messageKey };
                this.setStatus(alias, InstanceState.Error, undefined, message);
                terminalEvent = stageEvent('checking', 'error', message);
            } else if (!aborted && error instanceof ReadinessTimeoutError && containerCreated && containerId) {
                // The container is running but the database did not accept connections within the
                // window — it may still be initializing. KEEP it running (finally skips teardown)
                // and surface the on-timeout actions (§9.1); the retained pendingReadiness lets a
                // "Wait longer" resume finish adoption. The instance sits in Error until then. The
                // event is buffered and emitted after `finally` (see below) so the flags are clean.
                readinessTimedOut = true;
                channel.appendLine(`[readiness-timeout] ${detail}`);
                message = { key: 'readinessTimeout', environment: readinessEnvironment };
                this.setStatus(alias, InstanceState.Error, undefined, message);
                terminalEvent = stageEvent('waiting', 'error', message, undefined, /* timedOut */ true);
            } else {
                // Any other failure (or cancel) discards the attempt — drop the retained state so a
                // stale timeout can't offer "Wait longer" against a container we're about to remove.
                this.stateFor(alias).pendingReadiness = undefined;
                if (!aborted) {
                    if (activeDockerStage === 'creating' && isPortAllocationFailure(error)) {
                        // The port was free at the pre-check but taken while the image downloaded
                        // (M5). Say so in the same words as the pre-check instead of leaking the
                        // raw daemon string; the user re-picks the port in Configure.
                        message = { key: 'portInUse', port: chosenPort };
                        portTaken = true;
                    } else if (dockerReadiness) {
                        message = { key: 'dockerUnavailableDuringSetup', detail };
                    }
                    this.setStatus(alias, InstanceState.Error, undefined, message);
                }
                // Buffered and emitted after `finally` (like the timeout event) so a Retry click
                // driven by this event can't race the still-set `provisioning` guard either
                // (opus-4.7). On unsubscribe/return() the post-finally yield is simply skipped.
                terminalEvent = stageEvent('error', 'error', message, undefined, undefined, dockerReadiness);
            }
        } finally {
            // Stop the followLogs stream (started with cts.token). Disposing alone
            // does NOT signal cancellation — only cancel() stops `docker logs -f`.
            cts.cancel();
            if (!success && !readinessTimedOut) {
                // Cleanup (D12): when a container exists, stop+remove it.
                if (containerCreated && containerId) {
                    channel.appendLine(`Cleaning up container ${containerId}…`);
                    await this.runtime
                        .stopContainer(containerId)
                        .catch(() => meterQuickStartSilentCatch('provision_cleanupStopContainer'));
                    await this.runtime
                        .removeContainer(containerId)
                        .catch(() => meterQuickStartSilentCatch('provision_cleanupRemoveContainer'));
                } else if (createAttempted && !containerId) {
                    // The CLI may have been killed after the daemon created the container but
                    // before its id was captured — sweep by label. Scoped to THIS run's
                    // `operationId` (H4): an unscoped by-alias sweep would happily remove the
                    // container another window had just created, since the loser of a two-window
                    // create race reaches exactly this branch (its `docker run` failed on the
                    // duplicate name).
                    const orphans = await this.runtime
                        .listByLabel({
                            [QUICK_START_LABEL_KEY]: '1',
                            [QUICK_START_OPERATION_LABEL_KEY]: operationId,
                        })
                        .catch(() => {
                            meterQuickStartSilentCatch('provision_listOrphanedContainers');
                            return [];
                        });
                    for (const orphan of orphans) {
                        channel.appendLine(`Removing orphaned container ${orphan.id}…`);
                        await this.runtime
                            .removeContainer(orphan.id)
                            .catch(() => meterQuickStartSilentCatch('provision_removeOrphanedContainer'));
                    }
                }
                // Restore the credential state this attempt overwrote (H3): a discarded attempt
                // must not leave its own secret behind, nor clobber the previous instance's.
                if (earlySecretStored) {
                    try {
                        await writeConnectionString(alias, previousStoredConnectionString ?? null, {
                            displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                            port: chosenPort,
                        });
                    } catch {
                        meterQuickStartSilentCatch('provision_restoreCredentials');
                        // Best-effort restore; a stuck secret is surfaced by the next reconcile.
                    }
                }
                // Drop this run's pre-create reservation so the tree doesn't keep a phantom
                // "Provisioning…" row until the lease expires. `finalizeReadyInstance` already
                // promoted the record to `ready` on the success path.
                if (leaseHeld) {
                    await this.releaseProvisioningLease(alias, operationId);
                }
                // Interrupted before settling (cancel / unsubscribe) → reset state.
                // The error path already settled to `Error` in `catch`.
                if (this.stateFor(alias).state === InstanceState.Provisioning) {
                    this.setStatus(alias, InstanceState.NotInstalled, undefined, undefined);
                }
            }
            signal.removeEventListener('abort', onAbort);
            cts.dispose();
            // Delete the temp env-file (it carried the password in plaintext, §8.2).
            if (envFilePath) {
                await fs
                    .rm(envFilePath, { force: true })
                    .catch(() => meterQuickStartSilentCatch('provision_removeEnvironmentFile'));
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
                telemetryContext.telemetry.properties.portTaken = String(portTaken);
                telemetryContext.telemetry.properties.customPort = String(explicitPort !== undefined);
                telemetryContext.telemetry.properties.customCreds = String(usedCustomCreds);
                telemetryContext.telemetry.properties.customImage = String(usedCustomImage);
                telemetryContext.telemetry.properties.sampleData = String(sampleDataRequested);
                telemetryContext.telemetry.properties.dockerFailureKind = provisioningDockerFailureKind ?? 'none';
                telemetryContext.telemetry.properties.journeyCorrelationId = journeyCorrelationId;
                telemetryContext.telemetry.measurements.provisionMs = Date.now() - provisionStartedAt;
            });
            this.stateFor(alias).provisioning = false;
            endOperation();
        }
        // Emitted only now — after `finally` cleared `provisioning` — so a "Wait longer" / "Start
        // over" / "Retry" click triggered by this event never races the still-running guard.
        if (terminalEvent) {
            yield terminalEvent;
        }
    }

    private async getProvisioningDockerReadiness(): Promise<DockerReadiness | undefined> {
        try {
            const readiness = await this.checkDockerReadiness({ forceRefresh: true });
            return readiness.outcome === 'diagnosed' ? readiness : undefined;
        } catch {
            meterQuickStartSilentCatch('provision_getDockerReadiness');
            return undefined;
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
            await this.seedSampleData(pending.containerId, secretVariants(pending.password), token);
        }
        this.throwIfAborted(signal);
        // One write covers the credentials, the image the volume was created with (so a recreate
        // after a window reload keeps it) and the ready phase the tree and reconcile enumerate.
        await upsertInstance({
            alias: pending.alias,
            displayName: pending.displayName,
            port: pending.boundPort,
            phase: 'ready',
            imageRef: pending.imageRef,
        });
        await writeConnectionString(pending.alias, pending.connectionString, {
            displayName: pending.displayName,
            port: pending.boundPort,
        });
        // Drop any stale client cached under this id (e.g. from a prior run with different
        // credentials) so the next browse uses the fresh credentials.
        await ClustersClient.deleteClient(clusterId(pending.alias)).catch(() =>
            meterQuickStartSilentCatch('finalize_deleteCachedClient'),
        );
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
    public async *resumeReadiness(signal: AbortSignal, alias: string = DEFAULT_ALIAS): AsyncGenerator<StageEvent> {
        const pending = this.stateFor(alias).pendingReadiness;
        if (!pending) {
            yield stageEvent('error', 'error', { key: 'nothingToResume' });
            return;
        }
        if (this.stateFor(alias).provisioning || this.stateFor(alias).lifecycleBusy) {
            // A prior resume/provision may still be unwinding (its abort can take a few seconds to
            // observe). Carry the timed-out affordance so the webview keeps the Wait longer / Start
            // over view instead of flipping to the generic error (opus-4.8) — the container and
            // `pendingReadiness` are still retained.
            yield stageEvent('error', 'error', { key: 'setupAlreadyInProgress' }, undefined, true);
            return;
        }
        this.stateFor(alias).provisioning = true;
        const endOperation = this.beginOperation(alias, 'provisioning');
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
            this.setStatus(alias, InstanceState.Provisioning, undefined, undefined);
            yield stageEvent('waiting', 'active');
            // Stream the container's logs during THIS wait so "View Docker output" shows the live
            // startup rather than only the stale first-attempt output (opus-4.8).
            void this.runtime.followLogs(pending.containerId, secretVariants(pending.password), cts.token);
            await this.runProvisionStage('waiting', pending.journeyCorrelationId, async () => {
                await this.waitForReadiness(pending.connectionString, signal);
                this.throwIfAborted(signal);
                await this.finalizeReadyInstance(pending, cts.token, signal);
            });
            finalized = true;
            resumeResult = 'success';
            yield stageEvent('waiting', 'done');
            terminalEvent = stageEvent(
                'done',
                'done',
                { key: 'instanceRunning', port: pending.boundPort },
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
            // A repeat timeout is the same situation as the first one, so it earns the same
            // environment-aware explanation rather than the raw probe error.
            const message: QuickStartMessage = aborted
                ? { key: 'stillInitializing' }
                : isTimeout
                  ? { key: 'readinessTimeout', environment: this.dockerReadiness?.environment }
                  : { key: 'unexpectedFailure', detail: errMessage(error) };
            if (!finalized) {
                this.setStatus(alias, InstanceState.Error, undefined, aborted ? undefined : message);
            }
            // A hard finalize error is NOT a timeout — drop the retained state so reopening the
            // panel shows the real error (via a fresh setup) rather than a misleading "Wait longer"
            // (gpt-5.5). Timeout/cancel keep pendingReadiness so the container stays resumable.
            if (!timedOut) {
                this.stateFor(alias).pendingReadiness = undefined;
            }
            terminalEvent = stageEvent('waiting', 'error', message, undefined, timedOut);
        } finally {
            signal.removeEventListener('abort', onAbort);
            // Stop the followLogs stream (started with cts.token) before disposing.
            cts.cancel();
            cts.dispose();
            this.stateFor(alias).provisioning = false;
            endOperation();
            // §14: resume outcome — booleans/enum + duration only, never names/ports/creds.
            void callWithTelemetryAndErrorHandling('documentDB.quickstart.resumeReadiness', (telemetryContext) => {
                telemetryContext.errorHandling.suppressDisplay = true;
                telemetryContext.telemetry.properties.resumeResult = resumeResult;
                telemetryContext.telemetry.properties.journeyCorrelationId = pending.journeyCorrelationId;
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
    public async discardTimedOutInstance(alias: string = DEFAULT_ALIAS): Promise<boolean> {
        const entry = this.stateFor(alias);
        // Guard BEFORE mutating: if a provision/lifecycle op is running, leave the retained
        // state untouched (clearing it here would orphan the still-running container).
        if (entry.provisioning || entry.lifecycleBusy || !entry.pendingReadiness) {
            return false;
        }
        const pending = entry.pendingReadiness;
        entry.pendingReadiness = undefined;
        entry.lifecycleBusy = true;
        try {
            await this.runtime
                .stopContainer(pending.containerId)
                .catch(() => meterQuickStartSilentCatch('discardTimedOut_stopContainer'));
            await this.runtime
                .removeContainer(pending.containerId)
                .catch(() => meterQuickStartSilentCatch('discardTimedOut_removeContainer'));
            if (!pending.reusing) {
                await this.runtime
                    .removeVolume(volumeName(pending.alias))
                    .catch(() => meterQuickStartSilentCatch('discardTimedOut_removeVolume'));
            }
            this.setStatus(alias, InstanceState.NotInstalled, undefined, undefined);
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
     * True when an existing instance's data can be REUSED rather than replaced: i.e. usable stored
     * credentials exist, so a recreate can bind the existing data volume (and any custom
     * credentials / image tag would be ignored). Backs the Configure step's "Use existing data" /
     * "Start fresh" choice regardless of the in-memory `Missing` badge. Public so the
     * `getDockerStatus` query can surface it.
     */
    public async canReuseExistingData(alias: string = DEFAULT_ALIAS): Promise<boolean> {
        return (await this.getReusableCredentials(alias)) !== undefined;
    }

    /**
     * Host ports reserved by OTHER instances (running or stopped) — their containers bake them in.
     *
     * A multi-instance seam kept deliberately (see {@link instances}): with a single instance the
     * returned set is always empty.
     */
    private async reservedPorts(alias: string): Promise<Set<number>> {
        const reserved = new Set<number>();
        for (const record of await listInstances()) {
            if (record.alias !== alias && typeof record.port === 'number') {
                reserved.add(record.port);
            }
        }
        return reserved;
    }

    /**
     * Suggest a host port for the Configure step (review L3): the instance's own recorded port when
     * it is still usable, otherwise the first free port walking forward from {@link QUICK_START_PORT},
     * skipping ports baked into sibling instances. The user sees — and can change — the port that
     * will actually be bound; `provision` never relocates it afterwards.
     *
     * Returns {@link QUICK_START_PORT} when nothing in the scan window is free, so the field is never
     * empty; the Configure-step validation then reports the conflict.
     */
    public async suggestPort(alias: string = DEFAULT_ALIAS): Promise<number> {
        const reserved = await this.reservedPorts(alias);
        const own = (await getInstance(alias))?.port;
        if (typeof own === 'number' && !reserved.has(own) && (await this.runtime.isPortFree(own))) {
            return own;
        }
        for (let port = QUICK_START_PORT; port < QUICK_START_PORT + QUICK_START_PORT_SCAN_LIMIT; port++) {
            if (!reserved.has(port) && (await this.runtime.isPortFree(port))) {
                return port;
            }
        }
        return QUICK_START_PORT;
    }

    /** Validate a Configure-step port while the user can still react (review L3). */
    public async checkPort(port: number, alias: string = DEFAULT_ALIAS): Promise<PortAvailability> {
        if ((await this.reservedPorts(alias)).has(port)) {
            return 'takenByAnotherInstance';
        }
        return (await this.runtime.isPortFree(port)) ? 'available' : 'inUse';
    }

    /**
     * Recover the stored credentials of a Missing instance so a recreate reuses
     * them against the existing data volume (§6.1). Returns undefined if no usable
     * stored connection string exists (caller then generates fresh credentials).
     */
    /**
     * Read the instance's stored connection string — the credential source of truth.
     *
     * Public because `QuickStartClusterItem` resolves through this instead of
     * `ConnectionStorageService`, which holds no record for the managed instance.
     */
    public async readStoredConnectionString(alias: string = DEFAULT_ALIAS): Promise<string | undefined> {
        return readConnectionString(alias);
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

    private async findManagedContainer(
        alias: string = DEFAULT_ALIAS,
        options?: { propagateErrors?: boolean },
    ): Promise<{ id: string } | undefined> {
        return (await this.findManagedContainers(alias, options))[0];
    }

    /**
     * Write (or refresh) this run's `'provisioning'` reservation (H3). Renewed at each stage so a
     * slow first image pull can never look like a crashed host: `reconcile()` shows a FRESH lease as
     * "Provisioning…" and only scavenges a stale one. Best-effort — a registry hiccup must not fail
     * a provision that is otherwise fine.
     */
    private async renewProvisioningLease(alias: string, operationId: string, port: number): Promise<void> {
        await updateInstance(alias, (current) => {
            // Never downgrade a record another run already promoted to `ready`.
            if (current?.phase === 'ready') {
                return undefined;
            }
            return {
                alias,
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                port,
                phase: 'provisioning',
                operationId,
                leaseAt: Date.now(),
                imageRef: current?.imageRef,
            };
        }).catch(() => undefined);
    }

    /** Drop this run's reservation, but only if it is still ours and still un-promoted. */
    private async releaseProvisioningLease(alias: string, operationId: string): Promise<void> {
        await removeInstanceIf(
            alias,
            (record) => record.phase === 'provisioning' && record.operationId === operationId,
        ).catch(() => undefined);
    }

    private async findManagedContainers(
        alias: string = DEFAULT_ALIAS,
        options?: { propagateErrors?: boolean },
    ): Promise<Array<{ id: string; labels?: Record<string, string> }>> {
        // Best-effort by default (discovery paths tolerate a Docker hiccup by treating it as "none
        // found"). The explicit Delete path opts into `propagateErrors` so a lookup FAILURE is not
        // mistaken for "already gone" — it must surface rather than green-light a false clean slate.
        const list = options?.propagateErrors
            ? await this.runtime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' })
            : await this.runtime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' }).catch(() => []);
        return list.filter((container: { id: string; labels?: Record<string, string> }) =>
            this.aliasMatches(container.labels?.[QUICK_START_ALIAS_LABEL_KEY], alias),
        );
    }

    /**
     * A container belongs to `alias` when its `vscode.documentdb.alias` label equals `alias`. An
     * unlabelled container belongs to the DEFAULT instance, so one created before the label existed
     * (a dev build) is still found and adopted rather than orphaned.
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
            // Multi-window / external drift: the requested outcome is already satisfied. Correct
            // the state immediately and return quietly rather than distracting the user with a
            // notification for a successful no-op.
            this.setStatus(alias, live === 'running' ? InstanceState.Running : InstanceState.Stopped);
            return false;
        }
        return true;
    }

    /**
     * Read-only verdict on a managed instance: no state correction, no events, no UI. Split out of
     * {@link prepareForConnection} so the error-translation provider, which must not do any of
     * those things, has something safe to call.
     */
    public async inspectManagedInstance(alias: string = DEFAULT_ALIAS): Promise<QuickStartConnectionPreflightResult> {
        const entry = this.stateFor(alias);
        const containerId = entry.metadata?.containerId;
        if (entry.provisioning || entry.lifecycleBusy) {
            return 'busy';
        }
        if (!containerId || entry.state === InstanceState.CredentialsMissing) {
            return 'unavailable';
        }

        const inspected = await this.runtime.inspectContainer(containerId);
        if (entry.metadata?.containerId !== containerId) {
            return 'busy';
        }
        if (!inspected) {
            // `inspectContainer` reports "could not ask" and "not there" the same way, so a stopped
            // daemon would otherwise be announced as a container someone deleted.
            return (await this.classifyUninspectableContainer()) ?? 'missing';
        }
        if (!this.isOwnedContainer(inspected, alias)) {
            return 'foreign';
        }
        return isRunning(inspected) ? 'ready' : 'stopped';
    }

    /**
     * Authoritatively validate a managed instance immediately before a tree expansion connects.
     * Unlike the root row's background freshness probe, this check blocks only explicit connection
     * intent so stale `Running` state can never reach the database client.
     *
     * Unlike {@link inspectManagedInstance} this corrects the in-memory state and warns about a
     * foreign container, so it belongs on paths where the user is waiting for the outcome.
     */
    public async prepareForConnection(alias: string = DEFAULT_ALIAS): Promise<QuickStartConnectionPreflightResult> {
        const verdict = await this.inspectManagedInstance(alias);
        const entry = this.stateFor(alias);

        switch (verdict) {
            case 'missing':
                if (!entry.missing) {
                    entry.missing = true;
                    this.statusEmitter.fire();
                }
                break;
            case 'foreign':
                void vscode.window.showWarningMessage(
                    l10n.t(
                        'The DocumentDB Local container can no longer be opened because it was created outside the extension. Remove it with Docker if you no longer need it.',
                    ),
                );
                break;
            case 'ready':
            case 'stopped': {
                const nextState = verdict === 'ready' ? InstanceState.Running : InstanceState.Stopped;
                if (entry.missing || entry.state !== nextState) {
                    this.setStatus(alias, nextState);
                }
                break;
            }
            default:
                break;
        }

        return verdict;
    }

    /**
     * Why an inspect came back empty, when the answer is not "the container is gone": `undefined`
     * means Docker answered normally, so the container really has been removed.
     */
    private async classifyUninspectableContainer(): Promise<'dockerUnreachable' | 'unavailable' | undefined> {
        let readiness: DockerReadiness;
        try {
            readiness = await this.checkDockerReadiness({ forceRefresh: true, suppressCommandEcho: true });
        } catch {
            return 'unavailable';
        }

        if (readiness.daemonReachable) {
            return undefined;
        }
        // An indeterminate probe (a timeout) is not evidence that Docker is down, so it only earns
        // the neutral wording.
        return readiness.outcome === 'diagnosed' ? 'dockerUnreachable' : 'unavailable';
    }

    /** Start a stopped instance (design §11). */
    public async start(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, 'starting', async () => {
            const id = this.stateFor(alias).metadata?.containerId;
            if (!id || !(await this.ensureActionable(id, alias, ['stopped']))) {
                return;
            }
            this.setStatus(alias, InstanceState.Starting);
            await this.runtime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(alias, InstanceState.Running);
            } else {
                this.setStatus(alias, InstanceState.Error, undefined, { key: 'startedButExited' });
            }
        });
    }

    /** Stop a running instance (design §11). */
    public async stop(alias: string = DEFAULT_ALIAS): Promise<void> {
        await this.runLifecycle(alias, 'stopping', async () => {
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
        await this.runLifecycle(alias, 'restarting', async () => {
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
                this.setStatus(alias, InstanceState.Error, undefined, { key: 'restartedButExited' });
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
     * Surface a Delete failure to the user and signal the `'error'` outcome. Used by every
     * unverifiable / failed removal path so the command never shows a false "deleted" toast and OUR
     * records are left intact (the instance stays in the tree so Delete can be retried).
     */
    private reportDeleteFailure(error: unknown): 'error' {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to delete the DocumentDB Local container: {0}', errMessage(error)),
        );
        return 'error';
    }

    /**
     * Remove the container, its data volume, and all stored metadata/credentials
     * (design §11 "Delete Container"). In v1 this is the full clean slate, since the
     * data-preserving "Reset" split is a v1.2 item; data is still preserved across
     * Stop/Start/Restart and an external-loss `Missing` → recreate (which keeps the
     * volume). Returns to NotInstalled.
     */
    public async deleteContainer(alias: string = DEFAULT_ALIAS): Promise<'deleted' | 'refused' | 'busy' | 'error'> {
        const outcome = await this.runLifecycle(
            alias,
            'deleting',
            async (): Promise<'deleted' | 'refused' | 'error'> => {
                const entry = this.stateFor(alias);
                // #9 guard: if we hold a specific container id/name, re-inspect it first. inspectContainer
                // swallows Docker errors and returns undefined, so an undefined result is inconclusive
                // here — but a RESOLVED foreign container (a name our old container no longer owns) must
                // NEVER be removed: refuse, leave OUR records intact, and let the command surface the
                // refusal instead of a false "deleted".
                const knownId = entry.metadata?.containerId;
                if (knownId) {
                    const inspected = await this.runtime.inspectContainer(knownId);
                    if (inspected && !this.isOwnedContainer(inspected, alias)) {
                        void vscode.window.showWarningMessage(
                            l10n.t(
                                'The DocumentDB Local container was not removed because it was created outside the extension. Remove it with Docker if you no longer need it.',
                            ),
                        );
                        return 'refused';
                    }
                }
                // Authoritatively resolve OUR containers by label + alias. Unlike inspectContainer,
                // listByLabel does NOT swallow errors: a Docker FAILURE throws (so "cannot verify" is never
                // mistaken for "already gone", which would wipe records for a still-live container and
                // resurface it as a credential-missing ghost — GPT-5.6 review), an empty result means our
                // container is confirmed gone, and any hit is a container we created. This also covers a
                // stale metadata id whose container was externally replaced by a new labelled same-alias
                // one: we remove the LIVE container, not the stale id.
                let owned: Array<{ id: string }>;
                try {
                    owned = await this.findManagedContainers(alias, { propagateErrors: true });
                } catch (error) {
                    return this.reportDeleteFailure(error);
                }
                // Delete is a full clean slate: remove EVERY label-matched container, not just one. A
                // cross-window double-create can leave more than one managed container for the alias
                // (reconcile adopts the newest and LEAVES the rest — see pickManagedContainer); removing
                // only the first would strand a survivor that resurfaces as a credential-missing ghost.
                for (const container of owned) {
                    // Do NOT swallow a real removal failure on OUR container: if Docker refuses to remove
                    // it (daemon error, permissions, etc.), the container may remain, so we must not claim
                    // success or wipe our records. Surface the error and keep the instance so the user can
                    // retry Delete (GPT-5.6 review: the toast must reflect the ACTUAL outcome).
                    try {
                        await this.runtime.removeContainer(container.id);
                    } catch (error) {
                        return this.reportDeleteFailure(error);
                    }
                }
                // owned is empty ⇒ our container is confirmed gone; fall through to clear OUR data volume +
                // records (the clean-slate Delete of a Missing / already-removed instance).
                // Explicit Delete is a full clean slate: drop the data volume too (alias-derived ⇒ ours by
                // construction). The container — the only resurrection vector — is now gone, so a volume
                // removal failure cannot bring the instance back; it only orphans data that the next
                // same-alias provision reclaims. Surface it as a non-blocking warning (not a silent
                // swallow) and still complete the delete rather than stranding a container-less instance.
                const volumeRemoved = await this.runtime
                    .removeVolume(volumeName(alias))
                    .then(() => true)
                    .catch(() => false);
                if (!volumeRemoved) {
                    void vscode.window.showWarningMessage(
                        l10n.t(
                            'The DocumentDB Local container was deleted, but its data volume could not be removed. You can remove it with Docker.',
                        ),
                    );
                }
                // Drop the instance's record AND its credentials in one write — an explicit Delete is a
                // full clean slate, so it no longer appears when the tree enumerates instances.
                await removeInstance(alias);
                await ClustersClient.deleteClient(clusterId(alias)).catch(() => undefined);
                CredentialCache.deleteCredentials(clusterId(alias));
                entry.metadata = undefined;
                this.setStatus(alias, InstanceState.NotInstalled);
                return 'deleted';
            },
        );
        // The op returns an explicit outcome; runLifecycle only yields undefined when the alias was
        // busy (op skipped) or a later best-effort cleanup step threw and was settled to Error. In
        // both cases nothing was reported deleted, so the caller must not report success.
        return outcome ?? 'busy';
    }

    /** In-flight background probe started by {@link refreshLiveStateInBackground}, if any. */
    private backgroundRefresh: Promise<void> | undefined;
    /** `Date.now()` when the last background probe settled — drives the cooldown below. */
    private lastBackgroundRefreshAt = 0;

    /** True while a {@link refreshLiveStateInBackground} probe is in flight. */
    public get isRefreshingLiveState(): boolean {
        return this.backgroundRefresh !== undefined;
    }

    /**
     * Fire-and-forget {@link refreshLiveState} for callers that must not block on Docker — notably
     * the tree's `getChildren()`, which the Connections view re-runs on many unrelated events
     * (review M6). The row renders from the last known state and is updated by
     * {@link onDidChangeStatus} when the probe lands.
     *
     * De-duplicated and rate-limited: concurrent calls share the in-flight probe, and a new one is
     * only started once {@link BACKGROUND_REFRESH_COOLDOWN_MS} has passed. The cooldown is
     * load-bearing — the probe fires the status event when it settles, which re-enters
     * `getChildren()`; without it that would rebuild the H1 render loop in a new shape.
     */
    public refreshLiveStateInBackground(): void {
        if (this.backgroundRefresh || Date.now() - this.lastBackgroundRefreshAt < BACKGROUND_REFRESH_COOLDOWN_MS) {
            return;
        }
        this.backgroundRefresh = this.refreshLiveState()
            .catch(() => {
                // refreshLiveState() is already best-effort; nothing to surface here.
            })
            .finally(() => {
                this.backgroundRefresh = undefined;
                this.lastBackgroundRefreshAt = Date.now();
                // Fire unconditionally (refreshLiveState() itself only fires on a real transition):
                // the row must drop the progress indicator. Safe because the cooldown above blocks
                // the re-render from starting another probe.
                this.statusEmitter.fire();
                this.operationEmitter.fire();
            });
        this.operationEmitter.fire();
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
                    // "Could not ask" and "not there" look identical here, so confirm the daemon is
                    // actually answering before claiming the container was removed — otherwise a
                    // stopped Docker turns the row into recreate guidance for a container that is
                    // still on disk.
                    if ((await this.classifyUninspectableContainer()) !== undefined) {
                        continue;
                    }
                    // Container is gone — keep metadata so the user can recreate. Fire only on the
                    // TRANSITION into `missing` (like every sibling branch below): the tree renders
                    // this node expanded, so an unconditional fire would re-enter getChildren() →
                    // refreshLiveState() → fire() and spin a `docker inspect` loop forever.
                    if (!entry.missing) {
                        entry.missing = true;
                        this.statusEmitter.fire();
                    }
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

    private async runLifecycle<T>(
        alias: string,
        kind: QuickStartOperationKind,
        op: () => Promise<T>,
    ): Promise<T | undefined> {
        const entry = this.stateFor(alias);
        if (entry.provisioning || entry.lifecycleBusy) {
            return undefined;
        }
        entry.lifecycleBusy = true;
        const endOperation = this.beginOperation(alias, kind);
        try {
            return await op();
        } catch (error) {
            this.setStatus(alias, InstanceState.Error, undefined, {
                key: 'unexpectedFailure',
                detail: errMessage(error),
            });
            return undefined;
        } finally {
            entry.lifecycleBusy = false;
            endOperation();
        }
    }

    /**
     * Demand-driven reconciliation (design §12 / risk-review): after a window reload the in-memory
     * state is lost while containers keep running. Enumerate every known instance — the union of the
     * durable store and the live labelled containers (grouped by the `vscode.documentdb.alias` label;
     * an absent/empty label is the DEFAULT instance) — and rebuild each alias's state. A
     * credential-less labelled container is SURFACED, never removed (R2); a stale pre-create
     * reservation (crashed host) is scavenged; a ready record whose container vanished becomes
     * Missing (recoverable via recreate).
     */
    public async reconcile(): Promise<void> {
        if (!this.reconciliation) {
            traceQuickStart('Deep reconciliation started.');
            this.reconciliation = this.performReconciliation()
                .then(() => {
                    traceQuickStart('Deep reconciliation completed.');
                })
                .catch((error: unknown) => {
                    traceQuickStart('Deep reconciliation failed; Docker state remains unknown.');
                    throw error;
                })
                .finally(() => {
                    this.reconciliation = undefined;
                });
        } else {
            traceQuickStart('Deep reconciliation joined the in-flight request.');
        }

        await this.reconciliation;
    }

    private async performReconciliation(): Promise<void> {
        const readiness = this.checkDockerReadiness({ suppressCommandEcho: true }).catch(() => undefined);
        const containersPromise = this.runtime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' }) as Promise<
            Array<{
                id: string;
                createdAt?: Date;
                labels?: Record<string, string>;
            }>
        >;
        const [containers, instances] = await Promise.all([containersPromise, listInstances(), readiness]);
        const now = Date.now();

        traceQuickStart(
            `Discovery returned ${containers.length} managed container(s) and ${instances.length} durable record(s).`,
        );

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

        // The DEFAULT always exists; also reconcile every known instance and every live alias.
        const aliases = new Set<string>([
            DEFAULT_ALIAS,
            ...instances.map((record) => record.alias),
            ...liveByAlias.keys(),
        ]);
        const scavenge = new Set<string>();
        for (const alias of aliases) {
            const record = instances.find((existing) => existing.alias === alias);
            const outcome = await this.reconcileAlias(alias, record, liveByAlias.get(alias) ?? [], now);
            if (outcome.scavenge) {
                scavenge.add(alias);
            }
        }

        // Drop stale pre-create reservations. Scavenge fires ONLY here (deep reconciliation), never
        // in the per-render refreshLiveState. (Adopted instances promote their own record to `ready`
        // inside adoptContainer.) Staleness is re-validated inside the store's lock, so a record a
        // concurrent finalize/adopt just promoted is never dropped.
        if (scavenge.size > 0) {
            await scavengeStaleLeases(scavenge);
        }

        const stateCounts = new Map<InstanceState, number>();
        for (const alias of aliases) {
            const state = this.stateFor(alias).state;
            stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
        }
        const stateSummary = [...stateCounts.entries()]
            .map(([state, count]) => `${state}=${count}`)
            .sort()
            .join(', ');
        traceQuickStart(`Reconciled ${aliases.size} instance(s): ${stateSummary}.`);
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
            this.setStatus(alias, InstanceState.CredentialsMissing, undefined, { key: 'credentialsUnavailable' });
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
            entry.error = undefined;
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
        // Make the store authoritative + clear any stale provisioning lease: an adopted container whose
        // credentials we hold IS ready (so a later container-loss becomes Missing, not scavenged). The
        // image is backfilled from the adopted container so a recreate AFTER this container is removed
        // + the window reloads still reuses the original image — never clearing an existing value.
        await upsertInstance({
            alias,
            displayName: record?.displayName ?? (alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias),
            port: running ? boundPort : (record?.port ?? boundPort),
            phase: 'ready',
            imageRef: adoptedImageRef ?? record?.imageRef,
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
export const QuickStartService: QuickStartServiceImpl = new QuickStartServiceImpl();

/** A stale env file is one older than this; younger ones may belong to a live provision. */
const ENV_FILE_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Best-effort activation sweep of `documentdb-quickstart-*.env` files left in `os.tmpdir()`
 * (L9). `provision()` deletes its env file in a `finally`, but an extension host killed between
 * the write and that `finally` leaves a plaintext password on disk. Only files older than
 * {@link ENV_FILE_STALE_AFTER_MS} are removed, so a provision running in another window — whose
 * image pull can take a while — never has its env file deleted underneath it.
 */
export async function sweepStaleQuickStartEnvFiles(): Promise<void> {
    try {
        const dir = os.tmpdir();
        const entries = await fs.readdir(dir);
        const cutoff = Date.now() - ENV_FILE_STALE_AFTER_MS;
        for (const entry of entries) {
            if (!/^documentdb-quickstart-[0-9a-f]{16}\.env$/.test(entry)) {
                continue;
            }
            const filePath = path.join(dir, entry);
            try {
                const stats = await fs.stat(filePath);
                if (stats.mtimeMs < cutoff) {
                    await fs.unlink(filePath);
                }
            } catch {
                // Raced with another window's cleanup, or not ours to delete — skip it.
            }
        }
    } catch {
        // Never let a tmpdir hiccup affect activation.
    }
}
