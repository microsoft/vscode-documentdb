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
import { ContainerRuntime, getQuickStartOutputChannel } from './ContainerRuntime';
import { composeConnectionString, generateCredentials, type GeneratedCredentials } from './quickStartCredentials';
import {
    type AdvancedQuickStartOptions,
    type InstanceMetadata,
    InstanceState,
    type ProvisionStage,
    QUICK_START_ALIAS,
    QUICK_START_ALIAS_LABEL_KEY,
    QUICK_START_CONTAINER_NAME,
    QUICK_START_DATA_PATH,
    QUICK_START_IMAGE,
    QUICK_START_LABEL_KEY,
    QUICK_START_PORT,
    QUICK_START_PORT_BAND_END,
    QUICK_START_VOLUME_NAME,
    type QuickStartStatus,
    resolveQuickStartImage,
    type StageEvent,
} from './quickStartTypes';

/** Stable cache key for CredentialCache / ClustersClient (single instance, POC). */
export const QUICK_START_CLUSTER_ID = 'quickstart-local-documentdb';

const SECRET_KEY = 'documentdb.quickstart.connectionString';
/**
 * Durable (non-secret) record of the image reference the managed instance's data volume
 * was created with, kept in globalState so a recreate AFTER a window reload (when the
 * in-memory metadata is gone) still reuses the original image instead of forcing `latest`.
 */
const IMAGE_REF_STATE_KEY = 'documentdb.quickstart.imageRef';
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

class QuickStartServiceImpl {
    private state: InstanceState = InstanceState.NotInstalled;
    private metadata: InstanceMetadata | undefined;
    private errorMessage: string | undefined;
    private missing = false;
    private provisioning = false;
    /**
     * Set when a readiness probe timed out but the container was left running (§9.1). Holds
     * what a "Wait longer" resume needs to finish adoption; cleared on success/discard/new run.
     */
    private pendingReadiness: PendingReadiness | undefined;
    /** Serializes lifecycle ops (start/stop/restart/delete) so they don't overlap. */
    private lifecycleBusy = false;

    private readonly statusEmitter = new vscode.EventEmitter<void>();
    /** Fires whenever the managed-instance status changes (drives the tree). */
    public readonly onDidChangeStatus = this.statusEmitter.event;

