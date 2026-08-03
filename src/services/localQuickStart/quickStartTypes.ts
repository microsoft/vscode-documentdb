/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared types and constants for the Local Quick Start POC.
 *
 * See docs/ai-and-plans/PRs/local-quickstart-poc/ for the design and plan.
 * Terminology: "DocumentDB" is the service; the wire protocol is the MongoDB/DocumentDB API.
 */

import { type CancellationToken } from 'vscode';

/** Official DocumentDB local image (github.com/microsoft/documentdb README). */
export const QUICK_START_IMAGE_REPOSITORY = 'ghcr.io/documentdb/documentdb/documentdb-local';
export const QUICK_START_DEFAULT_TAG = 'latest';
export const QUICK_START_IMAGE = `${QUICK_START_IMAGE_REPOSITORY}:${QUICK_START_DEFAULT_TAG}`;

/**
 * Resolve the image reference to pull/run. An Advanced image-tag override
 * (e.g. `1.2.0`) swaps only the tag on the canonical repository; an empty/omitted
 * tag falls back to {@link QUICK_START_IMAGE}. The repository is never user-supplied
 * (we only ever pull the official DocumentDB local image), so a tag override can't
 * redirect to an arbitrary registry/image.
 */
export function resolveQuickStartImage(imageTag?: string): string {
    const tag = imageTag?.trim();
    return tag ? `${QUICK_START_IMAGE_REPOSITORY}:${tag}` : QUICK_START_IMAGE;
}

/**
 * Optional Advanced provisioning overrides (design §5.2 Advanced panel, P1-4).
 * Every field is optional; omitted fields keep the zero-decision defaults
 * (auto port with fallback, auto-generated credentials, default image tag, sample
 * data seeded). Custom credentials are ignored when recreating a `Missing` instance
 * onto an existing data volume — the stored credentials must be reused there.
 */
export interface AdvancedQuickStartOptions {
    /** Explicit host port. Unlike the default, a conflict ERRORS (never auto-relocated). */
    port?: number;
    /** Custom username (requires a password). Ignored on a Missing-recreate. */
    username?: string;
    /** Custom password (requires a username). Ignored on a Missing-recreate. */
    password?: string;
    /** Image tag override, e.g. `1.2.0`; defaults to the canonical tag. */
    imageTag?: string;
    /** Seed the image's built-in sample data (default `true`). */
    loadSampleData?: boolean;
    /** Bypass only an indeterminate readiness diagnosis; the service revalidates this condition. */
    continueAnyway?: boolean;
}

/** Fixed container name for the single managed instance (POC). */
export const QUICK_START_CONTAINER_NAME = 'vscode-documentdb-local';

/** Human-readable alias, surfaced in `docker ps` and the container label. */
export const QUICK_START_ALIAS = 'vscode-documentdb-local';

/** Canonical DocumentDB local port (also the image default). */
export const QUICK_START_PORT = 10260;

/**
 * Persistent named volume + the image's in-container data directory (`DATA_PATH`,
 * verified in the documentdb-local entrypoint). Mounting the volume at this path
 * makes the instance's data survive container recreation (design §8 defaults, §11).
 */
export const QUICK_START_VOLUME_NAME = 'vscode-documentdb-local-data';
export const QUICK_START_DATA_PATH = '/data';

/**
 * Port fallback band (design §8.3): if the canonical port is busy, try random
 * ports in `[QUICK_START_PORT, QUICK_START_PORT_BAND_END)` before giving up.
 */
export const QUICK_START_PORT_BAND_END = 10360;
export const QUICK_START_PORT_FALLBACK_ATTEMPTS = 10;

/**
 * Docker labels applied at creation. These are the ONLY way a container is
 * recognized as a Quick Start instance (design §10.1) — name/image/port alone
 * are never sufficient.
 */
export const QUICK_START_LABEL_KEY = 'vscode.documentdb.quickstart';
export const QUICK_START_ALIAS_LABEL_KEY = 'vscode.documentdb.alias';

/**
 * Multi-instance identity (WI-1). Each managed instance is keyed by a stable `alias` — also its
 * Docker container name and `vscode.documentdb.alias` label value. The **default** (first) instance
 * keeps the legacy names so an existing single instance is adopted with **NO rename**:
 * `containerName(DEFAULT_ALIAS) === QUICK_START_CONTAINER_NAME` and
 * `volumeName(DEFAULT_ALIAS) === QUICK_START_VOLUME_NAME`.
 */
export const DEFAULT_ALIAS = QUICK_START_ALIAS;

/** An instance's Docker container name is its alias. */
export function containerName(alias: string): string {
    return alias;
}

/** An instance's named data volume. */
export function volumeName(alias: string): string {
    return `${alias}-data`;
}

/** Stable in-memory cache key (CredentialCache / ClustersClient). Ephemeral — never persisted. */
export function clusterId(alias: string): string {
    return `quickstart-${alias}`;
}

/** SecretStorage key holding an instance's connection string (with credentials). */
export function secretKey(alias: string): string {
    return `documentdb.quickstart.${alias}.connectionString`;
}

