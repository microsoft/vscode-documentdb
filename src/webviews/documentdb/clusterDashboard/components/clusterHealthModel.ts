/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

import { type ClusterHealthSample, type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { type ClusterDashboardAzureInfo } from '../clusterDashboardController';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import { type ConnectionState } from './DashboardHeader';

export type FindingSeverity = 'critical' | 'warning' | 'informational';

export interface ClusterFinding {
    readonly id: 'disconnected' | 'readOnly' | 'noHighAvailability' | 'replica';
    readonly severity: FindingSeverity;
    readonly title: string;
    readonly evidence: string;
    /** Where the signal came from, so a derived fact is never mistaken for a server alert. */
    readonly source: string;
}

export type CoverageState = 'available' | 'partial' | 'unavailable' | 'loading' | 'notApplicable';

export interface CoverageEntry {
    readonly id: 'ping' | 'server' | 'storage' | 'azure';
    readonly label: string;
    readonly state: CoverageState;
    readonly status: string;
}

export interface ClusterHealthInput {
    readonly connectionState: ConnectionState;
    readonly consecutiveFailures: number;
    readonly latestSample: ClusterHealthSample | null;
    readonly refreshIntervalMs: number;
    readonly clusterInfo: ClusterDashboardInfo | null;
    readonly clusterInfoError: string | null;
    readonly azure?: ClusterDashboardAzureInfo;
    readonly storageStats: ClusterStorageStats | null;
    readonly storageError: string | null;
}

const severityOrder: Record<FindingSeverity, number> = { critical: 0, warning: 1, informational: 2 };

/**
 * Cluster-level signals the dashboard already has, restated as findings.
 *
 * Nothing here is a new measurement: each finding is a fact another part of the page already
 * reads — the health ping, `hello.readOnly`, the ARM resource record. A check whose input is
 * missing produces no finding and is reported as not run by {@link describeCoverage}, so an
 * empty list is never presented as proof of health.
 */
export function collectClusterFindings(input: ClusterHealthInput): ClusterFinding[] {
    const findings: ClusterFinding[] = [];

    if (input.connectionState === 'disconnected') {
        findings.push({
            id: 'disconnected',
            severity: 'critical',
            title: l10n.t('Cluster is not responding'),
            evidence: l10n.t(
                'The last {count} health pings failed. Figures on this page are from the last successful read.',
                { count: String(input.consecutiveFailures) },
            ),
            source: l10n.t('Health ping'),
        });
    }

    if (input.clusterInfo?.metadata['topology_readOnly'] === 'true') {
        findings.push({
            id: 'readOnly',
            severity: 'warning',
            title: l10n.t('Connection is read-only'),
            evidence: l10n.t(
                'The server reports this connection as read-only. Creating, changing or deleting data will be rejected. This also happens when the connection is pinned to a secondary.',
            ),
            source: l10n.t('Server'),
        });
    }

    if (input.azure?.enableHa === false) {
        findings.push({
            id: 'noHighAvailability',
            severity: 'warning',
            title: l10n.t('High availability is disabled'),
            evidence: l10n.t(
                'The Azure resource has no standby replica per shard. A node failure makes the cluster unavailable until it recovers.',
            ),
            source: l10n.t('Azure resource'),
        });
    }

    const role = input.azure?.replicaRole;
    if (role !== undefined && role !== '' && role !== 'Primary') {
        findings.push({
            id: 'replica',
            severity: 'informational',
            title: l10n.t('This cluster is a replica'),
            evidence: l10n.t('Azure reports the replication role as {role}.', { role }),
            source: l10n.t('Azure resource'),
        });
    }

    return findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

/**
 * Which sources the health summary could read, and why the others are missing.
 *
 * Shown beside the findings so a reader can tell "nothing is wrong" from "nothing was checked".
 */
export function describeCoverage(input: ClusterHealthInput): CoverageEntry[] {
    const seconds = Math.round(input.refreshIntervalMs / 1000);

    const ping: CoverageEntry =
        input.connectionState === 'disconnected'
            ? {
                  id: 'ping',
                  label: l10n.t('Health ping'),
                  state: 'unavailable',
                  status: l10n.t('No response to the last {count} pings.', {
                      count: String(input.consecutiveFailures),
                  }),
              }
            : input.latestSample === null
              ? {
                    id: 'ping',
                    label: l10n.t('Health ping'),
                    state: 'loading',
                    status: l10n.t('Waiting for the first response.'),
                }
              : {
                    id: 'ping',
                    label: l10n.t('Health ping'),
                    state: 'available',
                    status: l10n.t('Every {seconds} s while this panel is visible.', { seconds: String(seconds) }),
                };

    const server: CoverageEntry =
        input.clusterInfoError !== null
            ? {
                  id: 'server',
                  label: l10n.t('Server metadata'),
                  state: 'unavailable',
                  status: l10n.t('Could not be read: {0}', input.clusterInfoError),
              }
            : input.clusterInfo === null
              ? { id: 'server', label: l10n.t('Server metadata'), state: 'loading', status: l10n.t('Loading…') }
              : input.clusterInfo.metadata['topology_readOnly'] === undefined
                ? {
                      id: 'server',
                      label: l10n.t('Server metadata'),
                      state: 'partial',
                      status: l10n.t('Available; the server did not report whether the connection is writable.'),
                  }
                : {
                      id: 'server',
                      label: l10n.t('Server metadata'),
                      state: 'available',
                      status: l10n.t('Available.'),
                  };

    let storage: CoverageEntry;
    if (input.storageStats === null) {
        storage =
            input.storageError !== null
                ? {
                      id: 'storage',
                      label: l10n.t('Storage statistics'),
                      state: 'unavailable',
                      status: l10n.t('Could not be read: {0}', input.storageError),
                  }
                : { id: 'storage', label: l10n.t('Storage statistics'), state: 'loading', status: l10n.t('Loading…') };
    } else {
        const omitted = input.storageStats.omittedDatabaseCount;
        const unreported = input.storageStats.databases.filter((database) => database.sizeOnDiskBytes === null).length;
        const errors = input.storageStats.errors.length;
        storage =
            omitted > 0 || unreported > 0 || errors > 0
                ? {
                      id: 'storage',
                      label: l10n.t('Storage statistics'),
                      state: 'partial',
                      status: l10n.t(
                          'Partial: {omitted} database(s) not inspected, {unreported} without a reported size, {errors} read error(s). Totals are lower bounds.',
                          { omitted: String(omitted), unreported: String(unreported), errors: String(errors) },
                      ),
                  }
                : {
                      id: 'storage',
                      label: l10n.t('Storage statistics'),
                      state: 'available',
                      status: l10n.t('Available for {count} database(s).', {
                          count: String(input.storageStats.databases.length),
                      }),
                  };
    }

    const azure: CoverageEntry =
        input.azure === undefined
            ? {
                  id: 'azure',
                  label: l10n.t('Azure resource facts'),
                  state: 'notApplicable',
                  status: l10n.t(
                      'Not available for this connection, so high-availability and replica checks did not run.',
                  ),
              }
            : input.azure.enableHa === undefined
              ? {
                    id: 'azure',
                    label: l10n.t('Azure resource facts'),
                    state: 'partial',
                    status: l10n.t('Available; high-availability configuration was not reported.'),
                }
              : {
                    id: 'azure',
                    label: l10n.t('Azure resource facts'),
                    state: 'available',
                    status: l10n.t('Available.'),
                };

    return [ping, server, storage, azure];
}

/** How many of the checks behind {@link collectClusterFindings} had the input they need. */
export function countRunChecks(input: ClusterHealthInput): number {
    let checks = input.latestSample !== null || input.connectionState === 'disconnected' ? 1 : 0;

    if (input.clusterInfo?.metadata['topology_readOnly'] !== undefined) {
        checks++;
    }
    if (input.azure?.enableHa !== undefined) {
        checks++;
    }
    if (input.azure?.replicaRole !== undefined && input.azure.replicaRole !== '') {
        checks++;
    }

    return checks;
}