    public getStatus(): QuickStartStatus {
        return {
            state: this.state,
            metadata: this.metadata,
            errorMessage: this.errorMessage,
            missing: this.missing,
            // Only "resumable" once the provision/resume has settled (not mid-wait): pendingReadiness
            // is set BEFORE the probe, so gating on the busy flags keeps a reopened panel from
            // offering "Wait longer" while setup is still actively running (gpt-5.5).
            canResumeReadiness: !this.provisioning && !this.lifecycleBusy && this.pendingReadiness !== undefined,
        };
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
        this.missing = false;
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
        if (this.provisioning || this.lifecycleBusy) {
            yield stageEvent('error', 'error', 'Setup is already in progress.', 'Setup is already in progress.');
            return;
        }
        this.provisioning = true;
        // Starting a fresh run supersedes any container left running by a prior readiness
        // timeout — drop its retained "Wait longer" state (the run below removes the container).
        this.pendingReadiness = undefined;
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
        const reusable = await this.getReusableCredentials();
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
            ? (this.metadata?.imageRef ?? ext.context.globalState.get<string>(IMAGE_REF_STATE_KEY) ?? QUICK_START_IMAGE)
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
            // labelled as ours, D9). When NOT reusing (no recoverable credentials) also drop
            // any stale data volume, so the new credentials initialize a clean cluster. When
            // reusing, the volume is intentionally KEPT so existing data survives the recreate.
            const existing = await this.findManagedContainer();
            if (existing) {
                channel.appendLine(`Removing existing Quick Start container ${existing.id} for a clean run…`);
                await ContainerRuntime.removeContainer(existing.id).catch(() => undefined);
            }
            if (!reusing) {
                await ContainerRuntime.removeVolume(QUICK_START_VOLUME_NAME).catch(() => undefined);
            }

            // Pick a host port (design §8.3). An explicit Advanced port is honored exactly:
            // a conflict ERRORS (never auto-relocated, P0-2). Otherwise prefer the canonical
            // port and fall back to a random free port in the band, noting the substitution.
            let chosenPort: number;
            let portFallbackNote: string | undefined;
            if (explicitPort !== undefined) {
                if (!(await ContainerRuntime.isPortFree(explicitPort))) {
                    const message = `Port ${explicitPort} is already in use. Choose a different port or free it, then retry.`;
                    this.setStatus(InstanceState.Error, undefined, message);
                    yield stageEvent('checking', 'error', message, message);
                    return;
                }
                this.throwIfAborted(signal);
                chosenPort = explicitPort;
            } else {
                const available = await ContainerRuntime.findAvailablePort(QUICK_START_PORT);
                this.throwIfAborted(signal);
                if (available === undefined) {
                    const message = `Ports ${QUICK_START_PORT}-${QUICK_START_PORT_BAND_END - 1} are all in use. Free one and retry.`;
                    this.setStatus(InstanceState.Error, undefined, message);
                    yield stageEvent('checking', 'error', message, message);
                    return;
                }
                chosenPort = available;
                if (chosenPort !== QUICK_START_PORT) {
                    portFallback = true;
                    portFallbackNote = `Port ${QUICK_START_PORT} was busy — using ${chosenPort} instead.`;
                    channel.appendLine(portFallbackNote);
                }
            }
            yield stageEvent('checking', 'done', portFallbackNote);

            // --- pulling ---
            yield stageEvent('pulling', 'active', 'Pulling the official image…');
            await ContainerRuntime.pullImage(imageRef, cts.token);
            this.throwIfAborted(signal);
            yield stageEvent('pulling', 'done');

            // --- creating (docker run -d creates and starts) ---
            yield stageEvent('creating', 'active', 'Creating container…');
            createAttempted = true;
            // Write credentials to a temp env-file (deleted in finally) so they never
            // appear on the docker CLI / host process list (design §8.2). The image
            // reads USERNAME/PASSWORD from the environment.
            envFilePath = await this.writeEnvFile(credentials.username, credentials.password);
            containerId = await ContainerRuntime.createAndRunContainer(
                {
                    imageRef: imageRef,
                    name: QUICK_START_CONTAINER_NAME,
                    labels: { [QUICK_START_LABEL_KEY]: '1', [QUICK_START_ALIAS_LABEL_KEY]: QUICK_START_ALIAS },
                    hostPort: chosenPort,
                    containerPort: QUICK_START_PORT,
                    // Persist data across recreation (§8/§11).
                    volumeName: QUICK_START_VOLUME_NAME,
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
                const item = await ContainerRuntime.inspectContainer(QUICK_START_CONTAINER_NAME);
                containerId = item?.id ?? QUICK_START_CONTAINER_NAME;
            }
            this.throwIfAborted(signal);
            yield stageEvent('creating', 'done');

            // --- starting (confirm running, read bound port, follow logs) ---
            yield stageEvent('starting', 'active', 'Starting container…');
            const inspected = await ContainerRuntime.inspectContainer(containerId);
            // Fall back to the port we actually requested (not the canonical default) if the
            // inspect can't report the binding, so a custom port stays correct in the success
            // message + stored connection string.
            const boundPort = (inspected && ContainerRuntime.getBoundHostPort(inspected)) || chosenPort;
            // Stream container logs to the channel during the wait (compensates for -dt detach, D2).
            void ContainerRuntime.followLogs(containerId, secrets, cts.token);
            yield stageEvent('starting', 'done');

            // --- waiting (wire-protocol readiness, D7) ---
            yield stageEvent('waiting', 'active', 'Waiting for DocumentDB to accept connections…');
            const connectionString = composeConnectionString(credentials.username, credentials.password, boundPort);
            // Retain everything a "Wait longer" resume needs BEFORE probing, so a readiness
            // timeout can keep this running container and finish adoption later (§9.1).
            const pending: PendingReadiness = {
                containerId,
                connectionString,
                boundPort,
                username: credentials.username,
                password: credentials.password,
                imageRef,
                sampleDataRequested,
                reusing,
            };
            this.pendingReadiness = pending;
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
                this.setStatus(InstanceState.Error, undefined, message);
                terminalEvent = stageEvent('waiting', 'error', message, message, undefined, /* timedOut */ true);
            } else {
                // Any other failure (or cancel) discards the attempt — drop the retained state so a
                // stale timeout can't offer "Wait longer" against a container we're about to remove.
                this.pendingReadiness = undefined;
                if (!aborted) {
                    this.setStatus(InstanceState.Error, undefined, message);
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
                    await ContainerRuntime.stopContainer(containerId).catch(() => undefined);
                    await ContainerRuntime.removeContainer(containerId).catch(() => undefined);
                } else if (createAttempted && !containerId) {
                    // The CLI may have been killed after the daemon created the
                    // container but before its id was captured — sweep by label.
                    const orphan = await this.findManagedContainer();
                    if (orphan) {
                        channel.appendLine(`Removing orphaned container ${orphan.id}…`);
                        await ContainerRuntime.removeContainer(orphan.id).catch(() => undefined);
                    }
                }
                // Interrupted before settling (cancel / unsubscribe) → reset state.
                // The error path already settled to `Error` in `catch`.
                if (this.state === InstanceState.Provisioning) {
                    this.setStatus(InstanceState.NotInstalled, undefined, undefined);
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
            this.provisioning = false;
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
        await ext.secretStorage.store(SECRET_KEY, pending.connectionString);
        // Durably remember the image this instance's volume was created with, so a recreate
        // after a window reload (in-memory metadata gone) keeps the same image.
        await ext.context.globalState.update(IMAGE_REF_STATE_KEY, pending.imageRef);
        // Drop any stale client cached under this id (e.g. from a prior run with different
        // credentials) so the next browse uses the fresh credentials.
        await ClustersClient.deleteClient(QUICK_START_CLUSTER_ID).catch(() => undefined);
        this.populateCredentialCache(pending.connectionString, pending.username, pending.password);
        this.setStatus(
            InstanceState.Running,
            {
                containerId: pending.containerId,
                alias: QUICK_START_ALIAS,
                boundPort: pending.boundPort,
                clusterId: QUICK_START_CLUSTER_ID,
                connectionString: pending.connectionString,
                username: pending.username,
                imageRef: pending.imageRef,
            },
            undefined,
        );
        this.pendingReadiness = undefined;
    }

    /**
     * "Wait longer" (§9.1): re-probe the container retained from a readiness timeout for another
     * window and finish adoption if it becomes ready — WITHOUT tearing it down and re-pulling.
     * On another timeout the container is kept and the on-timeout actions are surfaced again; on
     * a hard error the container is still kept so the user can retry or Start over.
     */
    public async *resumeReadiness(signal: AbortSignal): AsyncGenerator<StageEvent> {
        const pending = this.pendingReadiness;
        if (!pending) {
            yield stageEvent('error', 'error', 'There is nothing to resume.', 'There is nothing to resume.');
            return;
        }
        if (this.provisioning || this.lifecycleBusy) {
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
        this.provisioning = true;
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
            this.setStatus(InstanceState.Provisioning, undefined, undefined);
            yield stageEvent('waiting', 'active', 'Waiting for DocumentDB to accept connections…');
            // Stream the container's logs during THIS wait so "View Docker output" shows the live
            // startup rather than only the stale first-attempt output (opus-4.8).
            void ContainerRuntime.followLogs(pending.containerId, [pending.password], cts.token);
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
                this.setStatus(InstanceState.Error, undefined, aborted ? undefined : message);
            }
            // A hard finalize error is NOT a timeout — drop the retained state so reopening the
            // panel shows the real error (via a fresh setup) rather than a misleading "Wait longer"
            // (gpt-5.5). Timeout/cancel keep pendingReadiness so the container stays resumable.
            if (!timedOut) {
                this.pendingReadiness = undefined;
            }
            terminalEvent = stageEvent('waiting', 'error', message, aborted ? undefined : message, undefined, timedOut);
        } finally {
            signal.removeEventListener('abort', onAbort);
            // Stop the followLogs stream (started with cts.token) before disposing.
            cts.cancel();
            cts.dispose();
            this.provisioning = false;
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
        // Guard BEFORE mutating: if a provision/lifecycle op is running, leave the retained
        // state untouched (clearing it here would orphan the still-running container).
        if (this.provisioning || this.lifecycleBusy || !this.pendingReadiness) {
            return false;
        }
        const pending = this.pendingReadiness;
        this.pendingReadiness = undefined;
        this.lifecycleBusy = true;
        try {
            await ContainerRuntime.stopContainer(pending.containerId).catch(() => undefined);
            await ContainerRuntime.removeContainer(pending.containerId).catch(() => undefined);
            if (!pending.reusing) {
                await ContainerRuntime.removeVolume(QUICK_START_VOLUME_NAME).catch(() => undefined);
            }
            this.setStatus(InstanceState.NotInstalled, undefined, undefined);
            return true;
        } finally {
            this.lifecycleBusy = false;
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
            await ContainerRuntime.execShellInContainer(containerId, script, secrets, token);
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
    private async getReusableCredentials(): Promise<GeneratedCredentials | undefined> {
        try {
            const stored = await ext.secretStorage.get(SECRET_KEY);
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

    private async findManagedContainer(): Promise<{ id: string } | undefined> {
        const list = await ContainerRuntime.listByLabel({ [QUICK_START_LABEL_KEY]: '1' }).catch(() => []);
        return list[0];
    }

    /**
     * Pre-populate the in-memory CredentialCache so the inline tree cluster item
     * connects without re-prompting. `DocumentDBClusterItem.getChildren` takes the
     * cached path when `CredentialCache.hasCredentials(clusterId)` is true.
     */
    private populateCredentialCache(connectionString: string, username: string, password: string): void {
        CredentialCache.setAuthCredentials(
            QUICK_START_CLUSTER_ID,
            AuthMethodId.NativeAuth,
            connectionString,
            { connectionUser: username, connectionPassword: password },
            { isEmulator: true, disableEmulatorSecurity: true },
        );
    }

    /**
     * Verify a container is ours before acting on it (design §9/§13.1): never
     * touch a container that doesn't carry the Quick Start label, even if the id
     * matches.
     */
    private async isManaged(containerId: string): Promise<boolean> {
        const item = await ContainerRuntime.inspectContainer(containerId);
        return !!item && item.labels?.[QUICK_START_LABEL_KEY] === '1';
    }

    /**
     * Multi-window coordination (design §12): the container is shared machine state
     * no window owns, so a lifecycle action re-checks the live Docker state right
     * before executing. If another window already changed it (so the action no longer
     * applies), refresh the tree and inform the user instead of acting on stale state.
     * Returns true when the action may proceed.
     */
    private async liveStateGuard(id: string, allowed: ReadonlyArray<'running' | 'stopped'>): Promise<boolean> {
        const item = await ContainerRuntime.inspectContainer(id);
        const live: 'running' | 'stopped' | 'missing' = !item
            ? 'missing'
            : ContainerRuntime.isRunning(item)
              ? 'running'
              : 'stopped';
        if (live === 'missing' || !allowed.includes(live)) {
            await this.refreshLiveState();
            const label =
                live === 'missing' ? l10n.t('missing') : live === 'running' ? l10n.t('running') : l10n.t('stopped');
            void vscode.window.showInformationMessage(
                l10n.t(
                    'The DocumentDB Local instance changed in another window (now {0}). The view has been refreshed.',
                    label,
                ),
            );
            return false;
        }
        return true;
    }

    /** Start a stopped instance (design §11). */
    public async start(): Promise<void> {
        await this.runLifecycle(async () => {
            const id = this.metadata?.containerId;
            if (!id || !(await this.isManaged(id)) || !(await this.liveStateGuard(id, ['stopped']))) {
                return;
            }
            this.setStatus(InstanceState.Starting);
            await ContainerRuntime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(InstanceState.Running);
            } else {
                this.setStatus(
                    InstanceState.Error,
                    undefined,
                    'The container started but exited shortly after. Check the Quick Start logs.',
                );
            }
        });
    }

    /** Stop a running instance (design §11). */
    public async stop(): Promise<void> {
        await this.runLifecycle(async () => {
            const id = this.metadata?.containerId;
            if (!id || !(await this.isManaged(id)) || !(await this.liveStateGuard(id, ['running']))) {
                return;
            }
            this.setStatus(InstanceState.Stopping);
            await ContainerRuntime.stopContainer(id);
            this.setStatus(InstanceState.Stopped);
        });
    }

    /** Restart (stop + start) a running instance (design §11). */
    public async restart(): Promise<void> {
        await this.runLifecycle(async () => {
            const id = this.metadata?.containerId;
            if (!id || !(await this.isManaged(id)) || !(await this.liveStateGuard(id, ['running', 'stopped']))) {
                return;
            }
            this.setStatus(InstanceState.Stopping);
            await ContainerRuntime.stopContainer(id).catch(() => undefined);
            this.setStatus(InstanceState.Starting);
            await ContainerRuntime.startContainer(id);
            if (await this.confirmStaysRunning(id)) {
                this.setStatus(InstanceState.Running);
            } else {
                this.setStatus(
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
            const inspected = await ContainerRuntime.inspectContainer(id);
            if (!ContainerRuntime.isRunning(inspected)) {
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
    public async deleteContainer(): Promise<void> {
        await this.runLifecycle(async () => {
            const id = this.metadata?.containerId;
            // If the container still exists, only remove it when it is ours.
            if (id && (this.missing || (await this.isManaged(id)))) {
                await ContainerRuntime.removeContainer(id).catch(() => undefined);
            }
            // Explicit Delete is a full clean slate: drop the data volume too.
            await ContainerRuntime.removeVolume(QUICK_START_VOLUME_NAME).catch(() => undefined);
            try {
                await ext.secretStorage.delete(SECRET_KEY);
            } catch {
                // ignore — best-effort cleanup
            }
            await ext.context.globalState.update(IMAGE_REF_STATE_KEY, undefined);
            await ClustersClient.deleteClient(QUICK_START_CLUSTER_ID).catch(() => undefined);
            CredentialCache.deleteCredentials(QUICK_START_CLUSTER_ID);
            this.metadata = undefined;
            this.setStatus(InstanceState.NotInstalled);
        });
    }

    /**
     * Re-check live Docker state for the managed instance (cheap multi-window /
     * external-change freshness, design §12). Sets the `Missing` badge when we
     * hold metadata but Docker no longer has the container.
     */
    public async refreshLiveState(): Promise<void> {
        if (this.provisioning || this.lifecycleBusy || !this.metadata) {
            return;
        }
        try {
            const inspected = await ContainerRuntime.inspectContainer(this.metadata.containerId);
            if (!inspected) {
                // Container is gone — keep metadata so the user can recreate.
                this.missing = true;
                this.statusEmitter.fire();
                return;
            }
            const running = ContainerRuntime.isRunning(inspected);
            const nextState = running ? InstanceState.Running : InstanceState.Stopped;
            if (this.missing || this.state !== nextState) {
                this.setStatus(nextState);
            }
        } catch {
            // Best-effort freshness; never throw into the tree render.
        }
    }

    private async runLifecycle(op: () => Promise<void>): Promise<void> {
        if (this.provisioning || this.lifecycleBusy) {
            return;
        }
        this.lifecycleBusy = true;
        try {
            await op();
        } catch (error) {
            this.setStatus(InstanceState.Error, undefined, errMessage(error));
        } finally {
            this.lifecycleBusy = false;
        }
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
                // NOTE: only the container is removed — never the volume. A missing secret does
                // NOT prove the volume is disposable (a previously successful instance whose secret
                // was lost/reset externally would also land here), and deleting it would be
                // irreversible data loss. A fresh timed-out attempt's orphan volume is instead
                // wiped by the next fresh provision (`if (!reusing) removeVolume`), which is safe.
                this.setStatus(InstanceState.NotInstalled);
                return;
            }
            const inspected = await ContainerRuntime.inspectContainer(container.id);
            const boundPort = (inspected && ContainerRuntime.getBoundHostPort(inspected)) || QUICK_START_PORT;
            const running = ContainerRuntime.isRunning(inspected);
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
                this.populateCredentialCache(stored, username, password);
            }
            const adoptedImageRef = inspected?.image?.originalName;
            // Backfill the durable image record from the adopted container, so a recreate AFTER
            // this container is later removed + the window reloads still reuses the original image
            // — even for an instance we only adopted (never provisioned in-process). Never clear an
            // existing value when the image can't be read.
            if (adoptedImageRef) {
                await ext.context.globalState.update(IMAGE_REF_STATE_KEY, adoptedImageRef);
            }
            this.setStatus(running ? InstanceState.Running : InstanceState.Stopped, {
                containerId: container.id,
                alias: QUICK_START_ALIAS,
                boundPort,
                clusterId: QUICK_START_CLUSTER_ID,
                connectionString: stored,
                username,
                // Recover the image the volume's cluster was created with, so a later
                // recreate (after the container is removed) reuses it instead of forcing latest.
                imageRef: adoptedImageRef,
            });
        } catch {
            // Reconciliation is best-effort; never block activation.
        }
    }
}

/** Singleton Quick Start service. */
export const QuickStartService = new QuickStartServiceImpl();
