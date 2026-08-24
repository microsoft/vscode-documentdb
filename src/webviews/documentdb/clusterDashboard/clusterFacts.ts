/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure readers over the flat metadata map `getClusterMetadata` produces.
 *
 * Kept out of the components because the header (identity + resilience) and the right-hand
 * facts card describe the same cluster from the same map: leaving these inline would have
 * duplicated the vCore-shaped special cases in two places, which is exactly where they would
 * drift.
 */

import * as l10n from '@vscode/l10n';

import { type ClusterDashboardAzureInfo } from './clusterDashboardController';

/** Rendered wherever a value the server never reported would otherwise be blank. */
export const PLACEHOLDER = '—';

/** The flat `key → value` shape `getClusterMetadata` returns. */
export type ClusterMetadataMap = Record<string, string | undefined> | undefined;

/**
 * Reads the server host name out of the JSON blob `getClusterMetadata` stores under
 * `hostInfo_json`. Returns `null` when the server did not answer `hostInfo` (vCore) or
 * when the payload is not shaped as expected.
 */
export function extractHostName(hostInfoJson: string | undefined): string | null {
    if (!hostInfoJson) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(hostInfoJson);
        const system = (parsed as { system?: { hostname?: unknown } } | null)?.system;
        return typeof system?.hostname === 'string' ? system.hostname : null;
    } catch {
        return null;
    }
}

/**
 * Reads `topology_numberOfServers`, which `getClusterMetadata` stores as a string.
 * Returns `null` for absent, blank, or non-numeric values so they render as the
 * placeholder rather than being silently coerced into a topology claim.
 */
function parseServerCount(rawServerCount: string | undefined): number | null {
    if (rawServerCount === undefined || rawServerCount.trim() === '') {
        return null;
    }

    const parsed = Number(rawServerCount);

    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Describes the cluster's shape from the metadata `getClusterMetadata` collected.
 *
 * `topology_numberOfServers` is `hello.hosts.length`, and `hosts` is only present on a
 * replica-set member: 0 means a genuine standalone (or a mongos, which the `isdbgrid`
 * branch has already claimed), while 1 is a *single-member replica set* — a common local
 * setup, and one that supports transactions and change streams, so calling it "Standalone"
 * misinforms.
 */
export function describeTopology(metadata: ClusterMetadataMap): string {
    if (metadata?.['topology_type'] === 'isdbgrid') {
        return l10n.t('Sharded cluster');
    }

    const serverCount = parseServerCount(metadata?.['topology_numberOfServers']);

    if (serverCount === null) {
        return PLACEHOLDER;
    }
    if (serverCount === 0) {
        return l10n.t('Standalone');
    }
    if (serverCount === 1) {
        return l10n.t('Replica set (1 server)');
    }

    return l10n.t('Replica set ({count} servers)', { count: serverCount });
}

/**
 * Names the product behind the connection.
 *
 * `hello.internal.kind` identifies an Azure DocumentDB server, and `domainInfo_api`
 * distinguishes the vCore and RU offerings from the host suffix. Both are already collected
 * by `getClusterMetadata`, so this costs no extra round trip. Returns `null` for a server
 * that identifies as neither — a local emulator or a generic MongoDB-API server, where the row
 * would add nothing over the version that is already shown.
 */
export function describeProduct(metadata: ClusterMetadataMap): string | null {
    const kind = metadata?.['topology_hello_internal_kind'];
    const api = metadata?.['domainInfo_api'];

    if (kind === 'azuredocumentdb') {
        return api ? l10n.t('Azure DocumentDB ({api})', { api }) : l10n.t('Azure DocumentDB');
    }

    return kind ?? null;
}

/**
 * Formats `hello.internal.documentdb_versions`, which `getClusterMetadata` stores as a
 * `;`-joined list (e.g. `1.114-0;1.115.0;12.1-1`). Reported verbatim rather than reduced to
 * a single number: the entries are separate component versions, and picking one would be
 * guessing which the reader cares about.
 */
export function formatEngineVersions(rawVersions: string | undefined): string | null {
    if (!rawVersions) {
        return null;
    }

    const versions = rawVersions
        .split(';')
        .map((version) => version.trim())
        .filter((version) => version.length > 0);

    return versions.length > 0 ? versions.join(', ') : null;
}

/**
 * Summarises the provisioned compute as one line, e.g. `M10 · 1 node · 128 GB`.
 * Returns `null` when ARM reported none of it.
 */
export function describeCompute(azure: ClusterDashboardAzureInfo | undefined): string | null {
    const parts: string[] = [];

    if (azure?.sku !== undefined) {
        parts.push(azure.sku);
    }
    if (azure?.nodeCount !== undefined) {
        parts.push(
            azure.nodeCount === 1 ? l10n.t('1 node') : l10n.t('{count} nodes', { count: String(azure.nodeCount) }),
        );
    }
    if (azure?.diskSize !== undefined) {
        parts.push(l10n.t('{size} GB', { size: String(azure.diskSize) }));
    }

    return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Resilience warnings shown as badges beside the connection state.
 *
 * These answer "is this cluster safe?", the question neither the data inventory nor the
 * running-operations list addresses. They are deliberately static facts, not metrics: a
 * cluster without high availability is a production-readiness finding, and a read-only
 * connection is something a user needs to know *before* attempting a write.
 */
export function collectResilienceWarnings(
    metadata: ClusterMetadataMap,
    azure: ClusterDashboardAzureInfo | undefined,
): string[] {
    const warnings: string[] = [];

    // `hello.readOnly` is answered by every server, so this warning is not Azure-specific:
    // it also catches a connection pinned to a secondary.
    if (metadata?.['topology_readOnly'] === 'true') {
        warnings.push(l10n.t('Read-only connection'));
    }

    if (azure?.enableHa === false) {
        warnings.push(l10n.t('No high availability'));
    }

    return warnings;
}

/**
 * Joins the connection string's endpoints into the header subtitle.
 *
 * A seed list can name every member of a replica set; the header shows the first and counts
 * the rest rather than wrapping onto a second line, and the full list is available in the
 * element's tooltip.
 */
export function describeAddress(hosts: string[] | undefined): string | null {
    if (hosts === undefined || hosts.length === 0) {
        return null;
    }
    if (hosts.length === 1) {
        return hosts[0];
    }

    return l10n.t('{host} +{count} more', { host: hosts[0], count: String(hosts.length - 1) });
}
