/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Skeleton, SkeletonItem } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { formatUptime } from '../formatUtils';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface HeaderCardProps {
    clusterDisplayName: string;
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    connectionState: ConnectionState;
    /** Azure resource facts, absent for a non-Azure cluster. */
    azure?: ClusterDashboardAzureInfo;
}

const PLACEHOLDER = '—';

/**
 * Reads the server host name out of the JSON blob `getClusterMetadata` stores under
 * `hostInfo_json`. Returns `null` when the server did not answer `hostInfo` (vCore) or
 * when the payload is not shaped as expected.
 */
function extractHostName(hostInfoJson: string | undefined): string | null {
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
function describeTopology(metadata: Record<string, string | undefined> | undefined): string {
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
 * that identifies as neither — a local emulator or a generic MongoDB server, where the row
 * would add nothing over the version that is already shown.
 */
function describeProduct(metadata: Record<string, string | undefined> | undefined): string | null {
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
function formatEngineVersions(rawVersions: string | undefined): string | null {
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
function describeCompute(azure: ClusterDashboardAzureInfo | undefined): string | null {
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
function collectResilienceWarnings(
    metadata: Record<string, string | undefined> | undefined,
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

function DetailItem({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="headerDetail">
            <span className="headerDetailLabel">{label}</span>
            <span className="headerDetailValue">{value}</span>
        </div>
    );
}

export const HeaderCard = ({
    clusterDisplayName,
    clusterInfo,
    latestSample,
    connectionState,
    azure,
}: HeaderCardProps): JSX.Element => {
    const metadata = clusterInfo?.metadata;

    const connectionLabel =
        connectionState === 'connected'
            ? l10n.t('Connected')
            : connectionState === 'disconnected'
              ? l10n.t('Disconnected')
              : l10n.t('Connecting…');

    const connectionAppearance =
        connectionState === 'connected' ? 'success' : connectionState === 'disconnected' ? 'danger' : 'warning';

    // Rows the server may not answer at all. Azure DocumentDB (vCore) returns no
    // `buildInfo.platform` and a `hostInfo` with empty `os`/`system` fields, so rendering
    // these unconditionally left two of five rows showing a bare dash. They are dropped
    // instead, and the product/engine rows below — which vCore *does* report — take their
    // place. Nothing here arrives later in the session, so a row can never pop in.
    const optionalDetails: Array<{ label: string; value: string }> = [];

    const product = describeProduct(metadata);
    if (product !== null) {
        optionalDetails.push({ label: l10n.t('Product'), value: product });
    }

    const engineVersions = formatEngineVersions(metadata?.['topology_hello_internal_documentdb_versions']);
    if (engineVersions !== null) {
        optionalDetails.push({ label: l10n.t('Engine'), value: engineVersions });
    }

    const platform = metadata?.['serverInfo_platform'];
    if (platform !== undefined && platform !== '') {
        optionalDetails.push({ label: l10n.t('Platform'), value: platform });
    }

    const host = extractHostName(metadata?.['hostInfo_json']);
    if (host !== null) {
        optionalDetails.push({ label: l10n.t('Host'), value: host });
    }

    // Azure facts the discovery views already fetched from ARM — the cluster's shape, which
    // the data plane cannot report at all on vCore.
    if (azure?.location !== undefined) {
        optionalDetails.push({ label: l10n.t('Region'), value: regionToDisplayName(azure.location) });
    }

    const compute = describeCompute(azure);
    if (compute !== null) {
        optionalDetails.push({ label: l10n.t('Compute'), value: compute });
    }

    if (azure?.replicaRole !== undefined) {
        optionalDetails.push({ label: l10n.t('Replication role'), value: azure.replicaRole });
    }

    const resilienceWarnings = collectResilienceWarnings(metadata, azure);

    const version = metadata?.['serverInfo_version'] ?? PLACEHOLDER;

    // `topology_type` is `hello.msg`, which only mongos sets ('isdbgrid'); every
    // standalone, emulator, and replica-set primary would render the literal word
    // 'unknown', and a mongos would render a raw wire token. Report the server count
    // instead, which is meaningful everywhere.
    const topology = describeTopology(metadata);

    return (
        <Card className="headerCard" appearance="filled">
            <div className="headerTitleRow">
                <h1 className="headerTitle" title={clusterDisplayName}>
                    {clusterDisplayName}
                </h1>
                <Badge appearance="filled" color={connectionAppearance} aria-label={connectionLabel}>
                    {connectionLabel}
                </Badge>
                {/*
                 * Liveness lives here, next to the badge that already asserts it — not as a
                 * chart. A number is the honest representation of a ping; the strip below is
                 * reserved for what the cluster contains.
                 */}
                {connectionState === 'connected' && latestSample?.pingLatencyMs != null && (
                    <span className="headerLatency">
                        {l10n.t('{latency} ms', { latency: Math.round(latestSample.pingLatencyMs) })}
                    </span>
                )}
                {resilienceWarnings.map((warning) => (
                    <Badge key={warning} appearance="outline" color="warning">
                        {warning}
                    </Badge>
                ))}
            </div>

            {clusterInfo === null ? (
                <Skeleton aria-label={l10n.t('Loading cluster information…')}>
                    <SkeletonItem size={16} />
                </Skeleton>
            ) : (
                <div className="headerDetails">
                    <DetailItem label={l10n.t('Server version')} value={version} />
                    {optionalDetails.map((detail) => (
                        <DetailItem key={detail.label} label={detail.label} value={detail.value} />
                    ))}
                    <DetailItem label={l10n.t('Topology')} value={topology} />
                    {/*
                     * Kept even when empty, unlike the rows above: `uptimeSeconds` comes from
                     * the live sample rather than the one-shot metadata, so it can arrive on
                     * a later poll and must hold its place in the layout.
                     */}
                    <DetailItem
                        label={l10n.t('Uptime')}
                        value={formatUptime(latestSample?.uptimeSeconds, PLACEHOLDER)}
                    />
                </div>
            )}
        </Card>
    );
};
