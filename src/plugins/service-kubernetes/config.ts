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

/** Well-known MongoDB/DocumentDB ports used for service discovery heuristics */
export const DOCUMENTDB_PORTS = [27017, 27018, 27019, 10260];

/** Default kubeconfig path */
export const DEFAULT_KUBECONFIG_PATH = '~/.kube/config';

/** GlobalState key for enabled kubeconfig contexts */
export const ENABLED_CONTEXTS_KEY = 'kubernetes-discovery.enabledContexts';

/** GlobalState key for context aliases */
export const CONTEXT_ALIASES_KEY = 'kubernetes-discovery.contextAliases';

/** GlobalState key for filtered (hidden) namespaces */
export const FILTERED_NAMESPACES_KEY = 'kubernetes-discovery.filteredNamespaces';

/** GlobalState key for custom kubeconfig path */
export const CUSTOM_KUBECONFIG_PATH_KEY = 'kubernetes-discovery.customKubeconfigPath';

/** GlobalState key for hidden (filtered) contexts */
export const HIDDEN_CONTEXTS_KEY = 'kubernetes-discovery.hiddenContexts';
