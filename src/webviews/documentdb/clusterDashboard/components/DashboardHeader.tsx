/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tooltip } from '@fluentui/react-components';
import { FocusableBadge } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { useId, useState, type JSX } from 'react';

import { DataBarVerticalAscendingRegular, NetworkCheckRegular } from '@fluentui/react-icons';
import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { regionToDisplayName } from '../../../../utils/regionToDisplayName';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { formatUptime, getClusterVersions } from '../formatUtils';
import { buildDetailGroups, DashboardDetailsRegion, DetailsDisclosureButton } from './DashboardDetails';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface VersionTag {
    label: string;
    value: string;
    tooltip: string;
}

interface TextFact {
    label: string;
    value: string;
    tooltip: string;
}

interface VersionFact {
    label: string;
    value: VersionTag[];
}

type KeyFact = TextFact | VersionFact;

const isVersionFact = (fact: KeyFact): fact is VersionFact => Array.isArray(fact.value);

interface ResilienceBadge {
    label: string;
    tooltip: string;
    color: 'warning' | 'success';
}

interface HeaderStatusItemsProps {
    connectionLabel: string;
    connectionAppearance: 'success' | 'danger' | 'warning';
    connectionState: ConnectionState;
    latencyLabel: string;
    latencyText: string;
    keyFacts: KeyFact[];
    resilienceBadges: ResilienceBadge[];
    versionId: string;
}

const HeaderStatusItems = ({
    connectionLabel,
    connectionAppearance,
    connectionState,
    latencyLabel,
    latencyText,
    keyFacts,
    resilienceBadges,
    versionId,
}: HeaderStatusItemsProps): JSX.Element => (
    <>
        <Tooltip
            content={l10n.t('Connection status based on periodic ping commands to this cluster.')}
            relationship="description"
            withArrow
        >
            <FocusableBadge
                className="dashboardConnectionStatus"
                appearance="tint"
                shape="rounded"
                color={connectionAppearance}
            >
                {connectionLabel}
            </FocusableBadge>
        </Tooltip>
        {connectionState === 'connected' && (
            <Tooltip
                content={l10n.t(
                    'Time for the most recent ping command to complete. Includes network and server response time, not query execution time.',
                )}
                relationship="description"
                withArrow
            >
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the latency tooltip */}
                <span className="dashboardHeaderLatency" role="group" tabIndex={0} aria-label={latencyLabel}>
                    <NetworkCheckRegular className="dashboardHeaderLatencyIcon" aria-hidden={true} />
                    <span aria-hidden={true}>{latencyText}</span>
                </span>
            </Tooltip>
        )}
        {resilienceBadges.map((badge) => (
            <span className="dashboardFactSegment dashboardResilience" key={badge.label}>
                <span className="dashboardFactSeparator" aria-hidden="true">
                    |
                </span>
                <Tooltip content={badge.tooltip} relationship="description" withArrow>
                    <FocusableBadge
                        className="dashboardResilienceBadge"
                        appearance="outline"
                        shape="rounded"
                        color={badge.color}
                    >
                        {badge.label}
                    </FocusableBadge>
                </Tooltip>
            </span>
        ))}
        {keyFacts.map((fact, factIndex) =>
            isVersionFact(fact) ? (
                fact.value.map((version, versionIndex) => (
                    <Tooltip
                        content={version.tooltip}
                        relationship="description"
                        withArrow
                        key={`${fact.label}-${version.label}`}
                    >
                        <span
                            className="dashboardFactSegment dashboardVersion"
                            role="group"
                            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the version tooltip
                            tabIndex={0}
                            aria-labelledby={`${versionId}-${versionIndex}-label ${versionId}-${versionIndex}-value`}
                        >
                            <span className="dashboardFactSeparator" aria-hidden="true">
                                |
                            </span>
                            <span className="dashboardFact">
                                <span className="dashboardFactLabel" id={`${versionId}-${versionIndex}-label`}>
                                    {version.label}
                                </span>
                                <span className="dashboardFactValue" id={`${versionId}-${versionIndex}-value`}>
                                    {version.value}
                                </span>
                            </span>
                        </span>
                    </Tooltip>
                ))
            ) : (
                <Tooltip content={fact.tooltip} relationship="description" withArrow key={fact.label}>
                    <span
                        className="dashboardFactSegment"
                        role="group"
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the fact tooltip
                        tabIndex={0}
                        aria-labelledby={`${versionId}-fact-${factIndex}-label ${versionId}-fact-${factIndex}-value`}
                    >
                        <span className="dashboardFactName">
                            <span className="dashboardFactSeparator" aria-hidden="true">
                                |
                            </span>
                            <span className="dashboardFactLabel" id={`${versionId}-fact-${factIndex}-label`}>
                                {fact.label}
                            </span>
                        </span>
                        <span className="dashboardFactValue" id={`${versionId}-fact-${factIndex}-value`}>
                            {fact.value}
                        </span>
                    </span>
                </Tooltip>
            ),
        )}
    </>
);

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
 * Resilience state shown as badges beside the connection state.
 *
 * These answer "is this cluster safe?", the question the data inventory does not address.
 * They are deliberately static facts, not metrics: the Azure resource reports whether in-region
 * high availability is enabled, while the server can report a read-only connection before a
 * user attempts a write.
 */
