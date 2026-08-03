/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import {
    classifyDockerFailure,
    classifyDockerProvider,
    getDockerDiagnosticFingerprint,
} from './dockerReadinessClassification';
import {
    type DockerEndpointProbe,
    type DockerHostEnvironment,
    type DockerProbeEvidence,
} from './quickStartTypes';

function readFixture(name: string): string {
    return fs.readFileSync(path.join(__dirname, '__fixtures__', 'docker', name), 'utf8');
}

describe('classifyDockerFailure', () => {
    it('classifies the reported Ubuntu socket EACCES as permission denied', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: readFixture('ubuntu-version-unknown-permission-denied.txt'),
            endedBy: 'exit',
            durationMs: 12,
        };
        const endpointProbe: DockerEndpointProbe = {
            kind: 'unixSocket',
            accessErrorCode: 'EACCES',
            source: 'platformDefault',
        };

        expect(classifyDockerFailure({ infoProbe, endpointProbe })).toEqual({
            failureKind: 'permissionDenied',
            outcome: 'diagnosed',
        });
    });

    it.each([
        ['missing local socket', 'ENOENT'],
        ['refused local socket', 'ECONNREFUSED'],
    ])('classifies %s as an unavailable daemon', (_name, accessErrorCode) => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 8,
        };
        const endpointProbe: DockerEndpointProbe = {
            kind: 'unixSocket',
            accessErrorCode,
            source: 'platformDefault',
        };

        expect(classifyDockerFailure({ infoProbe, endpointProbe })).toEqual({
            failureKind: 'daemonUnavailable',
            outcome: 'diagnosed',
        });
    });

    it('uses a structured permission error when the endpoint errno is unavailable', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 10,
        };

        expect(
            classifyDockerFailure({ infoProbe, serverErrors: ['permission denied opening Docker endpoint'] }),
        ).toEqual({
            failureKind: 'permissionDenied',
            outcome: 'diagnosed',
        });
    });

    it.each([
        {
            name: 'missing CLI',
            probe: { spawnErrorCode: 'ENOENT', endedBy: 'exit' } as const,
            expected: { failureKind: 'cliMissing', outcome: 'diagnosed' },
        },
        {
            name: 'deadline expiry',
            probe: { endedBy: 'deadline' } as const,
            expected: { failureKind: 'probeTimedOut', outcome: 'indeterminate' },
        },
        {
            name: 'unrecognized failure',
            probe: { endedBy: 'exit' } as const,
            expected: { failureKind: 'unknown', outcome: 'indeterminate' },
        },
    ])('classifies $name', ({ probe, expected }) => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: 'unrecognized Docker error',
            durationMs: 5,
            ...probe,
        };

        expect(classifyDockerFailure({ infoProbe })).toEqual(expected);
    });

    it.each([
        {
            name: 'missing named context',
            evidence: { contextUnavailable: true },
            expected: { failureKind: 'contextUnavailable', outcome: 'diagnosed' },
        },
        {
            name: 'remote TCP endpoint',
            evidence: {
                endpointProbe: { kind: 'tcp', source: 'dockerHostEnv' },
            },
            expected: { failureKind: 'endpointUnreachable', outcome: 'diagnosed' },
        },
        {
            name: 'remote SSH endpoint',
            evidence: {
                endpointProbe: { kind: 'ssh', source: 'currentContext' },
            },
            expected: { failureKind: 'endpointUnreachable', outcome: 'diagnosed' },
        },
        {
            name: 'provider launch in progress',
            evidence: {
                providerMayBeStarting: true,
                endpointProbe: { kind: 'tcp', source: 'dockerHostEnv' },
            },
            expected: { failureKind: 'daemonStarting', outcome: 'diagnosed' },
        },
    ] as const)('classifies $name', ({ evidence: additionalEvidence, expected }) => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 5,
        };

        expect(classifyDockerFailure({ infoProbe, ...additionalEvidence })).toEqual(expected);
    });

    it('preserves local permission evidence over provider-start evidence', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 5,
        };

        expect(
            classifyDockerFailure({
                infoProbe,
                endpointProbe: { kind: 'unixSocket', source: 'platformDefault', accessErrorCode: 'EACCES' },
                providerMayBeStarting: true,
            }),
        ).toEqual({ failureKind: 'permissionDenied', outcome: 'diagnosed' });
    });

    it('returns the total unknown fallback if unexpected evidence throws', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 5,
        };

        expect(
            classifyDockerFailure({
                infoProbe,
                serverErrors: null as unknown as ReadonlyArray<string>,
            }),
        ).toEqual({ failureKind: 'unknown', outcome: 'indeterminate' });
    });
});

