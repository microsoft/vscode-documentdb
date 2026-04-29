/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the Kubernetes discovery provider.
 *
 * Display strings use getter functions to defer l10n.t() evaluation
 * until first access, avoiding module-load-time crashes if the
 * l10n subsystem isn't fully initialized during extension activation.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'kubernetes-discovery';

/** Resource type identifier for telemetry */
export const RESOURCE_TYPE = 'kubernetes';

/** Display label for the discovery provider (lazy-evaluated) */
export function getLabel(): string {
    return l10n.t('Kubernetes');
}

/** Description shown in the discovery provider list (lazy-evaluated) */
export function getDescription(): string {
    return l10n.t('Kubernetes Service Discovery');
}

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('symbol-namespace');

/** Title shown in the discovery wizard (lazy-evaluated) */
export function getWizardTitle(): string {
    return l10n.t('Kubernetes Service Discovery');
}

/** Well-known DocumentDB API-compatible ports used for service discovery heuristics */
export const DOCUMENTDB_PORTS = [27017, 27018, 27019, 10260];

/** Default kubeconfig path */
export const DEFAULT_KUBECONFIG_PATH = '~/.kube/config';

// -----------------------------------------------------------------------------
// Multi-source kubeconfig storage (v2)
// -----------------------------------------------------------------------------

/** GlobalState key holding the ordered list of KubeconfigSourceRecord entries. */
export const KUBECONFIG_SOURCES_KEY = 'kubernetes-discovery.sources';

/** GlobalState key holding the list of source ids hidden from the discovery tree. */
export const HIDDEN_SOURCE_IDS_KEY = 'kubernetes-discovery.hiddenSourceIds';

/** GlobalState flag indicating the v2 (multi-source) migration has run. */
export const MIGRATION_V2_DONE_KEY = 'kubernetes-discovery.migration.v2Done';

/** Secret-storage key prefix for inline kubeconfig YAML (one secret per inline source). */
export const INLINE_KUBECONFIG_SECRET_PREFIX = 'kubernetes-discovery.inlineKubeconfig.';

/** Stable id of the built-in Default kubeconfig source. */
export const DEFAULT_SOURCE_ID = 'default';

/**
 * Discriminator describing where a kubeconfig source's bytes live.
 *
 * - `default`: the platform default (`KUBECONFIG` env or `~/.kube/config`).
 * - `file`: an absolute path on disk.
 * - `inline`: YAML text held in VS Code Secret Storage.
 */
export type KubeconfigSourceKind = 'default' | 'file' | 'inline';

/**
 * Persistent record describing a single kubeconfig source. Stored as one
 * {@link import('./sources/sourceStore').StorageItem} via the StorageService;
 * inline YAML lives in the item's `secrets` array, so this record itself
 * carries no secret material.
 */
export interface KubeconfigSourceRecord {
    readonly id: string;
    readonly label: string;
    readonly kind: KubeconfigSourceKind;
    /** Absolute path. Required when {@link kind} is `'file'`. */
    readonly path?: string;
}

// -----------------------------------------------------------------------------
// Legacy v1 storage keys — kept only so {@link migrationV2} can wipe them.
// Do not read or write these from anywhere else in v2 code.
// -----------------------------------------------------------------------------

/** @deprecated v1 — wiped by migrationV2. */
export const ENABLED_CONTEXTS_KEY = 'kubernetes-discovery.enabledContexts';
/** @deprecated v1 — wiped by migrationV2. */
export const FILTERED_NAMESPACES_KEY = 'kubernetes-discovery.filteredNamespaces';
/** @deprecated v1 — wiped by migrationV2. */
export const CUSTOM_KUBECONFIG_PATH_KEY = 'kubernetes-discovery.customKubeconfigPath';
/** @deprecated v1 — wiped by migrationV2. */
export const KUBECONFIG_SOURCE_KEY = 'kubernetes-discovery.kubeconfigSource';
/** @deprecated v1 — wiped by migrationV2. */
export const INLINE_KUBECONFIG_SECRET_KEY = 'kubernetes-discovery.inlineKubeconfig';
/** @deprecated v1 — wiped by migrationV2. */
export const HIDDEN_CONTEXTS_KEY = 'kubernetes-discovery.hiddenContexts';

/** @deprecated v1 — only used by tests that still type the old discriminator. */
export type KubeconfigSource = 'default' | 'customFile' | 'inline';

/**
 * Annotation/label key for explicit service opt-in to DocumentDB discovery.
 * Set the annotation OR label value to "true" on a Kubernetes Service to include
 * it in discovery even when it does not expose a standard DocumentDB port.
 *
 * @example
 * metadata:
 *   annotations:
 *     documentdb.vscode.extension/discovery: "true"
 */
export const DISCOVERY_ANNOTATION = 'documentdb.vscode.extension/discovery';

/**
 * Annotation key for associating a Kubernetes Secret with a generic (non-DKO)
 * service. The secret must reside in the same namespace as the service and must
 * contain "username" and "password" keys with base64-encoded values.
 *
 * @example
 * metadata:
 *   annotations:
 *     documentdb.vscode.extension/credential-secret: "my-db-credentials"
 */
export const CREDENTIAL_SECRET_ANNOTATION = 'documentdb.vscode.extension/credential-secret';

/**
 * @deprecated v1 — no longer used. The v2 model treats every context as
 * implicitly enabled and exposes per-source visibility instead.
 */
export function resolveEnabledContextNames(
    allContextNames: readonly string[],
    configuredEnabledContextNames: readonly string[] | undefined,
): string[] {
    return configuredEnabledContextNames === undefined
        ? [...allContextNames]
        : allContextNames.filter((name) => configuredEnabledContextNames.includes(name));
}
