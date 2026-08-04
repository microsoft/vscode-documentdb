/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge } from '@fluentui/react-components';
import { DatabaseMultipleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { collectResilienceWarnings, describeAddress } from '../clusterFacts';

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
 * The full-width identity band: icon, the cluster's name as the title, and the address it is
 * actually connected to as the subtitle.
 *
 * Two names are in play and they routinely disagree — the tree's display name is whatever
 * the user or a discovery provider chose, while the address is which server is on screen.
 * Showing both, in the same title/subtitle shape the other webview tabs use, is what makes
 * the band worth its full width rather than a row of facts (those live in the right column).
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

    return (
        <header className="dashboardHeader">
            <div className="dashboardHeaderIcon" aria-hidden="true">
                <DatabaseMultipleRegular />
            </div>

            <div className="dashboardHeaderText">
                <h1 className="dashboardHeaderTitle" title={clusterDisplayName}>
                    {clusterDisplayName}
                </h1>
                {/*
                 * Held open with a non-breaking space rather than removed while the host list
                 * is in flight: the address arrives one round trip after the name, and a
                 * subtitle that pops into existence would shove the whole layout down.
                 */}
                <span className="dashboardHeaderSubtitle" title={clusterInfo?.hosts.join(', ')}>
                    {address ?? ' '}
                </span>
            </div>

            <div className="dashboardHeaderBadges">
                <Badge appearance="filled" color={connectionAppearance} aria-label={connectionLabel}>
                    {connectionLabel}
                </Badge>
                {/*
                 * Liveness lives here, next to the badge that already asserts it — not as a
                 * chart. A number is the honest representation of a ping; the metric row
                 * below is reserved for what the cluster contains.
                 */}
                {connectionState === 'connected' && typeof latestSample?.pingLatencyMs === 'number' && (
                    <span className="dashboardHeaderLatency">
                        {l10n.t('{latency} ms', { latency: Math.round(latestSample.pingLatencyMs) })}
                    </span>
                )}
                {resilienceWarnings.map((warning) => (
                    <Badge key={warning} appearance="outline" color="warning">
                        {warning}
                    </Badge>
                ))}
            </div>
        </header>
    );
};