describe('classifyDockerProvider', () => {
    it.each([
        {
            name: 'live Docker Desktop daemon',
            evidence: { environment: 'macos', daemonReachable: true, daemonOperatingSystem: 'Docker Desktop' },
            expected: { provider: 'dockerDesktop', providerEvidence: 'liveDaemon' },
        },
        {
            name: 'live native Linux daemon',
            evidence: { environment: 'linux', daemonReachable: true, daemonOperatingSystem: 'Ubuntu 24.04' },
            expected: { provider: 'dockerEngine', providerEvidence: 'liveDaemon' },
        },
        {
            name: 'live daemon without provider metadata',
            evidence: { environment: 'linux', daemonReachable: true },
            expected: { provider: 'unknown', providerEvidence: 'liveDaemon' },
        },
        {
            name: 'Desktop context',
            evidence: {
                environment: 'windows',
                daemonReachable: false,
                contexts: [{ name: 'desktop-linux', current: true }],
            },
            expected: { provider: 'dockerDesktop', providerEvidence: 'activeContext' },
        },
        {
            name: 'rootless Engine endpoint',
            evidence: {
                environment: 'linux',
                daemonReachable: false,
                activeEndpoint: { kind: 'unixSocket', address: 'unix:///run/user/1000/docker.sock' },
            },
            expected: { provider: 'dockerEngine', providerEvidence: 'activeContext' },
        },
        {
            name: 'remembered Desktop',
            evidence: {
                environment: 'windows',
                daemonReachable: false,
                rememberedProvider: {
                    provider: 'dockerDesktop',
                    endpointKind: 'namedPipe',
                    hostEnvironment: 'windows',
                    recordedAtMs: 1,
                },
            },
            expected: { provider: 'dockerDesktop', providerEvidence: 'rememberedProvider' },
        },
        {
            name: 'installed Desktop on local Windows',
            evidence: { environment: 'windows', daemonReachable: false, dockerDesktopInstalled: true },
            expected: { provider: 'dockerDesktop', providerEvidence: 'installedApplication' },
        },
        {
            name: 'installed Desktop beside native WSL socket',
            evidence: {
                environment: 'wsl',
                daemonReachable: false,
                dockerDesktopInstalled: true,
                activeEndpoint: { kind: 'unixSocket', address: 'unix:///var/run/docker.sock' },
            },
            expected: { provider: 'unknown', providerEvidence: 'none' },
        },
        {
            name: 'installed Desktop in remote extension host',
            evidence: { environment: 'ssh', daemonReachable: false, dockerDesktopInstalled: true },
            expected: { provider: 'unknown', providerEvidence: 'none' },
        },
    ] as const)('classifies $name', ({ evidence, expected }) => {
        expect(
            classifyDockerProvider({
                ...evidence,
                environment: evidence.environment as DockerHostEnvironment,
            }),
        ).toEqual(expected);
    });

    it('prefers live daemon evidence over remembered provider evidence', () => {
        expect(
            classifyDockerProvider({
                environment: 'linux',
                daemonReachable: true,
                daemonOperatingSystem: 'Ubuntu 24.04',
                rememberedProvider: {
                    provider: 'dockerDesktop',
                    endpointKind: 'unixSocket',
                    hostEnvironment: 'linux',
                    recordedAtMs: 1,
                },
            }),
        ).toEqual({ provider: 'dockerEngine', providerEvidence: 'liveDaemon' });
    });
});

describe('getDockerDiagnosticFingerprint', () => {
    it('removes endpoint, path, context, host, hex, and numeric differences before hashing', () => {
        const first = getDockerDiagnosticFingerprint([
            'Context "private-one" failed at tcp://secret.example.com:2375 /home/alice/.docker/config id deadbeef1234 code 42',
        ]);
        const second = getDockerDiagnosticFingerprint([
            'Context "private-two" failed at tcp://other.internal.net:9922 /users/bob/.docker/config id abcdef987654 code 99',
        ]);

        expect(first).toBeDefined();
        expect(first).toBe(second);
        expect(first).not.toContain('secret');
    });

    it('returns undefined when no diagnostic text exists', () => {
        expect(getDockerDiagnosticFingerprint(['', '   '])).toBeUndefined();
    });
});
