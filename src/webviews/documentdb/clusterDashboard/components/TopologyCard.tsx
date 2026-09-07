/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, Skeleton, SkeletonItem, Text, Tooltip } from '@fluentui/react-components';
import { EyeRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHostFacts, type ClusterTopology } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { PLACEHOLDER } from '../clusterFacts';
import { formatUptime } from '../formatUtils';

export interface TopologyCardProps {
    /** `null` while the one-shot probe is in flight. */
    topology: ClusterTopology | null;
    /**
     * The shape read from the one-shot cluster metadata, used only when the probe itself
     * could not determine one.
     *
     * This card is the single owner of "what shape is this cluster": the facts card used to
     * state it too, from this very string, and the two disagreed whenever the probe and the
     * metadata read `hello` differently. The fallback keeps that reading available without
     * putting a second, competing answer on screen.
     */
    metadataShape?: string;
}

/** One-line summary of what kind of deployment answered, e.g. `Replica set · rs0`. */
function describeKind(topology: ClusterTopology, metadataShape: string | undefined): string {
    switch (topology.kind) {
        case 'sharded':
            return l10n.t('Sharded cluster');
        case 'replicaSet':
            return topology.setName === null
                ? l10n.t('Replica set')
                : l10n.t('Replica set · {name}', { name: topology.setName });
        case 'standalone':
            return l10n.t('Standalone server');
        default:
            return metadataShape !== undefined && metadataShape !== PLACEHOLDER
                ? metadataShape
                : l10n.t('Not reported by this server');
    }
}

/**
 * Whether a `hostInfo` figure is a real measurement.
 *
 * A server that does not measure the machine answers `0` rather than omitting the field —
 * Azure DocumentDB (vCore) reports `0` cores and `0 MB` of RAM. Printing "0 GB RAM" states a
 * fact about the hardware that is certainly false; the figure is missing, and the card says so.
 */
function isReported(value: number | null): value is number {
    return value !== null && value > 0;
}

/** Machine facts as one line, e.g. `Linux Ubuntu 22.04 · x86_64 · 8 cores · 32 GB RAM`. */
function describeMachine(host: ClusterHostFacts): string | null {
    // Resolved per call, not at module scope: the l10n bundle is configured after this
    // module is imported.
    const notAvailable = l10n.t('N/A');
    const parts: string[] = [];

    const os = [host.osType, host.osName, host.osVersion].filter((value): value is string => value !== null);
    if (os.length > 0) {
        parts.push(os.join(' '));
    }
    if (host.cpuArch !== null && host.cpuArch !== '') {
        parts.push(host.cpuArch);
    }

    // A server that reported none of it gets no line at all — a row reading only
    // "Cores: N/A · RAM: N/A" is noise, not information.
    if (parts.length === 0 && !isReported(host.numCores) && !isReported(host.memSizeMB)) {
        return null;
    }

    parts.push(
        isReported(host.numCores)
            ? host.numCores === 1
                ? l10n.t('1 core')
                : l10n.t('{count} cores', { count: String(host.numCores) })
            : l10n.t('Cores: {value}', { value: notAvailable }),
    );
    parts.push(
        isReported(host.memSizeMB)
            ? l10n.t('{size} GB RAM', { size: (host.memSizeMB / 1024).toFixed(host.memSizeMB < 1024 ? 1 : 0) })
            : l10n.t('RAM: {value}', { value: notAvailable }),
    );

    return parts.join(' · ');
}

/** Colour for a replica-set role badge; only a primary is called out. */
function roleAppearance(role: string): 'brand' | 'informative' {
    return role.toUpperCase() === 'PRIMARY' ? 'brand' : 'informative';
}

/**
 * An exploratory look at what sits behind the connection.
 *
 * This is a draft, and the card says so: the data plane is the only thing being asked, and
 * how much it will admit varies wildly. A self-hosted replica set answers
 * `replSetGetStatus` with every member's role, health and uptime; Azure DocumentDB (vCore)
 * refuses it and advertises a single endpoint, so the card honestly shows one row. What is
 * never done is inventing structure the server did not report — an empty card is the correct
 * answer for a platform that hides its topology.
 */
