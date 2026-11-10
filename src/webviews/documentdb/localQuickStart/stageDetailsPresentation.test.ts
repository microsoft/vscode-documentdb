/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DockerReadyReadiness, type StageFacts } from '../../../services/localQuickStart/quickStartTypes';
import { buildDockerDetailRows, buildStageDetailRows } from './stageDetailsPresentation';

const ready: DockerReadyReadiness = {
    outcome: 'ready',
    environment: 'linux',
    endpointKind: 'unixSocket',
    endpointSource: 'platformDefault',
    provider: 'dockerEngine',
    providerEvidence: 'liveDaemon',
    executionTarget: 'local',
    canContinueAnyway: false,
    checkedAtMs: 1_700_000_000_000,
    cliInstalled: true,
    cliVersion: '27.3.1',
    daemonReachable: true,
    osType: 'linux',
    daemonArchitecture: 'arm64',
};

describe('buildDockerDetailRows', () => {
    it.each([
        ['Docker', 'docker', 'docker', 'dockerEngine', 'Docker Engine'],
        ['Podman', 'podman', 'podman', 'podman', 'Podman'],
        ['Docker CLI through Podman', 'docker', 'podman', 'podman', 'Podman'],
    ] as const)('preserves current check wording for %s', (_name, cli, engine, provider, expected) => {
        const rows = buildDockerDetailRows({ ...ready, cli, engine, provider });
        expect(rows.find((row) => row.label === 'Provider')).toMatchObject({ value: expected });
        expect(rows.find((row) => row.label === 'Docker CLI')).toMatchObject({ value: 'Found, version 27.3.1' });
        expect(rows.find((row) => row.label === 'Docker daemon')).toMatchObject({ value: 'Reachable' });
        expect(rows.find((row) => row.label === 'Containers run on')).toMatchObject({ value: 'Linux arm64' });
        expect(rows.find((row) => row.label === 'Check run')).toMatchObject({
            value: new Date(ready.checkedAtMs).toLocaleString(),
        });
    });

    it('omits optional evidence that was not established', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            endpointSource: undefined,
            permissionDetail: undefined,
            osType: undefined,
            daemonArchitecture: undefined,
            diagnosticFingerprint: undefined,
        });
        expect(rows.some((row) => row.label === 'Socket access' || row.label === 'Containers run on')).toBe(false);
        expect(rows.find((row) => row.label === 'Docker endpoint')?.note).toBeUndefined();
        expect(rows.find((row) => row.label === 'Check run')?.note).toBeUndefined();
    });

    it('includes the failure and only established optional evidence', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            canContinueAnyway: false,
            daemonReachable: false,
            permissionDetail: 'notInGroup',
            diagnosticFingerprint: 'abc123',
        });
        expect(rows.find((row) => row.label === 'Detected problem')?.value).toBe('Docker access denied');
        expect(rows.find((row) => row.label === 'Socket access')?.value).toContain('not a member');
        expect(rows.find((row) => row.label === 'Check run')?.note).toContain('abc123');
    });

    it('does not copy credentials, connection strings or environment data to the view model', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            recoveryCommand: { id: 'linuxDockerGroup', commandLine: 'password-secret', requiresElevation: true },
            ...{ connectionString: 'connection-secret', environmentVariables: ['env-secret'] },
        });
        const result = JSON.stringify(rows);
        expect(result).not.toContain('password-secret');
        expect(result).not.toContain('connection-secret');
        expect(result).not.toContain('env-secret');
    });
});

