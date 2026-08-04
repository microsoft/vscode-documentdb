/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Card, Skeleton, SkeletonItem, Text, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterHostFacts, type ClusterTopology } from '../../../../documentdb/utils/getClusterHealth';
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

/** Machine facts as one line, e.g. `Linux Ubuntu 22.04 · x86_64 · 8 cores · 32 GB`. */
function describeMachine(host: ClusterHostFacts): string | null {
    const parts: string[] = [];

    const os = [host.osType, host.osName, host.osVersion].filter((value): value is string => value !== null);
    if (os.length > 0) {
        parts.push(os.join(' '));
    }
    if (host.cpuArch !== null) {
        parts.push(host.cpuArch);
    }
    if (host.numCores !== null) {
        parts.push(host.numCores === 1 ? l10n.t('1 core') : l10n.t('{count} cores', { count: String(host.numCores) }));
    }
    if (host.memSizeMB !== null) {
        parts.push(l10n.t('{size} GB RAM', { size: (host.memSizeMB / 1024).toFixed(host.memSizeMB < 1024 ? 1 : 0) }));
    }

    return parts.length > 0 ? parts.join(' · ') : null;
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
                 * Marked as a draft on the card itself: it is here to find out whether the
                 * information is worth showing at all, and a reader deserves to know that
                 * before relying on it.
                 */}
                <Badge appearance="outline" color="informative">
                    {l10n.t('Draft')}
                </Badge>
            </div>

            <div className="topologyKind">{describeKind(topology, metadataShape)}</div>

            {topology.servers.length === 0 ? (
                <div className="topologyEmpty">
                    {l10n.t('This server does not report the machines behind the connection.')}
                </div>
            ) : (
                <ul className="topologyServers">
                    {topology.servers.map((server) => (
                        <li key={server.address} className="topologyServer">
                            <span className="topologyServerAddress" title={server.address}>
                                {server.address}
                            </span>
                            <span className="topologyServerMeta">
                                {server.role !== null && (
                                    <Badge appearance="tint" color={roleAppearance(server.role)} size="small">
                                        {server.role}
                                    </Badge>
                                )}
                                {server.isCurrentConnection && (
                                    <Tooltip
                                        content={l10n.t('The member serving this connection')}
                                        relationship="description"
                                        withArrow
                                    >
                                        <Badge appearance="outline" size="small">
                                            {l10n.t('This connection')}
                                        </Badge>
                                    </Tooltip>
                                )}
                                {server.healthy === false && (
                                    <Badge appearance="tint" color="danger" size="small">
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
                        {topology.shards.map((shard) => (
                            <li key={shard.name} className="topologyServer">
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