export const TopologyCard = ({ topology, metadataShape }: TopologyCardProps): JSX.Element => {
    const trpcClient = useTrpcClient();

    const viewRawTopology = (): void => {
        void trpcClient.clusterDashboard.viewRawTopology.mutate().catch((error: unknown) => {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to open the topology details.'),
                modal: true,
                cause: error instanceof Error ? error.message : String(error),
            });
        });
    };

    if (topology === null) {
        return (
            <Card className="summaryCard topologyCard">
                <Text weight="semibold" size={400} className="topologyCardTitle">
                    {l10n.t('Topology')}
                </Text>
                <Skeleton aria-label={l10n.t('Loading topology…')}>
                    <SkeletonItem size={16} />
                </Skeleton>
            </Card>
        );
    }

    const machine = topology.host === null ? null : describeMachine(topology.host);

    return (
        <Card className="summaryCard topologyCard">
            <div className="topologyCardHeader">
                <Text weight="semibold" size={400} className="topologyCardTitle">
                    {l10n.t('Topology')}
                </Text>
                {/*
                 * What a platform will admit about its own shape varies wildly, and the rows
                 * below show only what could be named. The probe's whole reply is one click
                 * away for the rest.
                 */}
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<EyeRegular />}
                    className="summaryCardAction"
                    onClick={viewRawTopology}
                >
                    {l10n.t('View Raw Topology')}
                </Button>
            </div>

            <div className="topologyKind">{describeKind(topology, metadataShape)}</div>

            {topology.servers.length === 0 ? (
                <div className="topologyEmpty">
                    {l10n.t('This server does not report the machines behind the connection.')}
                </div>
            ) : (
                <ul className="topologyServers">
                    {/*
                     * Keyed by position as well as address. A server is free to advertise the
                     * same host twice — `hello.hosts` is not promised to be a set, and a
                     * misconfigured replica set can report two members under one name — and a
                     * bare address key made React drop or duplicate rows for exactly the
                     * cluster whose topology most needs reading.
                     */}
                    {topology.servers.map((server, index) => (
                        <li key={`${index}:${server.address}`} className="topologyServer">
                            <span className="topologyServerAddress" title={server.address}>
                                {server.address}
                            </span>
                            <span className="topologyServerMeta">
                                {server.role !== null && (
                                    <Badge
                                        appearance="tint"
                                        shape="rounded"
                                        color={roleAppearance(server.role)}
                                        size="small"
                                    >
                                        {server.role}
                                    </Badge>
                                )}
                                {server.isCurrentConnection && (
                                    <Tooltip
                                        content={l10n.t('The member serving this connection')}
                                        relationship="description"
                                        withArrow
                                    >
                                        <Badge appearance="outline" shape="rounded" size="small">
                                            {l10n.t('This connection')}
                                        </Badge>
                                    </Tooltip>
                                )}
                                {server.healthy === false && (
                                    <Badge appearance="tint" shape="rounded" color="danger" size="small">
                                        {l10n.t('Unhealthy')}
                                    </Badge>
                                )}
                                {server.uptimeSeconds !== null && (
                                    <span className="topologyServerUptime">
                                        {l10n.t('up {duration}', {
                                            duration: formatUptime(server.uptimeSeconds),
                                        })}
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {topology.shards.length > 0 && (
                <>
                    <div className="topologySectionLabel">{l10n.t('Shards')}</div>
                    <ul className="topologyServers">
                        {topology.shards.map((shard, index) => (
                            <li key={`${index}:${shard.name}`} className="topologyServer">
                                <span className="topologyServerAddress" title={shard.host}>
                                    {shard.name}
                                </span>
                                <span className="topologyServerMeta topologyServerHost" title={shard.host}>
                                    {shard.host}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {machine !== null && (
                <div className="topologyMachine" title={machine}>
                    {machine}
                </div>
            )}
        </Card>
    );
};