/** globalState key holding the image reference an instance's data volume was created with. */
export function imageRefKey(alias: string): string {
    return `documentdb.quickstart.${alias}.imageRef`;
}

/**
 * Legacy (pre-multi-instance) flat storage keys. Migrated once to the `DEFAULT_ALIAS`-keyed values
 * at activation (see `quickStartRegistry.migrateLegacyQuickStartKeys`), then deleted. Kept as read
 * fallbacks on destructive paths (belt-and-suspenders against data loss).
 */
export const LEGACY_SECRET_KEY = 'documentdb.quickstart.connectionString';
export const LEGACY_IMAGE_REF_KEY = 'documentdb.quickstart.imageRef';

/** Reduced lifecycle state set for the POC (design §6, decision D8). */
export enum InstanceState {
    NotInstalled = 'NotInstalled',
    Provisioning = 'Provisioning',
    Starting = 'Starting',
    Running = 'Running',
    Stopping = 'Stopping',
    Stopped = 'Stopped',
    /**
     * A labelled container (or durable `ready` record) exists but its saved credentials are gone, so
     * the instance can't be opened. Distinct from `Error` so the tree renders an ACTIONABLE row that
     * offers Delete (UX review #1) instead of a passive, command-less warning.
     */
    CredentialsMissing = 'CredentialsMissing',
    Error = 'Error',
}

/** Ordered provisioning stages surfaced as lightweight in-webview progress (D3). */
export type ProvisionStage = 'checking' | 'pulling' | 'creating' | 'starting' | 'waiting' | 'done' | 'error';

/** Stages shown in the webview checklist, in order. */
export const PROVISION_STAGES: readonly ProvisionStage[] = [
    'checking',
    'pulling',
    'creating',
    'starting',
    'waiting',
] as const;

/** A single stage transition pushed through the service-level event sink (D13). */
export interface StageEvent {
    readonly stage: ProvisionStage;
    readonly status: 'active' | 'done' | 'error';
    readonly message?: string;
    readonly error?: string;
    /** The actual bound host port — set on the terminal `done` event (for success guidance). */
    readonly boundPort?: number;
    /**
     * Set on a readiness-timeout error event (§9.1): the container was left running, so the
     * webview offers "Wait longer" / "View logs" / "Start over" instead of a hard failure.
     */
    readonly timedOut?: boolean;
    /** Typed recovery result when Docker became unavailable during pull or run. */
    readonly dockerReadiness?: DockerReadiness;
}

/** Metadata describing the currently-managed instance. */
export interface InstanceMetadata {
    readonly containerId: string;
    readonly alias: string;
    readonly boundPort: number;
    /** Stable cache key for CredentialCache / ClustersClient. */
    readonly clusterId: string;
    /** Full connection string including credentials (kept in SecretStorage). */
    readonly connectionString: string;
    readonly username: string;
    /**
     * The image reference the instance's data volume was created with (e.g.
     * `…/documentdb-local:latest`). Reused on a recreate so the persisted cluster is
     * not silently moved to a different image version. May be undefined for instances
     * recovered without a readable image (then a recreate falls back to the default).
     */
    readonly imageRef?: string;
}

export type DockerReadinessOutcome = 'ready' | 'diagnosed' | 'indeterminate';

export type DockerHostEnvironment =
    | 'windows'
    | 'macos'
    | 'linux'
    | 'wsl'
    | 'ssh'
    | 'devContainer'
    | 'codespaces'
    | 'otherRemote'
    | 'unsupported';

export type DockerProvider = 'dockerDesktop' | 'dockerEngine' | 'unknown';

export type DockerProviderEvidence =
    | 'liveDaemon'
    | 'activeContext'
    | 'installedApplication'
    | 'rememberedProvider'
    | 'none';

export type DockerFailureKind =
    | 'cliMissing'
    | 'permissionDenied'
    | 'daemonUnavailable'
    | 'daemonStarting'
    | 'contextUnavailable'
    | 'endpointUnreachable'
    | 'probeTimedOut'
    | 'unsupportedHost'
    | 'windowsContainers'
    | 'unknown';

export type DockerEndpointKind = 'unixSocket' | 'namedPipe' | 'tcp' | 'ssh' | 'unknown';

export type DockerStartAction =
    | 'startDockerDesktopWindows'
    | 'startDockerDesktopMacOS'
    | 'startDockerDesktopLinux'
    | 'startDockerDesktopWindowsFromWsl'
    | 'startRootlessDockerEngineLinux';

export type DockerLaunchResult = 'started' | 'launchAttempted' | 'notAvailable' | 'failed';

export type DockerExecutionTarget = 'local' | 'wsl' | 'ssh' | 'devContainer' | 'codespaces' | 'otherRemote';

export type DockerPermissionDetail = 'notInGroup' | 'pendingSessionRestart' | 'unknown';

export type DockerServiceManager = 'systemd' | 'service' | 'unknown';

export interface DockerProbeEvidence {
    readonly probe: 'cliVersion' | 'info' | 'contexts';
    readonly exitCode?: number;
    readonly spawnErrorCode?: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly endedBy: 'exit' | 'deadline' | 'cancellation';
    readonly durationMs: number;
}

