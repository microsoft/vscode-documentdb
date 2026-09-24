/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Fragment, useId, useState, type JSX } from 'react';

import { ArrowClockwiseRegular, DataBarVerticalAscendingRegular, NetworkCheckRegular } from '@fluentui/react-icons';
import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { formatUptime } from '../formatUtils';
import { buildDetailGroups, DashboardDetailsRegion, DetailsDisclosureButton } from './DashboardDetails';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

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
 * Resilience warnings, surfaced as findings in the Cluster health section.
 *
 * These answer "is this cluster safe?", the question the data inventory does not address.
 * They are deliberately static facts, not metrics: a cluster without high availability is a
 * production-readiness finding, and a read-only connection is something a user needs to know
 * *before* attempting a write.
 */
export function collectResilienceWarnings(
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

export interface DashboardHeaderProps {
    clusterDisplayName: string;
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    connectionState: ConnectionState;
    /** Azure resource facts, absent for a non-Azure cluster. */
    azure?: ClusterDashboardAzureInfo;
    onRefresh: () => void;
    isRefreshDisabled: boolean;
    onShowRawDiagnostics?: () => void;
    onCopyConnectionString?: () => void;
    isExportingDiagnostics?: boolean;
}

/**
 * Identity row and compact status card.
 *
 * The identity row carries the name and the page-level Refresh. The card below it states
 * connection, version, region, compute and uptime on one wrapping line, and discloses the
 * complete server and Azure facts in place, pushing the page down.
 */
export const DashboardHeader = ({
    clusterDisplayName,
    clusterInfo,
    latestSample,
    connectionState,
    azure,
    onRefresh,
    isRefreshDisabled,
    onShowRawDiagnostics,
    onCopyConnectionString,
    isExportingDiagnostics,
}: DashboardHeaderProps): JSX.Element => {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();

    const connectionLabel =
        connectionState === 'connected'
            ? l10n.t('Connected')
            : connectionState === 'disconnected'
              ? l10n.t('Disconnected')
              : l10n.t('Connecting…');

    const connectionAppearance =
        connectionState === 'connected' ? 'success' : connectionState === 'disconnected' ? 'danger' : 'warning';

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

    const detailGroups = buildDetailGroups(clusterInfo, azure);

    return (
        <header className="dashboardHeader">
            <div className="dashboardHeaderRow">
                <div className="dashboardHeaderIdentity">
                    <div className="dashboardHeaderIcon" aria-hidden="true">
                        <DataBarVerticalAscendingRegular />
                    </div>
                    <div className="dashboardHeaderText">
                        <h1 className="dashboardHeaderTitle" title={clusterDisplayName}>
                            {clusterDisplayName}
                        </h1>
                        <p className="dashboardHeaderSubtitle">
                            {azure !== undefined ? l10n.t('Azure DocumentDB cluster') : l10n.t('DocumentDB cluster')}
                        </p>
                    </div>
                </div>
                <div className="dashboardHeaderControls">
                    <Tooltip
                        content={l10n.t('Re-read cluster storage statistics and the current inventory')}
                        relationship="description"
                        withArrow
                    >
                        <Button
                            appearance="subtle"
                            size="small"
                            className="dashboardLinkButton"
                            icon={<ArrowClockwiseRegular />}
                            disabled={isRefreshDisabled}
                            onClick={onRefresh}
                        >
                            {l10n.t('Refresh')}
                        </Button>
                    </Tooltip>
                </div>
            </div>

            <div className="dashboardStatusCard">
                <div className="dashboardStatusRow">
                    <div className="dashboardStatusItems">
                        <span className="dashboardStatusItem">
                            <span className="dashboardFactLabel">{l10n.t('Connection')}</span>
                            <Badge
                                className="dashboardConnectionStatus"
                                appearance="tint"
                                shape="rounded"
                                size="small"
                                color={connectionAppearance}
                            >
                                {connectionLabel}
                            </Badge>
                            {connectionState === 'connected' && (
                                <Tooltip
                                    content={l10n.t(
                                        'Round-trip time of the most recent ping to this cluster. It measures the network path and the server’s responsiveness, not the speed of your queries.',
                                    )}
                                    relationship="description"
                                    withArrow
                                >
                                    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                                    <span className="dashboardHeaderLatency" tabIndex={0} aria-label={latencyLabel}>
                                        <NetworkCheckRegular
                                            className="dashboardHeaderLatencyIcon"
                                            aria-hidden={true}
                                        />
                                        <span aria-hidden={true}>{latencyText}</span>
                                    </span>
                                </Tooltip>
                            )}
                        </span>
                        {keyFacts.map((fact) => (
                            <Fragment key={fact.label}>
                                <span className="dashboardFactSeparator" aria-hidden="true">
                                    |
                                </span>
                                <span className="dashboardStatusItem">
                                    <span className="dashboardFactLabel">{fact.label}</span>
                                    <span className="dashboardFactValue">{fact.value}</span>
                                </span>
                            </Fragment>
                        ))}
                    </div>
                    {detailGroups.length > 0 && (
                        <DetailsDisclosureButton
                            expanded={expanded}
                            controlsId={detailsId}
                            onToggle={() => setExpanded(!expanded)}
                        />
                    )}
                </div>
                {/* Kept mounted so the motion has a `visible` change to play — see DashboardDetails. */}
                <DashboardDetailsRegion
                    id={detailsId}
                    expanded={expanded && detailGroups.length > 0}
                    groups={detailGroups}
                    onShowRawDiagnostics={onShowRawDiagnostics}
                    onCopyConnectionString={onCopyConnectionString}
                    isExportingDiagnostics={isExportingDiagnostics}
                />
            </div>
        </header>
    );
};
