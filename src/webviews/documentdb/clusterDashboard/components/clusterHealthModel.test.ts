/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { type ClusterDashboardInfo } from '../clusterDashboardRouter';
import {
    collectClusterFindings,
    countRunChecks,
    describeCoverage,
    type ClusterHealthInput,
} from './clusterHealthModel';

const clusterInfo = (metadata: Record<string, string | undefined>): ClusterDashboardInfo =>
    ({ clusterDisplayName: 'c', hosts: ['h:10260'], metadata }) as unknown as ClusterDashboardInfo;

const storage = (overrides: Partial<ClusterStorageStats> = {}): ClusterStorageStats =>
    ({ databases: [], omittedDatabaseCount: 0, errors: [], totalSizeBytes: 0, ...overrides }) as ClusterStorageStats;

const base = (overrides: Partial<ClusterHealthInput> = {}): ClusterHealthInput => ({
    connectionState: 'connected',
    consecutiveFailures: 0,
    latestSample: { pingLatencyMs: 12, uptimeSeconds: 60 } as ClusterHealthInput['latestSample'],
    refreshIntervalMs: 5000,
    clusterInfo: clusterInfo({ topology_readOnly: 'false' }),
    clusterInfoError: null,
    storageStats: storage(),
    storageError: null,
    ...overrides,
});

describe('clusterHealthModel', () => {
    it('reports no findings for a healthy writable connection', () => {
        expect(collectClusterFindings(base())).toEqual([]);
        expect(countRunChecks(base())).toBe(2);
    });

    it('orders findings by severity', () => {
        const findings = collectClusterFindings(
            base({
                connectionState: 'disconnected',
                consecutiveFailures: 3,
                clusterInfo: clusterInfo({ topology_readOnly: 'true' }),
                azure: { enableHa: false, replicaRole: 'GeoAsyncReplica' },
            }),
        );

        expect(findings.map((finding) => finding.id)).toEqual([
            'disconnected',
            'readOnly',
            'noHighAvailability',
            'replica',
        ]);
    });

    it('does not treat a primary replica role as a finding', () => {
        expect(collectClusterFindings(base({ azure: { enableHa: true, replicaRole: 'Primary' } }))).toEqual([]);
    });

    it('marks the Azure checks as not run for a non-Azure connection', () => {
        const azure = describeCoverage(base()).find((entry) => entry.id === 'azure');
        expect(azure?.state).toBe('notApplicable');
    });

    it('reports partial storage coverage instead of a complete total', () => {
        const coverage = describeCoverage(
            base({
                storageStats: storage({
                    omittedDatabaseCount: 2,
                    databases: [{ name: 'a', sizeOnDiskBytes: null } as ClusterStorageStats['databases'][number]],
                }),
            }),
        );

        expect(coverage.find((entry) => entry.id === 'storage')?.state).toBe('partial');
    });

    it('distinguishes a failed storage read from one still loading', () => {
        const failed = describeCoverage(base({ storageStats: null, storageError: 'boom' }));
        const loading = describeCoverage(base({ storageStats: null }));

        expect(failed.find((entry) => entry.id === 'storage')?.state).toBe('unavailable');
        expect(loading.find((entry) => entry.id === 'storage')?.state).toBe('loading');
    });
});
