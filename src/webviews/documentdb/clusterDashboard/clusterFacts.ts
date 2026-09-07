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

/** The flat `key → value` shape `getClusterMetadata` returns. */
export type ClusterMetadataMap = Record<string, string | undefined> | undefined;

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