export interface DockerEndpointProbe {
    readonly kind: DockerEndpointKind;
    readonly accessErrorCode?: string;
    readonly source: 'dockerHostEnv' | 'dockerContextEnv' | 'currentContext' | 'platformDefault';
}

export interface DockerSocketGroupFacts {
    readonly socketGid?: number;
    readonly processHasSocketGroup?: boolean;
    readonly userIsGroupMember?: boolean;
}

export interface DockerRecoveryCommand {
    readonly id: 'linuxDockerGroup' | 'linuxStartService' | 'wslStartServiceNoSystemd' | 'wslRestartFromWindows';
    readonly commandLine: string;
    readonly requiresElevation: boolean;
}

export interface DockerProviderMemory {
    readonly provider: DockerProvider;
    readonly endpointKind: DockerEndpointKind;
    readonly hostEnvironment: DockerHostEnvironment;
    readonly daemonArchitecture?: string;
    readonly osType?: 'linux' | 'windows';
    readonly recordedAtMs: number;
}

export interface DockerReadinessRequest {
    readonly forceRefresh?: boolean;
    readonly resetProviderMemory?: boolean;
    readonly suppressCommandEcho?: boolean;
    readonly cancellationToken?: CancellationToken;
}

interface DockerReadinessBase {
    readonly environment: DockerHostEnvironment;
    readonly endpointKind: DockerEndpointKind;
    readonly endpointSource?: DockerEndpointProbe['source'];
    readonly provider: DockerProvider;
    readonly providerEvidence: DockerProviderEvidence;
    readonly providerRecordedAtMs?: number;
    readonly executionTarget: DockerExecutionTarget;
    readonly startAction?: DockerStartAction;
    readonly permissionDetail?: DockerPermissionDetail;
    readonly recoveryCommand?: DockerRecoveryCommand;
    readonly checkedAtMs: number;
    readonly cliInstalled: boolean;
    readonly cliVersion?: string;
    readonly osType?: 'linux' | 'windows';
    readonly daemonArchitecture?: string;
    readonly diagnosticFingerprint?: string;
    /** Host CPU architecture (e.g. `x64`, `arm64`) and whether it is supported (§9). */
    readonly arch?: string;
    readonly platformSupported?: boolean;
}

export interface DockerReadyReadiness extends DockerReadinessBase {
    readonly outcome: 'ready';
    readonly failureKind?: never;
    readonly canContinueAnyway: false;
    readonly daemonReachable: true;
}

export interface DockerDiagnosedReadiness extends DockerReadinessBase {
    readonly outcome: 'diagnosed';
    readonly failureKind: Exclude<DockerFailureKind, 'probeTimedOut' | 'unknown'>;
    readonly canContinueAnyway: false;
    readonly daemonReachable: boolean;
}

export interface DockerIndeterminateReadiness extends DockerReadinessBase {
    readonly outcome: 'indeterminate';
    readonly failureKind: Extract<DockerFailureKind, 'probeTimedOut' | 'unknown'>;
    readonly canContinueAnyway: true;
    readonly daemonReachable: false;
}

/** Result of the Docker readiness pre-check (design §9, prereq cards). */
export type DockerReadiness = DockerReadyReadiness | DockerDiagnosedReadiness | DockerIndeterminateReadiness;

/** Snapshot of the managed instance for the webview / tree. */
export interface QuickStartStatus {
    readonly state: InstanceState;
    readonly metadata?: InstanceMetadata;
    readonly errorMessage?: string;
    /**
     * `Missing` badge (design §6.1): the extension holds metadata but Docker has
     * no matching container (e.g. the user removed it outside the extension).
     */
    readonly missing?: boolean;
    /**
     * True while a container kept running after a readiness timeout is still resumable, so the
     * webview can rehydrate the "Wait longer / Start over" actions (§9.1) after it is reopened
     * rather than dropping to the fresh setup form.
     */
    readonly canResumeReadiness?: boolean;
}

/**
 * Per-instance snapshot for the tree (WI-3). Unlike {@link QuickStartStatus} it carries the
 * `alias`, `displayName`, and `port` at the top level, so a Provisioning / Missing /
 * credential-unavailable row (which has no `metadata`) can still be keyed and labelled.
 */
export interface InstanceStatus {
    readonly alias: string;
    readonly displayName: string;
    readonly state: InstanceState;
    readonly missing: boolean;
    readonly port?: number;
    readonly errorMessage?: string;
    readonly canResumeReadiness: boolean;
    readonly metadata?: InstanceMetadata;
}

/** Result of the `getDockerStatus` query (powers the webview review cards). */
export interface DockerStatusResult {
    readonly readiness: DockerReadiness;
    readonly status: QuickStartStatus;
    readonly busy: boolean;
    /**
     * True when a provision would REUSE an existing instance (stored credentials are
     * present, so the data volume is kept and custom credentials / image tag are ignored)
     * rather than create a fresh one. Drives the webview's recreate UI independently of the
     * in-memory `Missing` badge, so an already-provisioned or post-reload instance never
     * shows credential/image inputs the service would silently ignore.
     */
    readonly willReuse: boolean;
}
