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

/** Reduced lifecycle state set for the POC (design §6, decision D8). */
export enum InstanceState {
    NotInstalled = 'NotInstalled',
    Provisioning = 'Provisioning',
    Starting = 'Starting',
    Running = 'Running',
    Stopping = 'Stopping',
    Stopped = 'Stopped',
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

/** Result of the Docker readiness pre-check (design §9, prereq cards). */
export interface DockerReadiness {
    readonly cliInstalled: boolean;
    readonly cliVersion?: string;
    readonly daemonReachable: boolean;
    /** Host CPU architecture (e.g. `x64`, `arm64`) and whether it is supported (§9). */
    readonly arch?: string;
    readonly platformSupported?: boolean;
    readonly error?: string;
}

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
