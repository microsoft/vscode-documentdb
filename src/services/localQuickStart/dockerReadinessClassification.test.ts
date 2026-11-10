/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import * as fs from 'fs';
import * as path from 'path';
import { parseDockerInfoFacts } from './dockerProbes';
import {
    classifyContainerEngine,
    classifyDockerFailure,
    classifyDockerProvider,
    classifyPodmanMachineState,
    getDockerDiagnosticFingerprint,
    parsePodmanDefaultConnection,
    parsePodmanMachineList,
    type ContainerEngineInput,
} from './dockerReadinessClassification';
import { type DockerEndpointProbe, type DockerHostEnvironment, type DockerProbeEvidence } from './quickStartTypes';

describe('Podman machine facts', () => {
    it('parses the strict public JSON fields without altering the machine name', () => {
        expect(
            parsePodmanMachineList(
                '[{"Name":"custom machine","Default":true,"Running":false,"Starting":false,"VMType":"qemu"}]',
            ),
        ).toEqual([{ name: 'custom machine', isDefault: true, running: false, starting: false }]);
        expect(parsePodmanMachineList('[]')).toEqual([]);
    });

    it.each([
        'not json',
        'null',
        '{}',
        '[null]',
        '[true]',
        '[[]]',
        '[{"Name":"","Default":true,"Running":false,"Starting":false}]',
        '[{"Name":"   ","Default":true,"Running":false,"Starting":false}]',
        '[{"Name":1,"Default":true,"Running":false,"Starting":false}]',
        '[{"Name":"vm","Default":"true","Running":false,"Starting":false}]',
        '[{"Name":"vm","Default":true,"Running":0,"Starting":false}]',
        '[{"Name":"vm","Default":true,"Running":false,"Starting":null}]',
        '[{"Name":"vm","Running":false,"Starting":false}]',
        '[{"Name":"vm","Default":true,"Running":false}]',
    ])('rejects unknown machine facts: %s', (output) => {
        expect(parsePodmanMachineList(output)).toBeUndefined();
    });

    const stopped = { name: 'custom-vm', isDefault: false, running: false, starting: false };
    it.each([
        { machines: [], expected: { kind: 'none' } },
        { machines: [stopped], expected: { kind: 'stopped', name: 'custom-vm' } },
        {
            machines: [stopped, { ...stopped, name: 'default-vm', isDefault: true }],
            expected: { kind: 'stopped', name: 'default-vm' },
        },
        {
            machines: [stopped, { ...stopped, name: 'other' }],
            expected: { kind: 'ambiguous', names: ['custom-vm', 'other'] },
        },
        {
            machines: [{ ...stopped, starting: true, running: true }],
            expected: { kind: 'starting', name: 'custom-vm' },
        },
        { machines: [{ ...stopped, running: true }], expected: { kind: 'running', name: 'custom-vm' } },
        {
            machines: [
                { ...stopped, isDefault: true },
                { ...stopped, name: 'busy', running: true },
            ],
            expected: { kind: 'otherActive', active: 'busy' },
        },
        {
            machines: [
                { ...stopped, isDefault: true },
                { ...stopped, name: 'busy', starting: true },
            ],
            expected: { kind: 'otherActive', active: 'busy' },
        },
        {
            machines: [
                { ...stopped, isDefault: true },
                { ...stopped, name: 'other', isDefault: true },
            ],
            expected: { kind: 'ambiguous', names: ['custom-vm', 'other'] },
        },
    ])('selects live machine state $expected.kind', ({ machines, expected }) => {
        expect(classifyPodmanMachineState(machines)).toEqual(expected);
    });

    // Podman 6.1.4 on Windows, rootful machine: `machine list` reports Default false for it.
    const rootfulConnections = JSON.stringify([
        { Name: 'custom-vm', URI: 'ssh://user@127.0.0.1:65532/run/user/1000/podman/podman.sock', Default: false },
        { Name: 'custom-vm-root', URI: 'ssh://root@127.0.0.1:65532/run/podman/podman.sock', Default: true },
    ]);

    it('reads the default connection name', () => {
        expect(parsePodmanDefaultConnection(rootfulConnections)).toBe('custom-vm-root');
    });

    it.each(['not json', 'null', '{}', '[]', '[null]', '[{"Name":"vm","Default":false}]', '[{"Default":true}]'])(
        'finds no default connection in %s',
        (output) => {
            expect(parsePodmanDefaultConnection(output)).toBeUndefined();
        },
    );

    it.each([
        { connection: 'custom-vm-root', expected: { kind: 'stopped', name: 'custom-vm' } },
        { connection: 'elsewhere', expected: { kind: 'ambiguous', names: ['custom-vm', 'other'] } },
        { connection: undefined, expected: { kind: 'ambiguous', names: ['custom-vm', 'other'] } },
    ])('targets the rootful machine behind default connection $connection', ({ connection, expected }) => {
        expect(classifyPodmanMachineState([stopped, { ...stopped, name: 'other' }], connection)).toEqual(expected);
    });
});

