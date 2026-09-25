/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Tooltip } from '@fluentui/react-components';
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

interface KeyFact {
    label: string;
    value: string | VersionTag[];
}

interface HeaderStatusItemsProps {
    connectionLabel: string;
    connectionAppearance: 'success' | 'danger' | 'warning';
    connectionState: ConnectionState;
    latencyLabel: string;
    latencyText: string;
    keyFacts: KeyFact[];
    resilienceWarnings: string[];
    versionId: string;
}

const HeaderStatusItems = ({
    connectionLabel,
    connectionAppearance,
    connectionState,
    latencyLabel,
    latencyText,
    keyFacts,
    resilienceWarnings,
    versionId,
}: HeaderStatusItemsProps): JSX.Element => (
    <>
        <Badge
            className="dashboardConnectionStatus"
            appearance="tint"
            shape="rounded"
            color={connectionAppearance}
            aria-label={connectionLabel}
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
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the latency tooltip */}
                <span className="dashboardHeaderLatency" tabIndex={0} aria-label={latencyLabel}>
                    <NetworkCheckRegular className="dashboardHeaderLatencyIcon" aria-hidden={true} />
                    <span aria-hidden={true}>{latencyText}</span>
                </span>
            </Tooltip>
        )}
        {resilienceWarnings.map((warning) => (
            <span className="dashboardFactSegment dashboardWarning" key={warning}>
                <span className="dashboardFactSeparator" aria-hidden="true">
                    |
                </span>
                <Badge className="dashboardResilienceWarning" appearance="outline" shape="rounded" color="warning">
                    {warning}
                </Badge>
            </span>
        ))}
        {keyFacts.map((fact) =>
            Array.isArray(fact.value) ? (
                fact.value.map((version, versionIndex) => (
                    <span className="dashboardFactSegment dashboardVersion" key={`${fact.label}-${version.label}`}>
                        <span className="dashboardFactSeparator" aria-hidden="true">
                            |
                        </span>
                        <Tooltip content={version.tooltip} relationship="description">
                            <span
                                className="dashboardFact"
                                role="group"
                                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the version tooltip
                                tabIndex={0}
                                aria-labelledby={`${versionId}-${versionIndex}-label ${versionId}-${versionIndex}-value`}
                            >
                                <span className="dashboardFactLabel" id={`${versionId}-${versionIndex}-label`}>
                                    {version.label}
                                </span>
                                <span className="dashboardFactValue" id={`${versionId}-${versionIndex}-value`}>
                                    {version.value}
                                </span>
                            </span>
                        </Tooltip>
                    </span>
                ))
            ) : (
                <span className="dashboardFactSegment" key={fact.label}>
                    <span className="dashboardFactName">
                        <span className="dashboardFactSeparator" aria-hidden="true">
                            |
                        </span>
                        <span className="dashboardFactLabel">{fact.label}</span>
                    </span>
                    <span className="dashboardFactValue" title={fact.value}>
                        {fact.value}
                    </span>
                </span>
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
 * Resilience warnings shown as badges beside the connection state.
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

    const resilienceWarnings = collectResilienceWarnings(clusterInfo?.metadata, azure);

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
                tooltip: l10n.t('DocumentDB version information reported by the server: {0}', versions.engine),
            });
        }
        if (versions.api !== undefined) {
            versionParts.push({
                label: l10n.t('API'),
                value: versions.api,
                tooltip: l10n.t('MongoDB API compatibility version reported by the server: {0}', versions.api),
            });
        }
        if (versionParts.length > 0) {
            keyFacts.push({ label: l10n.t('Version'), value: versionParts });
        } else if (versions.server !== undefined) {
            keyFacts.push({ label: l10n.t('Version'), value: versions.server });
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
                            resilienceWarnings={resilienceWarnings}
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
