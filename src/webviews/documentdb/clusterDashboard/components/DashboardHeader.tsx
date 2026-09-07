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
import { collectResilienceWarnings, describeAddress, describeCompute } from '../clusterFacts';
import { formatUptime } from '../formatUtils';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

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

    // EXPERIMENT — four at most, in the order a reader asks them: what version, where, how
    // big, how long has it been up. The rest lives on the About tab.
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
