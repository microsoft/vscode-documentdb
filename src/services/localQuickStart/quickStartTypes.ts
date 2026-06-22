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
export const QUICK_START_IMAGE = 'ghcr.io/documentdb/documentdb/documentdb-local:latest';

/** Fixed container name for the single managed instance (POC). */
export const QUICK_START_CONTAINER_NAME = 'vscode-documentdb-local';

/** Human-readable alias, surfaced in `docker ps` and the container label. */
export const QUICK_START_ALIAS = 'vscode-documentdb-local';

/** Canonical DocumentDB local port (also the image default). */
export const QUICK_START_PORT = 10260;

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
    Running = 'Running',
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
}

/** Result of the Docker readiness pre-check (design §9, prereq cards). */
export interface DockerReadiness {
    readonly cliInstalled: boolean;
    readonly cliVersion?: string;
    readonly daemonReachable: boolean;
    readonly error?: string;
}

/** Snapshot of the managed instance for the webview / tree. */
export interface QuickStartStatus {
    readonly state: InstanceState;
    readonly metadata?: InstanceMetadata;
    readonly errorMessage?: string;
}