describe('buildStageDetailRows', () => {
    const creating: StageFacts = {
        kind: 'creating',
        containerName: 'local-instance',
        hostPort: 10273,
        containerPort: 10260,
        volumeName: 'local-instance-data',
        dataPath: '/data',
        volume: 'new',
        username: 'docuser',
    };

    it('does not disclose empty evidence or readiness evidence deferred to P3', () => {
        expect(buildStageDetailRows(undefined)).toEqual([]);
        expect(buildStageDetailRows({ kind: 'waiting', port: 10273 })).toEqual([]);
    });

    it.each([true, false])('shows only a probed port and a confirmed removal (portFree=%s)', (portFree) => {
        const rows = buildStageDetailRows({ kind: 'checking', port: 10273, portFree });
        expect(rows).toEqual([{
            label: 'Port',
            value: '10273',
            code: true,
            note: portFree ? 'Free on 127.0.0.1' : 'In use on 127.0.0.1',
        }]);
        const removed = buildStageDetailRows({ kind: 'checking', port: 10273, portFree, removedContainerId: 'old-id' });
        expect(removed[1]).toMatchObject({ label: 'Previous container', value: 'old-id', code: true });
    });

    it.each([
        ['default', undefined],
        ['custom', 'Custom tag'],
        ['reused', 'Kept from existing data'],
    ] as const)('shows %s image origin and omits unestablished image evidence', (imageOrigin, note) => {
        expect(buildStageDetailRows({ kind: 'pulling', imageRef: 'official:tag', imageOrigin })).toEqual([{
            label: 'Image', value: 'official:tag', code: true, note,
        }]);
    });

    it.each([
        ['downloaded', 'Downloaded'],
        ['updated', 'Updated'],
        ['upToDate', 'Already up to date'],
    ] as const)('shows structured image result %s and established metadata', (result, expected) => {
        const createdAtMs = Date.UTC(2026, 9, 28);
        const rows = buildStageDetailRows({
            kind: 'pulling',
            imageRef: 'official:tag',
            imageOrigin: 'default',
            result,
            imageId: 'sha256:01234567890123456789',
            digest: 'sha256:digest',
            imageVersion: '0.116.0',
            createdAtMs,
        });
        expect(rows).toEqual([
            { label: 'Image', value: 'official:tag', code: true, note: undefined },
            { label: 'Result', value: expected },
            { label: 'Image ID', value: 'sha256:012345678901…', code: true },
            { label: 'Digest', value: 'sha256:digest', code: true },
            { label: 'Image version', value: '0.116.0', code: true },
            { label: 'Created', value: new Date(createdAtMs).toLocaleDateString() },
        ]);
    });

    it.each([
        ['new', 'New'],
        ['reused', 'Kept existing data'],
        ['replaced', 'Replaced, Start fresh'],
    ] as const)('shows %s volume and a constant password placeholder', (volume, expected) => {
        const rows = buildStageDetailRows({
            ...creating,
            volume,
            ...{ password: 'password-secret', environmentVariables: { PASSWORD: 'env-secret' }, connectionString: 'connection-secret' },
        });
        expect(rows.find((row) => row.label === 'Data volume')).toMatchObject({ value: 'local-instance-data at /data', note: expected, code: true });
        expect(rows.find((row) => row.label === 'Port mapping')).toMatchObject({ value: 'localhost:10273 → 10260', code: true });
        expect(rows.find((row) => row.label === 'User')).toMatchObject({ value: 'docuser', code: true });
        expect(rows.find((row) => row.label === 'Password')).toEqual({
            label: 'Password',
            value: '(hidden)',
            note: 'Passed in a temporary file, deleted after create',
        });
        expect(rows.find((row) => row.label === 'Container')?.value).toBe('local-instance');
        for (const secret of ['password-secret', 'env-secret', 'connection-secret']) {
            expect(JSON.stringify(rows)).not.toContain(secret);
        }
    });

    it('shows the volume name and path without an unestablished outcome', () => {
        const rows = buildStageDetailRows({ ...creating, volume: undefined });
        expect(rows.find((row) => row.label === 'Data volume')).toEqual({
            label: 'Data volume',
            value: 'local-instance-data at /data',
            code: true,
            note: undefined,
        });
    });

    it('includes only an established container ID, shortened for display', () => {
        const rows = buildStageDetailRows({ ...creating, containerId: '123456789012345678' });
        expect(rows.find((row) => row.label === 'Container')).toEqual({
            label: 'Container',
            value: 'local-instance 123456789012…',
            code: true,
        });
    });

    it('omits unknown starting state and time, and identifies the requested port fallback', () => {
        expect(buildStageDetailRows({ kind: 'starting', boundPort: 10273, boundPortReported: false })).toEqual([
            { label: 'Bound port', value: '10273', code: true, note: 'As requested' },
            { label: 'Logs', value: 'Streaming to the setup log', action: 'showOutput' },
        ]);
    });

    it.each([true, false])('shows the inspected running state (%s), time and reported port', (running) => {
        const startedAtMs = Date.UTC(2026, 9, 28, 10, 42, 17);
        const rows = buildStageDetailRows({ kind: 'starting', running, startedAtMs, boundPort: 10273, boundPortReported: true });
        expect(rows[0]).toEqual({ label: 'State', value: running ? 'Running' : 'Not running' });
        expect(rows[1]).toEqual({ label: 'Started', value: new Date(startedAtMs).toLocaleTimeString() });
        expect(rows[2]).toEqual({ label: 'Bound port', value: '10273', code: true, note: undefined });
        expect(JSON.stringify(rows)).not.toContain('duration');
    });
});
