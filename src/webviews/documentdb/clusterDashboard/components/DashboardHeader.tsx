/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { DataBarVerticalAscendingRegular } from '@fluentui/react-icons';
import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { formatUptime } from '../formatUtils';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

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
 * These answer "is this cluster safe?", the question the data inventory does not address.
 * They are deliberately static facts, not metrics: a cluster without high availability is a
 * production-readiness finding, and a read-only connection is something a user needs to know
 * *before* attempting a write.
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

/**
 * Joins the connection string's endpoints into the header subtitle.
 *
 * A seed list can name every member of a replica set; the header shows the first and counts
 * the rest rather than wrapping onto a second line, and the full list is available in the
 * element's tooltip.
 */
function describeAddress(hosts: string[] | undefined): string | null {
    if (hosts === undefined || hosts.length === 0) {
        return null;
    }
    if (hosts.length === 1) {
        return hosts[0];
    }

    return l10n.t('{host} +{count} more', { host: hosts[0], count: String(hosts.length - 1) });
}

export interface DashboardHeaderProps {
    clusterDisplayName: string;
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    connectionState: ConnectionState;
    /** Azure resource facts, absent for a non-Azure cluster. */
    azure?: ClusterDashboardAzureInfo;
}

/**
 * The full-width identity band: icon, the cluster's name and the address it is actually
 * connected to, followed by its facts, connection state and latency. The trailing
 * details wrap together when the panel cannot hold them on one line.
 *
 * Two names are in play and they routinely disagree — the tree's display name is whatever
 * the user or a discovery provider chose, while the address is which server is on screen.
 * Showing both on one line makes them read as one answer to "what am I looking at?".
 *
 * Liveness stays here too: the connection badge and the ping figure sit next to the name
 * they describe, so nothing below the band has to animate.
 */
export const DashboardHeader = ({
    clusterDisplayName,
    clusterInfo,
    latestSample,
    connectionState,
    azure,
}: DashboardHeaderProps): JSX.Element => {
    const connectionLabel =
        connectionState === 'connected'
            ? l10n.t('Connected')
            : connectionState === 'disconnected'
              ? l10n.t('Disconnected')
              : l10n.t('Connecting…');

    const connectionAppearance =
        connectionState === 'connected' ? 'success' : connectionState === 'disconnected' ? 'danger' : 'warning';

    const resilienceWarnings = collectResilienceWarnings(clusterInfo?.metadata, azure);
    const address = describeAddress(clusterInfo?.hosts);
    const showAddress = address !== null && address !== clusterDisplayName;

    // Four at most, in the order a reader asks them: what version, where, how big, how long
    // has it been up.
    const keyFacts: Array<{ label: string; value: string }> = [];

    if (clusterInfo !== null) {
        const version = clusterInfo.metadata['serverInfo_version'];
        if (version !== undefined && version !== '') {
            keyFacts.push({ label: l10n.t('Version'), value: version });
        }

        if (azure?.location !== undefined) {
            keyFacts.push({ label: l10n.t('Region'), value: regionToDisplayName(azure.location) });
        }

        const compute = describeCompute(azure);
        if (compute !== null) {
            keyFacts.push({ label: l10n.t('Compute'), value: compute });
        }

        if (latestSample?.uptimeSeconds !== null && latestSample?.uptimeSeconds !== undefined) {
            keyFacts.push({ label: l10n.t('Uptime'), value: formatUptime(latestSample.uptimeSeconds) });
        }
    }

    const latencyText =
        typeof latestSample?.pingLatencyMs === 'number'
            ? l10n.t('{latency} ms', { latency: Math.round(latestSample.pingLatencyMs) })
            : '';
    const latencyLabel =
        latencyText === '' ? l10n.t('Ping latency not measured yet') : l10n.t('Ping latency {0}', latencyText);

    return (
        <header className="dashboardHeader">
            <div className="dashboardHeaderIcon" aria-hidden="true">
                <DataBarVerticalAscendingRegular fontSize={48} />
            </div>

            <div className="dashboardHeaderText">
                <div className="dashboardHeaderIdentity">
                    <h1 className="dashboardHeaderTitle" title={clusterDisplayName}>
                        {clusterDisplayName}
                    </h1>
                    {showAddress && (
                        <span className="dashboardHeaderAddress" title={clusterInfo?.hosts.join(', ')}>
                            {address}
                        </span>
                    )}
                </div>
            </div>

            <div className="dashboardHeaderBadges">
                {keyFacts.map((fact) => (
                    <Badge
                        key={fact.label}
                        appearance="filled"
                        color="subtle"
                        shape="rounded"
                        className="dashboardHeaderFact"
                    >
                        <span className="dashboardHeaderFactLabel">{fact.label}</span>
                        <span className="dashboardHeaderFactValue">{fact.value}</span>
                    </Badge>
                ))}
                {/*
                 * Rounded and tinted, like every other badge in the extension — a filled pill
                 * read as a different family of object from the index and property badges the
                 * reader has already met.
                 */}
                <Badge appearance="tint" shape="rounded" color={connectionAppearance} aria-label={connectionLabel}>
                    {connectionLabel}
                </Badge>
                {/*
                 * Liveness lives here, next to the badge that already asserts it — not as a
                 * chart. A number is the honest representation of a ping; the metric row
                 * below is reserved for what the cluster contains.
                 *
                 * Rendered whenever connected, empty while a sample is missing, and given a
                 * fixed width: a bare figure that appears, disappears and changes digit count
                 * moved the badges beside it on every poll.
                 */}
                {connectionState === 'connected' && (
                    <Tooltip
                        content={l10n.t(
                            'Round-trip time of the most recent ping to this cluster. It measures the network path and the server’s responsiveness, not the speed of your queries.',
                        )}
                        relationship="description"
                        withArrow
                    >
                        {/*
                         * Focusable so the explanation is reachable without a pointer, which
                         * WCAG 1.4.13 requires of a tooltip carrying information not stated
                         * elsewhere. The same pattern the index list uses for its truncated
                         * property badges.
                         */}
                        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                        <span className="dashboardHeaderLatency" tabIndex={0} aria-label={latencyLabel}>
                            <span aria-hidden={true}>{latencyText}</span>
                        </span>
                    </Tooltip>
                )}
                {resilienceWarnings.map((warning) => (
                    <Badge key={warning} appearance="outline" shape="rounded" color="warning">
                        {warning}
                    </Badge>
                ))}
            </div>
        </header>
    );
};
