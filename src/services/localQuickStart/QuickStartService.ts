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
    getExitCode,
    getQuickStartOutputChannel,
    hasExited,
    type IContainerRuntime,
    isRunning,
    SETUP_CLEANUP_TIMEOUT_MS,
} from './ContainerRuntime';
import { DockerCommandError, DockerCommandTimeoutError } from './dockerCommand';
import { maskSecrets } from './outputMasking';
import {
    composeConnectionString,
    generateCredentials,
    type GeneratedCredentials,
    secretVariants,
} from './quickStartCredentials';
import { formatQuickStartMessage } from './quickStartMessages';
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
    const message = dockerErrorText(error).toLowerCase();
    return (
        message.includes('port is already allocated') ||
        message.includes('address already in use') ||
        (message.includes('bind') && message.includes('failed'))
    );
}

/**
 * The registry has no such tag. The classic and containerd image stores word it differently; a bare
 * "not found" is not enough, since a missing credential helper says "executable file not found".
 */
function isImageNotFound(error: unknown): boolean {
    return /manifest unknown|manifest for \S+ not found|failed to resolve reference .*: not found/i.test(
        dockerErrorText(error),
    );
}

/** Everything Docker printed, when the failure came from a Docker command. */
function dockerErrorText(error: unknown): string {
    return error instanceof DockerCommandError ? error.stderr : errMessage(error);
}

/**
 * Probe failures that no amount of waiting fixes: SASLprep rejecting the password on the client
 * (its messages cite RFC 4013, or RFC 3454 for mixed-direction text), or the server refusing the
 * credentials (AuthenticationFailed, 18).
 */
function describeCredentialRejection(error: unknown): QuickStartMessage | undefined {
    const message = errMessage(error);
    if (/rfc4013|rfc3454/i.test(message)) {
        return { key: 'passwordNotSupported' };
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const codeName = typeof error === 'object' && error !== null && 'codeName' in error ? error.codeName : undefined;
    if (code === 18 || codeName === 'AuthenticationFailed') {
        return { key: 'credentialsRejected', detail: message };
    }
    return undefined;
}

/** Once credentials are saved with the data, Configure no longer edits them; it only offers to erase the data. */
function describeReadinessFailure(reason: QuickStartMessage, savedWithData: boolean): QuickStartMessage {
    const credentialFailure = reason.key === 'credentialsRejected' || reason.key === 'passwordNotSupported';
    return credentialFailure && savedWithData ? { ...reason, key: 'savedCredentialsRejected' } : reason;
}

/**
 * The entrypoint's own last word on why it stopped, e.g. refusing a reserved username. Only lines
 * that start with the severity count: a healthy gateway also logs timestamped ERROR lines (a dropped
 * IPv6 probe) that would misexplain a `docker kill`.
 */
function lastContainerErrorLine(logs: string): string | undefined {
    const lines = logs.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index].trim();
        if (/^(?:error|fatal)\b/i.test(line)) {
            return line.replace(/^(?:error|fatal):?\s*/i, '');
        }
    }
    return undefined;
}

function describeLifecycleFailure(kind: QuickStartOperationKind, detail: string): string {
    const reason = detail.trim().replace(/\.+$/, '');
    switch (kind) {
        case 'starting':
            return l10n.t('We could not start DocumentDB Local: {0}. View the setup log for details.', reason);
        case 'stopping':
            return l10n.t('We could not stop DocumentDB Local: {0}. View the setup log for details.', reason);
        case 'restarting':
            return l10n.t('We could not restart DocumentDB Local: {0}. View the setup log for details.', reason);
        case 'deleting':
            return l10n.t('We could not delete DocumentDB Local: {0}. View the setup log for details.', reason);
        default:
            return l10n.t(
                'We could not complete the DocumentDB Local operation: {0}. View the setup log for details.',
                reason,
            );
    }
}

const READINESS_TIMEOUT_MS = 180_000;
/** Enough of an exited container's log to find the line that explains the exit. */
const EXITED_CONTAINER_LOG_LINES = 20;
/** Per-attempt server-selection timeout so a Cancel is observed within ~3s. */
const PROBE_SERVER_SELECTION_TIMEOUT_MS = 3_000;
/**
 * The image ships a native init script + sample-data directory (see
 * `Dockerfile_documentdb_local`). We run that script ONCE via `docker exec` after
 * the gateway is ready, instead of baking `--init-data true` into the run args:
 * older images re-run the baked flag on every Stop/Start, hit a duplicate-key error,
 * and crash the container (`set -e`). Exec-once keeps restarts safe while loading
 * the image's sample data. `-P` is the container's
 * internal gateway port (always {@link QUICK_START_PORT} inside the container,
 * independent of the bound host port).
 */
const SAMPLE_DATA_INIT_SCRIPT = '/home/documentdb/gateway/scripts/init_documentdb_data.sh';
const SAMPLE_DATA_DIR = '/home/documentdb/gateway/sample-data';
/**
 * After a `docker start`, a container that re-runs a failing entrypoint reports
 * "running" for a moment before exiting, so a single immediate inspect can be a
 * false positive. We poll {@link START_CONFIRM_ATTEMPTS} times to require it stays up.
 */