function readFixture(name: string): string {
    return fs.readFileSync(path.join(__dirname, '__fixtures__', 'docker', name), 'utf8');
}

describe('classifyContainerEngine', () => {
    it.each([
        {
            name: 'installed selected Podman CLI',
            input: { cli: 'podman' },
            engine: 'podman',
            engineEvidence: 'selectedCli',
        },
        {
            name: 'verified Podman info',
            input: { podmanInfo: true },
            engine: 'podman',
            engineEvidence: 'podmanInfo',
        },
        {
            name: 'Podman shim version stdout',
            input: { cliVersionStdout: 'podman version 6.0.2\n' },
            engine: 'podman',
            engineEvidence: 'podmanShim',
        },
        {
            name: 'Podman shim version stderr',
            input: {
                cliVersionStderr: 'Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\n',
            },
            engine: 'podman',
            engineEvidence: 'podmanShim',
        },
        {
            name: 'Podman server component',
            input: { serverComponentNames: ['Podman Engine'] },
            engine: 'podman',
            engineEvidence: 'serverComponents',
        },
        {
            name: 'Docker Desktop daemon info',
            input: { daemonOperatingSystem: 'Docker Desktop' },
            engine: 'docker',
            engineEvidence: 'dockerDesktopInfo',
        },
        {
            name: 'Docker server component',
            input: { serverComponentNames: ['Engine', 'containerd', 'runc', 'docker-init'] },
            engine: 'docker',
            engineEvidence: 'serverComponents',
        },
        {
            name: 'Podman endpoint inference',
            input: { endpointAddress: 'unix:///run/user/1000/podman/podman.sock' },
            engine: 'unknown',
            engineEvidence: 'endpointPath',
        },
        {
            name: 'Podman socket link inference',
            input: { dockerSocketTarget: '/run/podman/podman.sock' },
            engine: 'unknown',
            engineEvidence: 'dockerSocketLink',
        },
    ] as const)('classifies $name', ({ input, engine, engineEvidence }) => {
        expect(classifyContainerEngine({ cli: 'docker', cliInstalled: true, ...input })).toEqual({
            engine,
            engineEvidence,
        });
    });

    it.each([
        {
            name: 'selected CLI before info',
            input: { cli: 'podman', podmanInfo: true },
            engine: 'podman',
            engineEvidence: 'selectedCli',
        },
        {
            name: 'info before shim output',
            input: { podmanInfo: true, cliVersionStdout: 'podman version 6.0.2' },
            engine: 'podman',
            engineEvidence: 'podmanInfo',
        },
        {
            name: 'shim before Docker server component',
            input: { cliVersionStderr: 'Emulate Docker CLI using podman', serverComponentNames: ['Engine'] },
            engine: 'podman',
            engineEvidence: 'podmanShim',
        },
        {
            name: 'Podman component before Docker Desktop',
            input: { serverComponentNames: ['Engine', 'Podman Engine'], daemonOperatingSystem: 'Docker Desktop' },
            engine: 'podman',
            engineEvidence: 'serverComponents',
        },
        {
            name: 'Docker Desktop before Docker component',
            input: { daemonOperatingSystem: 'Docker Desktop', serverComponentNames: ['Engine'] },
            engine: 'docker',
            engineEvidence: 'dockerDesktopInfo',
        },
        {
            name: 'positive Docker evidence before endpoint inference',
            input: { serverComponentNames: ['Engine'], endpointAddress: 'unix:///run/podman/podman.sock' },
            engine: 'docker',
            engineEvidence: 'serverComponents',
        },
        {
            name: 'endpoint inference before socket link inference',
            input: {
                endpointAddress: 'npipe:////./pipe/podman-machine-default',
                dockerSocketTarget: '/run/podman.sock',
            },
            engine: 'unknown',
            engineEvidence: 'endpointPath',
        },
    ] as const)('prefers $name', ({ input, engine, engineEvidence }) => {
        expect(classifyContainerEngine({ cli: 'docker', cliInstalled: true, ...input })).toEqual({
            engine,
            engineEvidence,
        });
    });

    it.each([
        { name: 'selected Docker CLI alone', input: {} },
        { name: 'missing selected Podman CLI', input: { cli: 'podman', cliInstalled: false } },
        { name: 'unverified Podman info', input: { podmanInfo: false } },
        { name: 'Docker client version alone', input: { cliVersionStdout: 'Docker version 28.1.1' } },
        {
            name: 'Podman mentioned later in stdout',
            input: { cliVersionStdout: 'Client connected to podman version 6.0.2' },
        },
        { name: 'generic Podman error', input: { cliVersionStderr: 'Cannot connect to Podman' } },
        { name: 'ambiguous server components', input: { serverComponentNames: ['My Podman Engine', 'containerd'] } },
        { name: 'generic daemon OS', input: { daemonOperatingSystem: 'Ubuntu 24.04' } },
        { name: 'non-Desktop daemon OS', input: { daemonOperatingSystem: 'NotDocker Desktop' } },
        { name: 'Docker socket path', input: { endpointAddress: '/var/run/docker.sock' } },
    ] satisfies ReadonlyArray<{ name: string; input: Partial<ContainerEngineInput> }>)(
        'makes no engine claim for $name',
        ({ input }) => {
            expect(classifyContainerEngine({ cli: 'docker', cliInstalled: true, ...input })).toEqual({
                engine: 'unknown',
                engineEvidence: 'none',
            });
        },
    );
});

