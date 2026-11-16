/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DockerReadyReadiness, type StageFacts } from '../../../services/localQuickStart/quickStartTypes';
import { buildDockerDetailRows, buildStageDetailRows, buildStageSummary } from './stageDetailsPresentation';

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
    ] as const)('shows selected CLI and provider for %s', (_name, cli, engine, provider, expected) => {
        const rows = buildDockerDetailRows({ ...ready, cli, engine, provider });
        expect(rows.find((row) => row.label === 'Provider')).toMatchObject({ value: expected });
        expect(rows.find((row) => row.label === (cli === 'docker' ? 'Docker CLI' : 'Podman CLI'))).toMatchObject({
            value: 'Found, version 27.3.1',
        });
        expect(rows.find((row) => row.label === 'Engine')).toMatchObject({ value: 'Reachable' });
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
        expect(rows.find((row) => row.label === 'Endpoint')?.note).toBeUndefined();
        expect(rows.find((row) => row.label === 'Check run')?.note).toBeUndefined();
    });

    it('includes the failure and only established optional evidence', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            cli: 'docker',
            canContinueAnyway: false,
            daemonReachable: false,
            permissionDetail: 'notInGroup',
            diagnosticFingerprint: 'abc123',
        });
        expect(rows.find((row) => row.label === 'Detected problem')?.value).toBe('Docker access denied');
        expect(rows.find((row) => row.label === 'Socket access')?.value).toContain('not a member');
        expect(rows.find((row) => row.label === 'Diagnostic reference')).toEqual({
            label: 'Diagnostic reference',
            value: 'abc123',
        });
        expect(rows.every((row) => row.note === undefined)).toBe(true);
    });

    it.each([
        [
            'docker',
            { docker: true, podman: true },
            'Docker CLI',
            'Found, version 27.3.1',
            'Podman CLI',
            'Found on PATH, not checked',
        ],
        ['podman', { docker: false, podman: true }, 'Podman CLI', 'Found, version 27.3.1', 'Docker CLI', 'Not found'],
    ] as const)(
        'reports PATH presence without probing the unselected CLI (%s)',
        (cli, cliOnPath, selected, version, other, presence) => {
            const rows = buildDockerDetailRows({ ...ready, cli, cliOnPath });
            expect(rows.find((row) => row.label === selected)?.value).toBe(version);
            expect(rows.find((row) => row.label === other)?.value).toBe(presence);
            expect(rows.every((row) => row.note === undefined)).toBe(true);
        },
    );

    it('does not infer unselected CLI presence or a selected CLI name', () => {
        const rows = buildDockerDetailRows(ready);
        expect(rows.find((row) => row.label === 'Container CLI')?.value).toBe('Found, version 27.3.1');
        expect(rows.some((row) => row.label === 'Docker CLI' || row.label === 'Podman CLI')).toBe(false);
    });

    it('does not create preferred-engine evidence when the check did not establish it', () => {
        const rows = buildDockerDetailRows({ ...ready, cli: 'podman', cliOnPath: { docker: false, podman: true } });

        expect(rows.some((row) => row.label === 'Preferred engine')).toBe(false);
    });

    it.each([
        ['docker', 'docker', false, 'Docker'],
        ['podman', 'podman', false, 'Podman'],
        ['docker', 'podman', true, 'Docker · not found, used Podman'],
        ['podman', 'docker', true, 'Podman · not found, used Docker'],
        ['docker', 'podman', undefined, 'Docker'],
        ['podman', 'docker', false, 'Podman'],
    ] as const)(
        'shows preferred %s next to the selected %s CLI using fallback evidence %s',
        (preferredEngine, cli, cliFallback, expected) => {
            const rows = buildDockerDetailRows({ ...ready, preferredEngine, cli, cliFallback });
            const index = rows.findIndex((row) => row.label === 'Preferred engine');

            expect(rows[index]).toEqual({ label: 'Preferred engine', value: expected });
            expect(rows[index + 1]?.label).toBe(cli === 'docker' ? 'Docker CLI' : 'Podman CLI');
        },
    );

    it.each(['docker', 'podman'] as const)(
        'shows the preferred %s without claiming fallback when neither CLI exists',
        (cli) => {
            const rows = buildDockerDetailRows({
                ...ready,
                outcome: 'diagnosed',
                failureKind: 'cliMissing',
                cliInstalled: false,
                daemonReachable: false,
                preferredEngine: cli,
                cli,
                cliFallback: false,
                cliOnPath: { docker: false, podman: false },
            });

            expect(rows.find((row) => row.label === 'Preferred engine')).toEqual({
                label: 'Preferred engine',
                value: cli === 'docker' ? 'Docker' : 'Podman',
            });
        },
    );

    it('names the fallback CLI rather than an engine detected behind it', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            preferredEngine: 'podman',
            cli: 'docker',
            cliFallback: true,
            engine: 'podman',
            provider: 'podman',
        });

        expect(rows.find((row) => row.label === 'Preferred engine')?.value).toBe('Podman · not found, used Docker');
    });

    it('shows both CLI paths absent when discovery established neither', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            outcome: 'diagnosed',
            failureKind: 'cliMissing',
            daemonReachable: false,
            cliInstalled: false,
            cliOnPath: { docker: false, podman: false },
            provider: 'unknown',
            endpointKind: 'unknown',
        });
        expect(rows.find((row) => row.label === 'Docker CLI')?.value).toBe('Not found');
        expect(rows.find((row) => row.label === 'Podman CLI')?.value).toBe('Not found');
        expect(rows.some((row) => row.label === 'Container CLI')).toBe(false);
        expect(rows.some((row) => row.label === 'Engine' || row.label === 'Provider' || row.label === 'Endpoint')).toBe(
            false,
        );
    });

    it('does not attribute a Podman check failure to Docker', () => {
        const rows = buildDockerDetailRows({
            ...ready,
            cli: 'podman',
            engine: 'podman',
            outcome: 'diagnosed',
            failureKind: 'daemonUnavailable',
            daemonReachable: false,
        });
        expect(rows.find((row) => row.label === 'Detected problem')?.value).toBe('Engine unavailable');
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

describe('buildStageSummary', () => {
    it.each([
        ['reusedPinned', 'Reused the saved image. No download needed.'],
        ['downloadedPinned', 'Downloaded the exact saved image.'],
        ['reusedTag', 'Used the local image without downloading.'],
    ] as const)(
        'reports %s in the settled summary and Details without an up-to-date claim',
        (disposition, expected) => {
            const facts: StageFacts = {
                kind: 'pulling',
                imageRef: 'official:saved',
                imageOrigin: 'reused',
                disposition,
                result: 'upToDate',
            };
            expect(buildStageSummary(facts, 'done')).toBe(expected);
            expect(buildStageDetailRows(facts).find((row) => row.label === 'Result')?.value).toBe(expected);
            expect(buildStageSummary(facts, 'active')).toBe('Image official:saved · Kept from existing data');
        },
    );

    it('omits absent facts', () => {
        for (const status of ['active', 'done', 'error'] as const) {
            expect(buildStageSummary(undefined, status)).toBeUndefined();
        }
    });

    it.each(['active', 'done', 'error'] as const)('reports checked port facts for %s', (status) => {
        expect(buildStageSummary({ kind: 'checking', port: 10273, portFree: true }, status)).toBe('Port 10273 free');
        expect(buildStageSummary({ kind: 'checking', port: 10273, portFree: false }, status)).toBe('Port 10273 in use');
    });

    it.each(['default', 'custom', 'reused'] as const)(
        'summarizes pulling %s without premature success',
        (imageOrigin) => {
            const facts = { kind: 'pulling', imageRef: 'image:tag', imageOrigin, result: 'updated' } as const;
            const suffix =
                imageOrigin === 'custom'
                    ? ' · Custom tag'
                    : imageOrigin === 'reused'
                      ? ' · Kept from existing data'
                      : '';
            expect(buildStageSummary(facts, 'active')).toBe(`Image image:tag${suffix}`);
            expect(buildStageSummary(facts, 'error')).toBe('Image image:tag');
            expect(buildStageSummary(facts, 'done')).toBe('Updated');
            expect(buildStageSummary({ ...facts, result: undefined }, 'done')).toBe('Image image:tag');
        },
    );

    it.each([
        ['downloaded', 'Downloaded'],
        ['updated', 'Updated'],
        ['upToDate', 'Already up to date'],
    ] as const)('summarizes pull result %s', (result, expected) => {
        expect(buildStageSummary({ kind: 'pulling', imageRef: 'image', imageOrigin: 'default', result }, 'done')).toBe(
            expected,
        );
    });

    it.each(['active', 'done', 'error'] as const)('summarizes creating for %s', (status) => {
        expect(
            buildStageSummary(
                {
                    kind: 'creating',
                    containerName: 'local',
                    hostPort: 1,
                    containerPort: 2,
                    volumeName: 'volume',
                    dataPath: '/data',
                    username: 'user',
                },
                status,
            ),
        ).toBe('Container local');
    });

    it.each(['active', 'done', 'error'] as const)(
        'summarizes starting for %s without unsupported running claims',
        (status) => {
            const facts = { kind: 'starting', boundPort: 10273, boundPortReported: false, running: true } as const;
            expect(buildStageSummary(facts, status)).toBe(status === 'done' ? 'Running on port 10273' : 'Port 10273');
            expect(buildStageSummary({ ...facts, running: false }, status)).toBe('Port 10273');
            expect(buildStageSummary({ ...facts, running: undefined }, status)).toBe('Port 10273');
        },
    );

    it('summarizes waiting according to status and established evidence', () => {
        const facts = { kind: 'waiting', port: 10273 } as const;
        expect(buildStageSummary(facts, 'active')).toBe('Endpoint localhost:10273');
        expect(buildStageSummary(facts, 'done')).toBe('Endpoint localhost:10273');
        expect(buildStageSummary({ ...facts, sampleData: 'loaded' }, 'done')).toBe(
            'Accepting connections on localhost:10273',
        );
        expect(buildStageSummary({ ...facts, sampleData: 'loaded' }, 'active')).toBe('Endpoint localhost:10273');
        expect(buildStageSummary({ ...facts, sampleData: 'loaded', attempts: 2, exitCode: 0 }, 'error')).toBe(
            'Exit code 0',
        );
        expect(buildStageSummary({ ...facts, attempts: 1 }, 'error')).toBe('1 attempt');
        expect(buildStageSummary({ ...facts, attempts: 2 }, 'error')).toBe('2 attempts');
        expect(buildStageSummary(facts, 'error')).toBe('Endpoint localhost:10273');
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

    it('does not mark ordinary facts as code in any stage or engine diagnostics', () => {
        const stages: StageFacts[] = [
            { kind: 'checking', port: 10273, portFree: true, removedContainerId: 'old-id' },
            {
                kind: 'pulling',
                imageRef: 'image:tag',
                imageOrigin: 'custom',
                imageId: 'sha256:01234567890123456789',
                digest: 'sha256:digest',
                imageVersion: '1',
            },
            { ...creating, containerId: '123456789012345678' },
            { kind: 'starting', boundPort: 10273, boundPortReported: false },
            { kind: 'waiting', port: 10273, lastProbeError: 'error', exitCode: 1, lastLogLine: 'line' },
        ];
        const rows = [
            ...stages.flatMap(buildStageDetailRows),
            ...buildDockerDetailRows({ ...ready, diagnosticFingerprint: 'abc123' }),
        ];
        expect(rows.every((row) => !('code' in row))).toBe(true);
    });

    it('omits empty evidence and unknown readiness facts', () => {
        expect(buildStageDetailRows(undefined)).toEqual([]);
        expect(buildStageDetailRows({ kind: 'waiting', port: 10273 })).toEqual([
            {
                label: 'Endpoint',
                value: 'localhost:10273',
                note: 'TLS (self-signed certificate accepted)',
            },
        ]);
    });

    it('shows established readiness and saved-connection evidence without copying credentials', () => {
        const rows = buildStageDetailRows({
            kind: 'waiting',
            port: 10333,
            attempts: 7,
            documentdbVersions: ['0.116.0', '0.115.0'],
            maxWireVersion: 21,
            sampleData: 'loaded',
            displayName: 'DocumentDB Local',
            ...{
                password: 'private-password',
                connectionString: 'mongodb://private-uri',
                environmentVariables: ['private-env'],
            },
        });
        expect(rows.find((row) => row.label === 'Probe')?.value).toBe('Ping on admin answered after 7 attempts');
        expect(rows.find((row) => row.label === 'Server')?.value).toBe(
            'DocumentDB 0.116.0, 0.115.0 · MongoDB API 7.0 (wire 21)',
        );
        expect(rows.find((row) => row.label === 'Saved as')).toEqual({
            label: 'Saved as',
            value: '“DocumentDB Local” in the Connections view',
            note: 'Credentials in VS Code secret storage',
        });
        for (const secret of ['private-password', 'mongodb://', 'private-env']) {
            expect(JSON.stringify(rows)).not.toContain(secret);
        }
    });

    it('does not describe wire compatibility as a DocumentDB product version', () => {
        const rows = buildStageDetailRows({ kind: 'waiting', port: 10260, maxWireVersion: 21 });
        expect(rows.find((row) => row.label === 'Server')?.value).toBe('MongoDB API 7.0 (wire 21)');
    });

    it('uses the singular for a successful first probe', () => {
        const rows = buildStageDetailRows({ kind: 'waiting', port: 10260, attempts: 1, sampleData: 'loaded' });
        expect(rows.find((row) => row.label === 'Probe')?.value).toBe('Ping on admin answered after 1 attempt');
    });

    it('uses the singular for one unsuccessful probe', () => {
        const rows = buildStageDetailRows({ kind: 'waiting', port: 10260, attempts: 1, lastProbeError: 'not ready' });
        expect(rows.find((row) => row.label === 'Probe')?.value).toBe('1 attempt');
    });

    it.each([
        ['loaded', 'Loaded'],
        ['notRequested', 'Not requested'],
        ['keptExisting', 'Not loaded, existing data kept'],
        ['failed', 'Not loaded'],
    ] as const)('shows sample-data outcome %s and a finding only for failed loading', (sampleData, value) => {
        const rows = buildStageDetailRows({ kind: 'waiting', port: 10260, sampleData });
        expect(rows.find((row) => row.label === 'Sample data')?.value).toBe(value);
        expect(rows.filter((row) => row.message)).toEqual(
            sampleData === 'failed'
                ? [
                      {
                          label: 'Sample data was not loaded',
                          value: 'The instance is ready to use without sample data.',
                          message: 'info',
                          action: 'showOutput',
                      },
                  ]
                : [],
        );
    });

    it('shows failure evidence without claiming a successful ping or saved credentials', () => {
        const rows = buildStageDetailRows({
            kind: 'waiting',
            port: 10273,
            attempts: 2,
            lastProbeError: 'masked ***',
            exitCode: 0,
            lastLogLine: 'fatal ***',
        });
        expect(rows.find((row) => row.label === 'Probe')?.value).toBe('2 attempts');
        expect(rows.find((row) => row.label === 'Last probe error')?.value).toBe('masked ***');
        expect(rows.find((row) => row.label === 'Exit code')?.value).toBe('0');
        expect(rows.find((row) => row.label === 'Last log line')?.value).toBe('fatal ***');
        expect(
            rows.some((row) => row.label === 'Server' || row.label === 'Saved as' || row.label === 'Sample data'),
        ).toBe(false);
    });

    it.each([true, false])('shows only a probed port and a confirmed removal (portFree=%s)', (portFree) => {
        const rows = buildStageDetailRows({ kind: 'checking', port: 10273, portFree });
        expect(rows).toEqual([
            {
                label: 'Port',
                value: '10273',
            },
            { label: 'Port status', value: portFree ? 'Free on 127.0.0.1' : 'In use on 127.0.0.1' },
        ]);
        const removed = buildStageDetailRows({ kind: 'checking', port: 10273, portFree, removedContainerId: 'old-id' });
        expect(removed[2]).toMatchObject({ label: 'Removed container', value: 'old-id' });
        expect(removed.every((row) => row.note === undefined)).toBe(true);
    });

    it.each([
        ['default', undefined],
        ['custom', 'Custom tag'],
        ['reused', 'Kept from existing data'],
    ] as const)('shows %s image origin and omits unestablished image evidence', (imageOrigin, note) => {
        expect(buildStageDetailRows({ kind: 'pulling', imageRef: 'official:tag', imageOrigin })).toEqual([
            {
                label: 'Image',
                value: 'official:tag',
                note,
            },
        ]);
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
            { label: 'Image', value: 'official:tag', note: undefined },
            { label: 'Result', value: expected },
            { label: 'Image ID', value: 'sha256:012345678901…', fullValue: 'sha256:01234567890123456789' },
            { label: 'Digest', value: 'sha256:digest' },
            { label: 'Image version', value: '0.116.0' },
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
            ...{
                password: 'password-secret',
                environmentVariables: { PASSWORD: 'env-secret' },
                connectionString: 'connection-secret',
            },
        });
        expect(rows.find((row) => row.label === 'Data volume')).toMatchObject({
            value: 'local-instance-data at /data',
            note: expected,
        });
        expect(rows.find((row) => row.label === 'Port mapping')).toMatchObject({
            value: 'localhost:10273 → 10260',
        });
        expect(rows.find((row) => row.label === 'User')).toMatchObject({ value: 'docuser' });
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
            note: undefined,
        });
    });

    it('includes only an established container ID, shortened for display', () => {
        const rows = buildStageDetailRows({ ...creating, containerId: '123456789012345678' });
        expect(rows.find((row) => row.label === 'Container')).toEqual({
            label: 'Container',
            value: 'local-instance',
        });
        expect(rows.find((row) => row.label === 'Container ID')).toEqual({
            label: 'Container ID',
            value: '123456789012…',
            fullValue: '123456789012345678',
        });
    });

    it('keeps complete previous IDs only for updated images and omits fullValue for short IDs', () => {
        const base = {
            kind: 'pulling',
            imageRef: 'image',
            imageOrigin: 'default',
            previousImageId: 'sha256:12345678901234567890',
            imageId: 'short',
        } as const;
        const rows = buildStageDetailRows({ ...base, result: 'updated' });
        expect(rows.find((row) => row.label === 'Image ID')).toEqual({ label: 'Image ID', value: 'short' });
        expect(rows.find((row) => row.label === 'Previous image ID')).toEqual({
            label: 'Previous image ID',
            value: 'sha256:123456789012…',
            fullValue: base.previousImageId,
        });
        expect(
            buildStageDetailRows({ ...base, result: 'downloaded' }).some((row) => row.label === 'Previous image ID'),
        ).toBe(false);
    });

    it('omits unknown starting state and time, and identifies the requested port fallback', () => {
        expect(buildStageDetailRows({ kind: 'starting', boundPort: 10273, boundPortReported: false })).toEqual([
            { label: 'Bound port', value: '10273', qualification: 'As requested' },
            { label: 'Logs', value: 'Streaming to the setup log', action: 'showOutput' },
        ]);
    });

    it.each([true, false])('shows the inspected running state (%s), time and reported port', (running) => {
        const startedAtMs = Date.UTC(2026, 9, 28, 10, 42, 17);
        const rows = buildStageDetailRows({
            kind: 'starting',
            running,
            startedAtMs,
            boundPort: 10273,
            boundPortReported: true,
        });
        expect(rows[0]).toEqual({ label: 'State', value: running ? 'Running' : 'Not running' });
        expect(rows[1]).toEqual({ label: 'Started', value: new Date(startedAtMs).toLocaleTimeString() });
        expect(rows[2]).toEqual({ label: 'Bound port', value: '10273', qualification: undefined });
        expect(JSON.stringify(rows)).not.toContain('duration');
    });
});