const START_CONFIRM_ATTEMPTS = 3;
const START_CONFIRM_INTERVAL_MS = 1_500;
/** How long Start/Restart wait for a just-stopped container's port to come free before blaming another process. */
const PORT_RELEASE_RETRIES = 3;
const PORT_RELEASE_INTERVAL_MS = 500;

/**
 * Minimum gap between two background live-state probes (review M6). The Connections view refreshes
 * on many unrelated events; without a cooldown the tree would spawn a `docker inspect` per render.
 */
const BACKGROUND_REFRESH_COOLDOWN_MS = 5_000;

/** `docker ps` may print a short id where `docker run` returned the full one, or we only kept the name. */
function isSameContainer(container: { id: string; name?: string }, idOrName: string): boolean {
    return container.name === idOrName || container.id.startsWith(idOrName) || idOrName.startsWith(container.id);
}

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
 * The readiness wait hit something waiting longer cannot fix: the container exited, or the
 * credentials were refused. `reason` is what the user sees; the error message stays free of it,
 * because it can quote a custom username and error messages reach telemetry.
 */
class ReadinessFailedError extends Error {
    constructor(readonly reason: QuickStartMessage) {
        super(reason.key);
        this.name = 'ReadinessFailedError';
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
    /** This run's lease, so a discard releases it like a failed attempt would. */
    readonly operationId: string;
    readonly leaseHeld: boolean;
    /** What this run stored before `docker run`; a discard only undoes it while it is still there. */
    readonly storedConnectionString: string;
    /** Stored before this run wrote its own; a discarded reuse puts it back. */
    readonly previousConnectionString: string | undefined;
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
    /**
     * The container and its data volume were both found gone, so there is nothing to recreate. The
     * record and credentials are left alone: a Docker pointed at another engine looks the same.
     */
    dataRemoved: boolean;
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
 * when BOTH a username and password are supplied, otherwise auto-generate. They are used
 * exactly as validated: trimming would store a password other than the one the user typed.
 * (Callers only use this on a non-reusing provision; a Missing-recreate reuses stored creds.)
 */
function resolveProvisionCredentials(options?: AdvancedQuickStartOptions): GeneratedCredentials {
    const username = options?.username;
    const password = options?.password;
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
                dataRemoved: false,
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
            dataRemoved: entry.dataRemoved,
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
            entry.dataRemoved = false;
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
        valuesToMask: ReadonlyArray<string> = [],
    ): Promise<T> {
        // Throwing inside the callback is what records the stage as Failed. The error is captured and
        // re-thrown here rather than via `errorHandling.rethrow`, which the framework ignores for a
        // UserCancelledError — provisioning must never continue past a failed stage.
        let result!: T;
        let operationError: Error | undefined;
        await callWithTelemetryAndErrorHandling('documentDB.quickstart.provision.stage', async (telemetryContext) => {
            telemetryContext.errorHandling.suppressDisplay = true;
            // Docker's error lines can quote the image ref, whose tag the user typed.
            telemetryContext.valuesToMask.push(...valuesToMask);
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
        const stored = startFresh ? undefined : await this.getReusableCredentials(alias);
        const wantsCustomCredentials = !!(options?.username && options?.password);
        // With its data gone this is a new instance, set up as the wizard showed it. It still keeps the
        // stored credentials unless the user chose others, so a Docker pointed back at the original
        // engine can still open that one.
        const dataRemoved = stored !== undefined && (await this.isDataStillRemoved(alias));
        const reusing = stored !== undefined && !dataRemoved;
        const credentials =
            (reusing || (dataRemoved && !wantsCustomCredentials) ? stored : undefined) ??
            resolveProvisionCredentials(options);
        const secrets: string[] = secretVariants(credentials.password);

        // Advanced overrides (P1-4). When reusing an existing instance we keep its data volume,
        // so custom credentials AND a custom image tag are intentionally IGNORED: the stored
        // credentials are required to open the volume's cluster, and recreating onto it with a
        // different (especially older) image version could leave the on-disk cluster unusable.
        // The original image is reused — from in-memory metadata, falling back to the stored record
        // (survives a window reload), then the default if neither is known.
        const usedCustomCreds = !reusing && wantsCustomCredentials;
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
        let createTimedOut = false;
        // Owner nonce for this run: stamped on the container (H4) and on the provisioning lease (H3),
        // so both the cleanup sweep and the registry reservation are provably this run's own. This is
        // load-bearing today for concurrent windows, not only for the multi-instance seam.
        const operationId = crypto.randomBytes(8).toString('hex');
        let leaseHeld = false;
        // What this run persisted before `docker run` (H3), and what was stored before it, so a failed
        // attempt can restore the previous state exactly.
        let earlySecret: string | undefined;
        let previousStoredConnectionString: string | undefined;
        let readinessEnvironment: DockerHostEnvironment | undefined;
        // Whether this run mounts a volume that already existed; otherwise its `docker run` creates it.
        let reusesVolume = reusing;
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
            // ours, D9). The data volume survives this; it is only dropped later, right before
            // `docker run`, and only when not reusing.
            const existing = await this.findManagedContainer(alias);
            let hasReadyRecord = (await getInstance(alias))?.phase === 'ready';
            // RR4 / §5.2 volume-wipe gate: NEVER silently destroy an existing instance's data. A
            // managed container, a durable `ready` record or the data volume itself (its container
            // pruned, or created from another VS Code profile) all mean data this profile can't open
            // may exist. Only an explicit "Start fresh" from the Configure step may wipe it (#946).
            if (!reusing && !startFresh) {
                const volumeAtGate = await this.runtime.volumeExists(volumeName(alias));
                if (!existing && !volumeAtGate && hasReadyRecord) {
                    // Its container and data volume were both removed outside VS Code, so the record
                    // protects nothing: set up from scratch instead of refusing for good. Credentials
                    // this run keeps are only replaced by its own write, which a failure rolls back.
                    if (credentials !== stored) {
                        await removeInstance(alias);
                        hasReadyRecord = false;
                    }
                } else if (existing || hasReadyRecord || volumeAtGate) {
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
            await this.runProvisionStage(
                'pulling',
                journeyCorrelationId,
                async () => {
                    await this.runtime.pullImage(imageRef, cts.token);
                    this.throwIfAborted(signal);
                },
                [imageRef],
            );
            activeDockerStage = undefined;
            yield stageEvent('pulling', 'done');

            // --- creating (docker run -d creates and starts) ---
            yield stageEvent('creating', 'active');
            if (leaseHeld) {
                await this.renewProvisioningLease(alias, operationId, chosenPort);
            }
            // Write credentials to a temp env-file (deleted right after `docker run`) so they never
            // appear on the docker CLI / host process list (design §8.2). The image
            // reads USERNAME/PASSWORD from the environment.
            const createdEnvFilePath = await this.writeEnvFile(credentials.username, credentials.password);
            envFilePath = createdEnvFilePath;
            activeDockerStage = 'creating';
            const volumeOnDisk = await this.runtime.volumeExists(volumeName(alias));
            // The gate saw no volume, so one here appeared during the pull and isn't ours to remove.
            if (!reusing && !startFresh && volumeOnDisk) {
                throw new Error(
                    l10n.t(
                        'We found an existing data volume after the image downloaded. Setup stopped to protect its data. Go back to Configure and try again.',
                    ),
                );
            }
            // Retained credentials don't prove the volume survived (e.g. Start over after a timeout
            // removed it), and only data that is really kept should skip the sample seed.
            reusesVolume = reusing && volumeOnDisk;
            this.throwIfAborted(signal);
            // Drop the old data volume only now that the port is checked and the image is local, so a
            // failed check, pull or Cancel leaves it intact (#946). Fresh credentials need a clean
            // cluster; a reuse keeps the volume. A failed removal (e.g. another container mounts it) is
            // fatal: carrying on would start the new credentials against the old cluster.
            if (!reusing && volumeOnDisk) {
                try {
                    await this.runtime.removeVolume(volumeName(alias));
                } catch (error) {
                    throw new Error(
                        l10n.t(
                            'We could not remove the existing data volume. Check whether another container is using it, then try again. Docker reported: {0}',
                            errMessage(error),
                        ),
                    );
                }
            }
            // Start fresh has just erased what the record describes, so this run owns the alias from
            // here: a failure then leaves nothing behind that still claims the old data.
            if (startFresh && hasReadyRecord) {
                await removeInstance(alias);
                hasReadyRecord = false;
                leaseHeld = true;
                await this.renewProvisioningLease(alias, operationId, chosenPort);
            }
            // Persist the credentials BEFORE `docker run` (H3), and after anything that removes the
            // previous instance. Written any later, a host killed once the container exists leaves
            // a labelled container nothing can open; written here, a reload adopts it instead. A
            // failed attempt restores the previous value in `finally`.
            previousStoredConnectionString = await this.readStoredConnectionString(alias);
            const plannedConnectionString = composeConnectionString(
                credentials.username,
                credentials.password,
                chosenPort,
            );
            await writeConnectionString(alias, plannedConnectionString, {
                displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                port: chosenPort,
            });
            earlySecret = plannedConnectionString;
            createAttempted = true;
            containerId = await this.runProvisionStage(
                'creating',
                journeyCorrelationId,
                async () => {
                    let createdContainerId: string | undefined;
                    try {
                        createdContainerId = await this.runtime.createAndRunContainer(
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
                                // `--init-data true`: older images re-run it on every
                                // Stop/Start and crash on duplicate keys; sample data is seeded
                                // once, post-readiness, via `docker exec` (see seedSampleData).
                                environmentFiles: [createdEnvFilePath],
                            },
                            secrets,
                            cts.token,
                        );
                    } finally {
                        // Docker reads the env-file at create time; don't keep the password on disk through the readiness wait.
                        // A failed delete (e.g. a scanner holding the file on Windows) keeps the path for the retry below.
                        if (await this.removeEnvFile(createdEnvFilePath)) {
                            envFilePath = undefined;
                        }
                    }
                    this.throwIfAborted(signal);
                    return createdContainerId;
                },
                [imageRef],
            );
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
                reusing: reusesVolume,
                operationId,
                leaseHeld,
                storedConnectionString: plannedConnectionString,
                previousConnectionString: previousStoredConnectionString,
            };
            this.stateFor(alias).pendingReadiness = pending;
            if (leaseHeld) {
                await this.renewProvisioningLease(alias, operationId, boundPort);
            }
            await this.runProvisionStage('waiting', journeyCorrelationId, async () => {
                await this.waitForReadiness(connectionString, provisionedContainerId, secrets, signal, cts.token);
                this.throwIfAborted(signal);

                // --- success (seed sample data, store creds, adopt as Running) ---
                await this.finalizeReadyInstance(pending, cts.token, signal);
            });
            success = true;
            yield stageEvent('waiting', 'done');
            yield stageEvent('done', 'done', { key: 'instanceRunning', port: boundPort }, boundPort);
        } catch (error) {
            const aborted = signal.aborted;
            createTimedOut = error instanceof DockerCommandTimeoutError;
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
                // `detail` carries the driver's last error, which can echo the connection string.
                channel.appendLine(`[readiness-timeout] ${maskSecrets(detail, secrets)}`);
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
                    } else if (activeDockerStage === 'creating' && error instanceof DockerCommandTimeoutError) {
                        message = { key: 'createTimedOut' };
                    } else if (activeDockerStage === 'pulling' && usedCustomImage && isImageNotFound(error)) {
                        // Only a tag the user typed can be fixed in Configure; otherwise Docker's line stands.
                        message = { key: 'imageNotFound', image: imageRef };
                    } else if (error instanceof ReadinessFailedError) {
                        message = describeReadinessFailure(error.reason, reusing);
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
                // Only a run that got a container can have created the volume; otherwise it may be someone else's.
                let ownsContainer = false;
                // Cleanup (D12): when a container exists, stop+remove it.
                // Bounded only after a hung `docker run`: the same daemon may hang these too.
                const cleanupBounds = createTimedOut ? { timeoutMs: SETUP_CLEANUP_TIMEOUT_MS } : undefined;
                if (containerCreated && containerId) {
                    ownsContainer = true;
                    channel.appendLine(`Cleaning up container ${containerId}…`);
                    await this.runtime
                        .stopContainer(containerId, cleanupBounds)
                        .catch(() => meterQuickStartSilentCatch('provision_cleanupStopContainer'));
                    await this.runtime
                        .removeContainer(containerId, undefined, cleanupBounds)
                        .catch(() => meterQuickStartSilentCatch('provision_cleanupRemoveContainer'));
                } else if (createAttempted && !containerId) {
                    // The CLI may have been killed after the daemon created the container but
                    // before its id was captured — sweep by label. Scoped to THIS run's
                    // `operationId` (H4): an unscoped by-alias sweep would happily remove the
                    // container another window had just created, since the loser of a two-window
                    // create race reaches exactly this branch (its `docker run` failed on the
                    // duplicate name).
                    const orphans = await this.runtime
                        .listByLabel(
                            {
                                [QUICK_START_LABEL_KEY]: '1',
                                [QUICK_START_OPERATION_LABEL_KEY]: operationId,
                            },
                            cleanupBounds,
                        )
                        .catch(() => {
                            meterQuickStartSilentCatch('provision_listOrphanedContainers');
                            return [];
                        });
                    ownsContainer = orphans.length > 0;
                    for (const orphan of orphans) {
                        channel.appendLine(`Removing orphaned container ${orphan.id}…`);
                        await this.runtime
                            .removeContainer(orphan.id, undefined, cleanupBounds)
                            .catch(() => meterQuickStartSilentCatch('provision_removeOrphanedContainer'));
                    }
                }
                // A volume this run's `docker run` created is ours to drop, so a retry doesn't
                // hit the volume gate above. Docker refuses if another container still mounts it.
                if (ownsContainer && !reusesVolume) {
                    await this.runtime
                        .removeVolume(volumeName(alias))
                        .catch(() => meterQuickStartSilentCatch('provision_cleanupRemoveVolume'));
                }
                await this.rollBackAttempt(alias, {
                    storedConnectionString: earlySecret,
                    previousConnectionString: previousStoredConnectionString,
                    operationId,
                    leaseHeld,
                    port: chosenPort,
                });
                // Interrupted before settling (cancel / unsubscribe) → reset state.
                // The error path already settled to `Error` in `catch`.
                if (this.stateFor(alias).state === InstanceState.Provisioning) {
                    this.setStatus(alias, InstanceState.NotInstalled, undefined, undefined);
                }
            }
            signal.removeEventListener('abort', onAbort);
            cts.dispose();
            // Retry: set only if something threw before `docker run` or the creating stage's delete failed.
            if (envFilePath) {
                await this.removeEnvFile(envFilePath);
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
            // Echo only failing probes: a healthy `docker info` dump would bury the real error in the setup log.
            const readiness = await this.checkDockerReadiness({ forceRefresh: true, suppressCommandEcho: true });
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
        // sample data", default on) and only into a fresh volume. A reused volume already had its
        // first setup; seeding it again would restore documents the user deleted (#946). Best-effort.
        if (pending.sampleDataRequested && !pending.reusing) {
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
                await this.waitForReadiness(
                    pending.connectionString,
                    pending.containerId,
                    secretVariants(pending.password),
                    signal,
                    cts.token,
                );
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
                  : error instanceof ReadinessFailedError
                    ? // The timeout that led here kept the credentials and data, so setup now offers to reuse them.
                      describeReadinessFailure(error.reason, true)
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
     * slate. A reusing attempt's volume holds the user's existing data, so it is kept, and the
     * instance settles as Missing. Returns `false` (a no-op) when nothing can be discarded yet — a
     * just-cancelled resume is still unwinding, or Docker could not remove the container — so the
     * webview can keep the timed-out actions instead of dropping to review with the container still
     * running.
     */
    public async discardTimedOutInstance(alias: string = DEFAULT_ALIAS): Promise<boolean> {
        const entry = this.stateFor(alias);
        // Guard BEFORE mutating: if a provision/lifecycle op is running, leave the retained
        // state untouched (clearing it here would orphan the still-running container).
        if (entry.provisioning || entry.lifecycleBusy) {
            return false;
        }
        // Already gone, e.g. deleted from the tree while this panel showed the timeout: nothing to do.
        if (!entry.pendingReadiness) {
            return true;
        }
        const pending = entry.pendingReadiness;
        entry.pendingReadiness = undefined;
        entry.lifecycleBusy = true;
        try {
            await this.runtime
                .stopContainer(pending.containerId)
                .catch(() => meterQuickStartSilentCatch('discardTimedOut_stopContainer'));
            const removed = await this.runtime.removeContainer(pending.containerId).then(
                () => true,
                // Already gone counts as removed, but only a lookup that succeeded can say so. Another
                // window's replacement container is not the one this attempt kept.
                () =>
                    this.findManagedContainers(alias, { propagateErrors: true }).then(
                        (left) => !left.some((container) => isSameContainer(container, pending.containerId)),
                        () => false,
                    ),
            );
            if (!removed) {
                // Keep the container resumable and its credentials in place: dropping them now would
                // leave a container nothing can open once Docker answers again.
                meterQuickStartSilentCatch('discardTimedOut_removeContainer');
                await this.runtime.startContainer(pending.containerId).catch(() => undefined);
                entry.pendingReadiness = pending;
                void vscode.window.showErrorMessage(
                    l10n.t(
                        'Start over did not finish because Docker could not remove the DocumentDB Local container. Try again once Docker responds.',
                    ),
                );
                return false;
            }
            if (!pending.reusing) {
                await this.runtime
                    .removeVolume(volumeName(pending.alias))
                    .catch(() => meterQuickStartSilentCatch('discardTimedOut_removeVolume'));
            }
            // The same rollback a failed attempt gets. Left behind, its secret and lease made a reload
            // show "Provisioning…" and the next setup offer to keep data that no longer exists.
            await this.rollBackAttempt(alias, {
                storedConnectionString: pending.storedConnectionString,
                previousConnectionString: pending.previousConnectionString,
                operationId: pending.operationId,
                leaseHeld: pending.leaseHeld,
                port: pending.boundPort,
            });
            await this.resync(alias).catch(() => {
                meterQuickStartSilentCatch('discardTimedOut_resync');
                this.setStatus(alias, InstanceState.NotInstalled);
            });
            return true;
        } finally {
            entry.lifecycleBusy = false;
        }
    }

    /**
     * Probe the wire protocol until the DB answers `ping`, up to {@link READINESS_TIMEOUT_MS}. Gives
     * up at once when waiting cannot help, so a timeout (and its "Wait longer") only ever means the
     * container is up but not accepting connections yet.
     */
    private async waitForReadiness(
        connectionString: string,
        containerId: string,
        secrets: ReadonlyArray<string>,
        signal: AbortSignal,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const deadline = Date.now() + READINESS_TIMEOUT_MS;
        let attempt = 0;
        let lastError: unknown;
        let rejectedLastAttempt = false;
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
                const rejection = describeCredentialRejection(error);
                // SASLprep fails on this machine and cannot change; a server refusal has to repeat,
                // in case an image starts its gateway before the user exists.
                if (rejection && (rejection.key === 'passwordNotSupported' || rejectedLastAttempt)) {
                    throw new ReadinessFailedError(rejection);
                }
                rejectedLastAttempt = rejection !== undefined;
                lastError = error;
            } finally {
                await client.close().catch(() => undefined);
            }
            await this.throwIfContainerExited(containerId, secrets, token);
            attempt += 1;
            const backoff = Math.min(3000, 500 + attempt * 250);
            await delay(backoff, signal);
        }
        await this.throwIfContainerExited(containerId, secrets, token);
        throw new ReadinessTimeoutError(
            `Timed out waiting for DocumentDB to accept connections.${lastError ? ` (${errMessage(lastError)})` : ''}`,
        );
    }

    private async throwIfContainerExited(
        containerId: string,
        secrets: ReadonlyArray<string>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const inspected = await this.runtime.inspectContainer(containerId, { quiet: true, token });
        // An inspect that failed says nothing about the container, so keep waiting.
        if (!inspected || !hasExited(inspected)) {
            return;
        }
        const logs = await this.runtime
            .readRecentLogs(containerId, EXITED_CONTAINER_LOG_LINES, secrets, token)
            .catch(() => {
                meterQuickStartSilentCatch('readiness_readExitedContainerLogs');
                return '';
            });
        throw new ReadinessFailedError({
            key: 'containerExited',
            exitCode: getExitCode(inspected),
            detail: lastContainerErrorLine(logs),
        });
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
     * input reaches the script. Image 0.116 requires `DOCUMENTDB_PASSWORD` instead of
     * `-p`. Detect that capability from --help so older image-tag overrides still work,
     * without retrying a failed initialization that may already have modified data.
     */
    private async seedSampleData(
        containerId: string,
        secrets: ReadonlyArray<string>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        try {
            const initCommand = `${SAMPLE_DATA_INIT_SCRIPT} -H localhost -P ${QUICK_START_PORT} -u "$USERNAME" -d ${SAMPLE_DATA_DIR}`;
            const script =
                `init_help="$(${SAMPLE_DATA_INIT_SCRIPT} --help)" || exit $?; ` +
                `case "$init_help" in ` +
                `*DOCUMENTDB_PASSWORD*) DOCUMENTDB_PASSWORD="$PASSWORD" ${initCommand} ;; ` +
                `*) ${initCommand} -p "$PASSWORD" ;; ` +
                `esac`;
            await this.runtime.execShellInContainer(containerId, script, secrets, token);
        } catch (error) {
            getQuickStartOutputChannel().appendLine(`Sample data load skipped: ${errMessage(error)}`);
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
        return !this.stateFor(alias).dataRemoved && (await this.getReusableCredentials(alias)) !== undefined;
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
     * container off the command line / process list (§8.2). The caller deletes it as soon
     * as `docker run` settles. The `--env-file` format is line-based `KEY=VALUE` with no quoting,
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
        const filePath = path.join(os.tmpdir(), envFileName(process.pid, crypto.randomBytes(8).toString('hex')));
        try {
            await fs.writeFile(filePath, `USERNAME=${username}\nPASSWORD=${password}\n`, { mode: 0o600 });
        } catch (error) {
            // A write that fails part-way can leave the password behind, and no caller ever learns this path.
            await this.removeEnvFile(filePath);
            throw error;
        }
        return filePath;
    }

    /** Returns false when the file could not be deleted, so the caller can retry later. */
    private async removeEnvFile(filePath: string): Promise<boolean> {
        try {
            await fs.rm(filePath, { force: true });
            return true;
        } catch {
            meterQuickStartSilentCatch('provision_removeEnvironmentFile');
            return false;
        }
    }

    /**
     * Undo what an abandoned attempt stored (H3): put back the credentials it replaced and drop its
     * pre-create reservation, so neither a phantom "Provisioning…" row nor its unusable secret is
     * left behind. Only while they are still its own: the loser of a two-window race must not erase
     * what the winner stored since.
     */
    private async rollBackAttempt(
        alias: string,
        attempt: {
            readonly storedConnectionString: string | undefined;
            readonly previousConnectionString: string | undefined;
            readonly operationId: string;
            readonly leaseHeld: boolean;
            readonly port: number;
        },
    ): Promise<void> {
        let stillOurs = true;
        if (attempt.storedConnectionString !== undefined) {
            try {
                stillOurs = (await this.readStoredConnectionString(alias)) === attempt.storedConnectionString;
                if (stillOurs) {
                    await writeConnectionString(alias, attempt.previousConnectionString ?? null, {
                        displayName: alias === DEFAULT_ALIAS ? DEFAULT_INSTANCE_DISPLAY_NAME : alias,
                        port: attempt.port,
                    });
                }
            } catch {
                // Best-effort; a stuck secret is surfaced by the next reconcile.
                meterQuickStartSilentCatch('provision_restoreCredentials');
            }
        }
        if (attempt.leaseHeld && stillOurs) {
            await this.releaseProvisioningLease(alias, attempt.operationId);
        }
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
    ): Promise<Array<{ id: string; name?: string; labels?: Record<string, string> }>> {
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

    /** `undefined` when Docker could not say; callers treat that as "may still exist". */
    private async dataVolumeExists(alias: string): Promise<boolean | undefined> {
        try {
            return await this.runtime.volumeExists(volumeName(alias));
        } catch {
            return meterQuickStartSilentCatch('dataVolumeExists');
        }
    }

    /**
     * The container is gone. With its volume still there it is Missing and a recreate brings the
     * data back; with the volume gone too, nothing is left to recreate.
     */
    private async markContainerMissing(alias: string): Promise<'missing' | 'removed'> {
        if ((await this.dataVolumeExists(alias)) === false) {
            this.markDataRemoved(alias);
            return 'removed';
        }
        const entry = this.stateFor(alias);
        if (!entry.missing) {
            entry.missing = true;
            this.statusEmitter.fire();
        }
        return 'missing';
    }

    /** Shown as not set up. The record and credentials stay, see {@link InstanceRuntimeState.dataRemoved}. */
    private markDataRemoved(alias: string): void {
        const entry = this.stateFor(alias);
        entry.metadata = undefined;
        entry.dataRemoved = true;
        this.setStatus(alias, InstanceState.NotInstalled);
    }

    /** Re-checked before provision trusts it: Docker pointed back at the original engine brings the data back. */
    private async isDataStillRemoved(alias: string): Promise<boolean> {
        return (
            this.stateFor(alias).dataRemoved &&
            !(await this.findManagedContainer(alias)) &&
            (await this.dataVolumeExists(alias)) === false
        );
    }

    /** Describes an instance whose container is gone from what the store kept of it. */
    private metadataFromRecord(record: QuickStartInstanceRecord, stored: string): InstanceMetadata {
        let username = '';
        try {
            username = new DocumentDBConnectionString(stored).username;
        } catch {
            username = '';
        }
        return {
            // The id went with the container; a recreate reuses the name.
            containerId: containerName(record.alias),
            alias: record.alias,
            boundPort: record.port,
            clusterId: clusterId(record.alias),
            connectionString: stored,
            username,
            imageRef: record.imageRef,
        };
    }

    /** Re-derive one alias's state after an operation changed both the store and Docker. */
    private async resync(alias: string): Promise<void> {
        const containers = await this.findManagedContainers(alias);
        const outcome = await this.reconcileAlias(alias, await getInstance(alias), containers, Date.now());
        if (outcome.scavenge) {
            await scavengeStaleLeases([alias]);
        }
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
        if (!item) {
            // Missing: deleted/pruned outside VS Code. Mark it here rather than via
            // refreshLiveState(), which skips the lifecycle-busy alias, and say so, so the click is
            // not a silent no-op. Only promise the data back when its volume is still there.
            if ((await this.markContainerMissing(alias)) === 'removed') {
                const setUp = l10n.t('Set up DocumentDB Local');
                void vscode.window
                    .showInformationMessage(
                        l10n.t(
                            'The DocumentDB Local container and its data were removed outside VS Code. Set it up again to create a new instance.',
                        ),
                        setUp,
                    )
                    .then((choice) =>
                        choice === setUp
                            ? vscode.commands.executeCommand('vscode-documentdb.command.localQuickStart.open')
                            : undefined,
                    );
            } else {
                void vscode.window.showInformationMessage(
                    l10n.t(
                        'The DocumentDB Local container was removed outside VS Code. Click the instance to recreate it (your data is preserved), or use "Delete Container" to remove it and its data.',
                    ),
                );
            }
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
                await this.markContainerMissing(alias);
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
            if (
                !id ||
                !(await this.ensureActionable(id, alias, ['stopped'])) ||
                !(await this.ensurePortFree(alias, false))
            ) {
                return;
            }
            this.setStatus(alias, InstanceState.Starting);
            await this.runtime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(alias, InstanceState.Running);
            } else {
                const message: QuickStartMessage = { key: 'startedButExited' };
                this.setStatus(alias, InstanceState.Error, undefined, message);
                this.reportLifecycleFailure(formatQuickStartMessage(message));
            }
        });
    }

    /**
     * The same port check setup runs. Docker Desktop on WSL starts a container even while a WSL
     * process holds its port, and the instance then answers nothing it should. The container is left
     * stopped and untouched, so Start works again once the port is free.
     */
    private async ensurePortFree(alias: string, justStopped: boolean): Promise<boolean> {
        const port = this.stateFor(alias).metadata?.boundPort;
        if (port === undefined) {
            return true;
        }
        // Docker Desktop releases a stopped container's port a moment after `docker stop` returns.
        for (let attempt = 0; attempt <= PORT_RELEASE_RETRIES; attempt++) {
            if (attempt > 0) {
                await new Promise((resolve) => setTimeout(resolve, PORT_RELEASE_INTERVAL_MS));
            }
            if (await this.runtime.isPortFree(port)) {
                return true;
            }
        }
        void vscode.window.showErrorMessage(
            justStopped
                ? l10n.t(
                      'DocumentDB Local was stopped but not started again because port {0} is in use by another process. Stop that process, then start DocumentDB Local.',
                      String(port),
                  )
                : l10n.t(
                      'DocumentDB Local was not started because port {0} is already in use by another process. Stop that process, then start DocumentDB Local again.',
                      String(port),
                  ),
        );
        return false;
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
            const stopped = await this.runtime.stopContainer(id).then(
                () => true,
                () => false,
            );
            // Only once stopped: until then the container itself holds the port.
            if (stopped && !(await this.ensurePortFree(alias, true))) {
                this.setStatus(alias, InstanceState.Stopped);
                return;
            }
            this.setStatus(alias, InstanceState.Starting);
            await this.runtime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(alias, InstanceState.Running);
            } else {
                const message: QuickStartMessage = { key: 'restartedButExited' };
                this.setStatus(alias, InstanceState.Error, undefined, message);
                this.reportLifecycleFailure(formatQuickStartMessage(message));
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
                // removal failure cannot bring the instance back; the next setup finds the leftover volume and
                // asks the user to start fresh. Surface it as a non-blocking warning (not a silent
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
                entry.dataRemoved = false;
                // Otherwise a reopened wizard offers "Wait longer" for the container just removed.
                entry.pendingReadiness = undefined;
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
            if (entry.state === InstanceState.CredentialsMissing && !entry.provisioning && !entry.lifecycleBusy) {
                // Once its container and volume are both gone, nothing is left that needs the lost
                // credentials, and setup should not warn about erasing it.
                const containers = await this.findManagedContainers(alias, { propagateErrors: true }).catch(
                    () => undefined,
                );
                if (containers?.length === 0 && (await this.dataVolumeExists(alias)) === false) {
                    this.markDataRemoved(alias);
                }
                continue;
            }
            // A container kept after a readiness timeout is still initializing; Wait longer owns it.
            if (entry.pendingReadiness) {
                continue;
            }
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
                    // still on disk. Once it is known missing, only its volume can change the answer.
                    if (!entry.missing && (await this.classifyUninspectableContainer()) !== undefined) {
                        continue;
                    }
                    // Fires only on the TRANSITION (like every sibling branch below): the tree renders
                    // this node expanded, so an unconditional fire would re-enter getChildren() →
                    // refreshLiveState() → fire() and spin a `docker inspect` loop forever.
                    await this.markContainerMissing(alias);
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
            this.reportLifecycleFailure(describeLifecycleFailure(kind, errMessage(error)));
            return undefined;
        } finally {
            entry.lifecycleBusy = false;
            endOperation();
        }
    }

    /** The tree row only turns to Error, so this is the one place the reason is visible. */
    private reportLifecycleFailure(text: string): void {
        const viewLog = l10n.t('View setup log');
        void vscode.window.showErrorMessage(text, viewLog).then((choice) => {
            if (choice === viewLog) {
                getQuickStartOutputChannel().show();
            }
        });
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
            // An operation running in this window owns the alias until it settles; reconciling now
            // would adopt or scavenge its half-written state.
            const entry = this.stateFor(alias);
            if (entry.provisioning || entry.lifecycleBusy) {
                continue;
            }
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
            this.stateFor(alias).metadata = undefined;
            this.setStatus(alias, InstanceState.NotInstalled);
            return { scavenge: true };
        }
        if (record?.phase === 'ready') {
            if ((await this.dataVolumeExists(alias)) === false) {
                // Removed together with its data volume: nothing is left to recreate.
                this.markDataRemoved(alias);
                return {};
            }
            const stored = await this.readStoredConnectionString(alias);
            if (!stored) {
                // The data is still on disk but nothing can open it; setup must offer Start fresh
                // up front rather than refuse after the click.
                this.setStatus(alias, InstanceState.CredentialsMissing, undefined, { key: 'credentialsUnavailable' });
                return {};
            }
            // Case 3: a known ready instance whose container vanished ⇒ Missing (recoverable via a
            // recreate that reuses the volume). Keep the record, and rebuild the metadata the tree
            // needs to offer Recreate/Delete rather than "Set up".
            const entry = this.stateFor(alias);
            entry.metadata = this.metadataFromRecord(record, stored);
            entry.dataRemoved = false;
            entry.missing = true;
            entry.state = InstanceState.Stopped;
            entry.port = record.port;
            entry.error = undefined;
            this.statusEmitter.fire();
            return {};
        }
        // No record and no container (only the always-present DEFAULT reaches here) ⇒ NotInstalled.
        this.stateFor(alias).metadata = undefined;
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

/** Any env file older than this is stale; covers legacy PID-less names and a reused PID. */
const ENV_FILE_STALE_AFTER_MS = 60 * 60 * 1000;

const ENV_FILE_PATTERN = /^documentdb-quickstart-(?:(\d+)-)?[0-9a-f]{16}\.env$/;

/**
 * Temp env-file name; must stay matched by {@link ENV_FILE_PATTERN}. The owning PID lets the
 * activation sweep reclaim a crashed host's file right away.
 */
export function envFileName(pid: number, nonce: string): string {
    return `documentdb-quickstart-${pid}-${nonce}.env`;
}

/** `kill(pid, 0)` probes without signalling: ESRCH means gone, EPERM means alive but not ours. */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * Best-effort activation sweep of `documentdb-quickstart-*.env` files left in `os.tmpdir()`
 * (L9). `provision()` deletes its env file right after `docker run`, but an extension host killed
 * before that leaves a plaintext password on disk. A file whose owning PID is dead is removed
 * immediately; one whose owner is alive may belong to an in-flight provision in another window and
 * is kept until it passes {@link ENV_FILE_STALE_AFTER_MS}.
 */
export async function sweepStaleQuickStartEnvFiles(dir: string = os.tmpdir()): Promise<void> {
    try {
        const entries = await fs.readdir(dir);
        const cutoff = Date.now() - ENV_FILE_STALE_AFTER_MS;
        for (const entry of entries) {
            const match = ENV_FILE_PATTERN.exec(entry);
            if (!match) {
                continue;
            }
            const filePath = path.join(dir, entry);
            try {
                const pid = Number(match[1]);
                const ownerDead = Number.isSafeInteger(pid) && pid > 0 && !isProcessAlive(pid);
                const stale = ownerDead || (await fs.stat(filePath)).mtimeMs < cutoff;
                if (stale) {
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