describe('classifyDockerFailure', () => {
    it('classifies the reported Ubuntu socket EACCES as permission denied', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 1,
            stdout: '',
            stderr: readFixture('wsl2-ubuntu20.04-docker28.1.1-permission-denied.txt'),
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

    it('reads a stopped Podman machine from its stderr when the Docker socket still answers', () => {
        const infoProbe: DockerProbeEvidence = {
            probe: 'info',
            exitCode: 125,
            stdout: '',
            stderr: 'Cannot connect to Podman. Please verify your connection to the Linux system using `podman system connection list`',
            endedBy: 'exit',
            durationMs: 10,
        };
        const endpointProbe = { kind: 'unixSocket', source: 'platformDefault' } as const;

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
            name: 'missing CLI behind sh (exit 127)',
            probe: { exitCode: 127, endedBy: 'exit' } as const,
            expected: { failureKind: 'cliMissing', outcome: 'diagnosed' },
        },
        {
            name: 'missing CLI behind cmd.exe (exit 9009)',
            probe: { exitCode: 9009, endedBy: 'exit' } as const,
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
    it('classifies the captured WSL Engine ready fixture from live daemon metadata', () => {
        const fixture = readFixture('wsl2-ubuntu20.04-docker28.1.1-ready-info.txt');
        const body = fixture
            .split('\n')
            .filter((line) => !line.startsWith('#'))
            .join('\n')
            .trim();
        const facts = parseDockerInfoFacts(body);

        expect(
            classifyDockerProvider({
                environment: 'wsl',
                daemonReachable: true,
                daemonOperatingSystem: facts?.operatingSystem,
            }),
        ).toEqual({ provider: 'dockerEngine', providerEvidence: 'liveDaemon' });
    });

    it.each([
        {
            name: 'live positively identified Podman daemon',
            evidence: {
                environment: 'linux',
                daemonReachable: true,
                engine: 'podman',
                daemonOperatingSystem: 'Ubuntu 24.04',
            },
            expected: { provider: 'podman', providerEvidence: 'liveDaemon' },
        },
        {
            name: 'live Podman daemon without Docker OS metadata',
            evidence: { environment: 'macos', daemonReachable: true, engine: 'podman' },
            expected: { provider: 'podman', providerEvidence: 'liveDaemon' },
        },
        {
            name: 'unreachable Podman without live provider evidence',
            evidence: { environment: 'linux', daemonReachable: false, engine: 'podman' },
            expected: { provider: 'unknown', providerEvidence: 'none' },
        },
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