export function collectResilienceBadges(
    metadata: Record<string, string | undefined> | undefined,
    azure: ClusterDashboardAzureInfo | undefined,
): ResilienceBadge[] {
    const badges: ResilienceBadge[] = [];

    // `hello.readOnly` is answered by every server, so this warning is not Azure-specific:
    // it also catches a connection pinned to a secondary.
    if (metadata?.['topology_readOnly'] === 'true') {
        badges.push({
            label: l10n.t('Read-only connection'),
            tooltip: l10n.t('The connected server reported readOnly: true in its hello response.'),
            color: 'warning',
        });
    }

    if (azure?.enableHa !== undefined) {
        badges.push(
            azure.enableHa
                ? {
                      label: l10n.t('High Availability'),
                      tooltip: l10n.t('The Azure resource reports that in-region high availability is enabled.'),
                      color: 'success',
                  }
                : {
                      label: l10n.t('No high availability'),
                      tooltip: l10n.t('The Azure resource reports that in-region high availability is disabled.'),
                      color: 'warning',
                  },
        );
    }

    return badges;
}

export interface DashboardHeaderProps {
    clusterDisplayName: string;
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    connectionState: ConnectionState;
    /** Azure resource facts, absent for a non-Azure cluster. */
    azure?: ClusterDashboardAzureInfo;
    onShowRawDiagnostics?: () => void;
    isExportingDiagnostics?: boolean;
}

/**
 * The full-width identity band: icon and cluster name, followed by its facts, connection state
 * and latency. Status items wrap when space is limited, while the details disclosure stays
 * at the top right.
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
    onShowRawDiagnostics,
    isExportingDiagnostics,
}: DashboardHeaderProps): JSX.Element => {
    const [expanded, setExpanded] = useState(false);
    const versionId = useId();

    const connectionLabel =
        connectionState === 'connected'
            ? l10n.t('Connected')
            : connectionState === 'disconnected'
              ? l10n.t('Disconnected')
              : l10n.t('Connecting…');

    const connectionAppearance =
        connectionState === 'connected' ? 'success' : connectionState === 'disconnected' ? 'danger' : 'warning';

    const resilienceBadges = collectResilienceBadges(clusterInfo?.metadata, azure);

    // Four at most, in the order a reader asks them: what version, where, how big, how long
    // has it been up.
    const keyFacts: KeyFact[] = [];

    if (clusterInfo !== null) {
        const versions = getClusterVersions(clusterInfo.metadata);
        const versionParts: VersionTag[] = [];
        if (versions.engine !== undefined) {
            versionParts.push({
                label: l10n.t('DocumentDB'),
                value: versions.engine,
                tooltip: l10n.t('DocumentDB component versions reported by the server’s hello command.'),
            });
        }
        if (versions.api !== undefined) {
            versionParts.push({
                label: l10n.t('API'),
                value: versions.api,
                tooltip: l10n.t('API compatibility version reported by the server’s buildInfo command.'),
            });
        }
        if (versionParts.length > 0) {
            keyFacts.push({ label: l10n.t('Version'), value: versionParts });
        } else if (versions.server !== undefined) {
            keyFacts.push({
                label: l10n.t('Version'),
                value: versions.server,
                tooltip: l10n.t('Server version reported by the buildInfo command.'),
            });
        }

        if (azure?.location !== undefined) {
            keyFacts.push({
                label: l10n.t('Region'),
                value: regionToDisplayName(azure.location),
                tooltip: l10n.t('Azure region reported in the cluster’s resource metadata.'),
            });
        }

        const compute = describeCompute(azure);
        if (compute !== null) {
            keyFacts.push({
                label: l10n.t('Compute'),
                value: compute,
                tooltip: l10n.t(
                    'Compute tier, node count, and provisioned disk size reported in the Azure resource metadata.',
                ),
            });
        }

        if (latestSample?.uptimeSeconds !== null && latestSample?.uptimeSeconds !== undefined) {
            keyFacts.push({
                label: l10n.t('Uptime'),
                value: formatUptime(latestSample.uptimeSeconds),
                tooltip: l10n.t('Time since the server started, reported by its serverStatus command.'),
            });
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
        <>
            <header className="dashboardHeader">
                <div className="dashboardHeaderIdentityGroup">
                    <div className="dashboardHeaderIcon" aria-hidden="true">
                        <DataBarVerticalAscendingRegular fontSize={48} />
                    </div>

                    <div className="dashboardHeaderText">
                        <div className="dashboardHeaderIdentity">
                            <h1 className="dashboardHeaderTitle" title={clusterDisplayName}>
                                {clusterDisplayName}
                            </h1>
                        </div>
                    </div>
                </div>

                <div className="dashboardHeaderStatus">
                    <div className="dashboardHeaderItems" role="group" aria-label={l10n.t('Cluster status')}>
                        <HeaderStatusItems
                            connectionLabel={connectionLabel}
                            connectionAppearance={connectionAppearance}
                            connectionState={connectionState}
                            latencyLabel={latencyLabel}
                            latencyText={latencyText}
                            keyFacts={keyFacts}
                            resilienceBadges={resilienceBadges}
                            versionId={versionId}
                        />
                    </div>
                    {detailGroups.length > 0 && (
                        <DetailsDisclosureButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
                    )}
                </div>
            </header>
            {/* Kept mounted so the motion has a `visible` change to play — see DashboardDetails. */}
            <DashboardDetailsRegion
                expanded={expanded && detailGroups.length > 0}
                groups={detailGroups}
                onShowRawDiagnostics={onShowRawDiagnostics}
                isExportingDiagnostics={isExportingDiagnostics}
            />
        </>
    );
};
