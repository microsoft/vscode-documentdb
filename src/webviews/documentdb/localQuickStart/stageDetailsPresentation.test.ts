/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type DockerReadyReadiness } from '../../../services/localQuickStart/quickStartTypes';
import { buildDockerDetailRows } from './stageDetailsPresentation';

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
