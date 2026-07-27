/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Skeleton, SkeletonItem } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHealthSample } from '../../../../documentdb/utils/getClusterHealth';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { formatUptime } from '../formatUtils';

/** Connection state derived from the most recent samples. */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface HeaderCardProps {
    clusterDisplayName: string;
    clusterInfo: ClusterDashboardInfo | null;
    latestSample: ClusterHealthSample | null;
    connectionState: ConnectionState;
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

    const version = metadata?.['serverInfo_version'] ?? PLACEHOLDER;
    const platform = metadata?.['serverInfo_platform'] ?? PLACEHOLDER;
    const host = extractHostName(metadata?.['hostInfo_json']) ?? PLACEHOLDER;

    // `topology_type` is `hello.msg`, which only mongos sets ('isdbgrid'); every
    // standalone, emulator, and replica-set primary would render the literal word
    // 'unknown', and a mongos would render a raw wire token. Report the server count
    // instead, which is meaningful everywhere.
    const serverCount = metadata?.['topology_numberOfServers'];
    const topology =
        metadata?.['topology_type'] === 'isdbgrid'
            ? l10n.t('Sharded cluster')
            : serverCount !== undefined && Number(serverCount) > 1
              ? l10n.t('Replica set ({count} servers)', { count: serverCount })
              : serverCount !== undefined
                ? l10n.t('Standalone')
                : PLACEHOLDER;

    return (
        <Card className="headerCard" appearance="filled">
            <div className="headerTitleRow">
                <h1 className="headerTitle" title={clusterDisplayName}>
                    {clusterDisplayName}
                </h1>
                <Badge appearance="filled" color={connectionAppearance} aria-label={connectionLabel}>
                    {connectionLabel}
                </Badge>
            </div>

            {clusterInfo === null ? (
                <Skeleton aria-label={l10n.t('Loading cluster information…')}>
                    <SkeletonItem size={16} />
                </Skeleton>
            ) : (
                <div className="headerDetails">
                    <DetailItem label={l10n.t('Server version')} value={version} />
                    <DetailItem label={l10n.t('Platform')} value={platform} />
                    <DetailItem label={l10n.t('Topology')} value={topology} />
                    <DetailItem label={l10n.t('Host')} value={host} />
                    <DetailItem
                        label={l10n.t('Uptime')}
                        value={formatUptime(latestSample?.uptimeSeconds, PLACEHOLDER)}
                    />
                </div>
            )}
        </Card>
    );
};
