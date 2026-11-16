/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PodmanClient, type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash } from '@microsoft/vscode-processutils';
import { Writable } from 'stream';
import type * as vscode from 'vscode';
import * as containerCli from './containerCli';
import { type RunDockerProbeOptions } from './dockerProbes';
import {
    getDockerStartCapability,
    type DockerProviderLauncherDependencies,
    type DockerStartCapabilityInput,
} from './DockerProviderLauncher';
import {
    detectDockerHostEnvironment,
    DockerReadinessService,
    resolveDockerEndpoint,
    resolveDockerPermissionDetail,
    type DockerReadinessServiceDependencies,
} from './DockerReadinessService';
import { type ContainerCliPresence, type DockerProbeEvidence, type DockerProviderMemory } from './quickStartTypes';

function commandResponse<T>(args: string[], parse: (output: string) => T): PromiseCommandResponse<T> {
    return {
        command: 'docker',
        args,
        parse: async (output: string): Promise<T> => parse(output),
    };
}

function createClient(): NonNullable<DockerReadinessServiceDependencies['client']> {
    return {
        checkInstall: async () => commandResponse(['-v'], (output) => output),
        info: async () => commandResponse(['info'], (output) => JSON.parse(output) as unknown),
        version: async () => commandResponse(['version', '--format', '{{json .}}'], () => undefined),
        listContexts: async () =>
            commandResponse<ListContextItem[]>(['context', 'ls'], (output) => JSON.parse(output) as ListContextItem[]),
    };
}

function evidence(
    probe: DockerProbeEvidence['probe'],
    overrides: Partial<DockerProbeEvidence> = {},
): DockerProbeEvidence {
    return {
        probe,
        stdout: '',
        stderr: '',
        endedBy: 'exit',
        durationMs: 1,
        ...overrides,
    };
}

describe('live Podman machine readiness', () => {
    beforeEach(() => {
        vi.spyOn(containerCli, 'findOnPath').mockReturnValue('/usr/local/bin/podman');
    });
    afterEach(() => vi.restoreAllMocks());

    function machineService(
        overrides: DockerReadinessServiceDependencies = {},
        stdout: string = '[{"Name":"custom-vm","Default":true,"Running":false,"Starting":false}]',
    ): {
        service: DockerReadinessService;
        list: ReturnType<typeof vi.fn>;
        capability: ReturnType<typeof vi.fn>;
    } {
        const list = vi.fn().mockResolvedValue({ exitCode: 0, stdout });
        const capability = vi.fn(
            (input: DockerStartCapabilityInput, dependencies: DockerProviderLauncherDependencies = {}) =>
                getDockerStartCapability(input, {
                    ...dependencies,
                    runProcess: list,
                    pathExists: async () => true,
                }),
        );
        return {
            list,
            capability,
            service: new DockerReadinessService({
                client: { ...createClient(), id: PodmanClient.ClientId },
                shellProvider: new Bash(),
                platform: 'darwin',
                environmentVariables: { DOCKER_HOST: 'unix:///run/podman.sock' },
                runProbe: async (options) =>
                    evidence(
                        options.probe,
                        options.probe === 'info'
                            ? { exitCode: 1, stderr: 'Cannot connect to Podman' }
                            : { stdout: 'podman version 6.0.2' },
                    ),
                probeEndpoint: async (endpoint) => ({
                    kind: endpoint.kind,
                    source: endpoint.source,
                    accessErrorCode: 'ECONNREFUSED',
                }),
                getStartCapability: capability,
                readProviderMemory: () => undefined,
                writeProviderMemory: async () => undefined,
                ...overrides,
            }),
        };
    }

    it.each(['darwin', 'win32'] as const)(
        'discovers and offers the selected Podman machine on %s',
        async (platform) => {
            const executable = platform === 'win32' ? 'C:\\Podman\\podman.exe' : '/usr/local/bin/podman';
            vi.mocked(containerCli.findOnPath).mockReturnValue(executable);
            const { service, list } = machineService({ platform });
            expect(await service.getReadiness()).toMatchObject({
                cli: 'podman',
                failureKind: 'daemonUnavailable',
                startAction: 'startPodmanMachine',
                podmanMachine: { kind: 'stopped', name: 'custom-vm' },
            });
            expect(list).toHaveBeenCalledExactlyOnceWith(
                executable,
                ['machine', 'list', '--format', 'json'],
                expect.any(Object),
            );
        },
    );

    it.each([
        { stdout: '[]', machine: { kind: 'none' }, failure: 'daemonUnavailable', recovery: 'podmanMachineInit' },
        {
            stdout: '[{"Name":"vm","Default":true,"Running":false,"Starting":true}]',
            machine: { kind: 'starting', name: 'vm' },
            failure: 'daemonStarting',
            recovery: undefined,
        },
        {
            stdout: '[{"Name":"vm","Default":true,"Running":true,"Starting":false}]',
            machine: { kind: 'running', name: 'vm' },
            failure: 'daemonUnavailable',
            recovery: undefined,
        },
        {
            stdout: '[{"Name":"a","Default":false,"Running":false,"Starting":false},{"Name":"b","Default":false,"Running":false,"Starting":false}]',
            machine: { kind: 'ambiguous', names: ['a', 'b'] },
            failure: 'daemonUnavailable',
            recovery: undefined,
        },
        {
            stdout: '[{"Name":"a","Default":true,"Running":false,"Starting":false},{"Name":"b","Default":false,"Running":true,"Starting":false}]',
            machine: { kind: 'otherActive', active: 'b' },
            failure: 'daemonUnavailable',
            recovery: undefined,
        },
        { stdout: 'bad json', machine: { kind: 'unknown' }, failure: 'daemonUnavailable', recovery: undefined },
    ])('carries live $machine.kind facts without a start button', async ({ stdout, machine, failure, recovery }) => {
        const { service } = machineService({}, stdout);
        const result = await service.getReadiness();
        expect(result).toMatchObject({ podmanMachine: machine, failureKind: failure });
        expect(result.startAction).toBeUndefined();
        expect(result.recoveryCommand?.id).toBe(recovery);
    });

    it.each([
        {
            setting: 'DOCKER_HOST=tcp',
            platform: 'darwin',
            environmentVariables: { DOCKER_HOST: 'tcp://docker.example:2375' },
        },
        {
            setting: 'DOCKER_HOST=ssh',
            platform: 'win32',
            environmentVariables: { DOCKER_HOST: 'ssh://user@docker.example' },
        },
        { setting: 'DOCKER_CONTEXT', platform: 'darwin', environmentVariables: { DOCKER_CONTEXT: 'remote-docker' } },
    ] as const)(
        'offers the Podman machine although $setting points Docker elsewhere',
        async ({ platform, environmentVariables }) => {
            // Podman ignores Docker's endpoint settings, so only a local endpoint can be refused.
            const { service } = machineService({
                platform,
                environmentVariables,
                probeEndpoint: async (endpoint) => ({
                    kind: endpoint.kind,
                    source: endpoint.source,
                    ...(endpoint.kind === 'unixSocket' || endpoint.kind === 'namedPipe'
                        ? { accessErrorCode: 'ECONNREFUSED' }
                        : {}),
                }),
            });
            const result = await service.getReadiness();
            expect(result).toMatchObject({
                cli: 'podman',
                failureKind: 'daemonUnavailable',
                endpointKind: 'unknown',
                startAction: 'startPodmanMachine',
                podmanMachine: { kind: 'stopped', name: 'custom-vm' },
            });
            expect(result.endpointSource).toBeUndefined();
        },
    );

    function failingInfo(stderr: string): DockerReadinessServiceDependencies['runProbe'] {
        return async (options) =>
            evidence(
                options.probe,
                options.probe === 'info'
                    ? {
                          exitCode: 125,
                          stderr: `Cannot connect to Podman.\nError: unable to connect to Podman socket: ${stderr}`,
                      }
                    : { stdout: 'podman version 6.1.4' },
            );
    }

    it('reports an unreachable remote Podman host without offering the local machine', async () => {
        const { service, list, capability } = machineService({
            runProbe: failingInfo('failed to connect: dial tcp 10.0.0.5:22: i/o timeout'),
        });
        const result = await service.getReadiness();
        expect(result).toMatchObject({ failureKind: 'endpointUnreachable', podmanTarget: { kind: 'remote' } });
        expect(result.startAction).toBeUndefined();
        expect(result.recoveryCommand).toBeUndefined();
        expect(list).not.toHaveBeenCalled();
        expect(capability).not.toHaveBeenCalled();
    });

    it('still offers the local machine when Podman dialled it on 127.0.0.1', async () => {
        const { service } = machineService({
            runProbe: failingInfo('failed to connect: dial tcp 127.0.0.1:63483: connect: connection refused'),
        });
        expect(await service.getReadiness()).toMatchObject({
            failureKind: 'daemonUnavailable',
            podmanTarget: { kind: 'local' },
            startAction: 'startPodmanMachine',
        });
    });

    it('tells WSL to start the Windows machine on Windows, never the user socket', async () => {
        const { service, list } = machineService({
            platform: 'linux',
            remoteName: 'wsl',
            runProbe: failingInfo(
                'dial unix /mnt/wsl/podman-sockets/podman-machine-default/podman-user.sock: connect: no such file or directory',
            ),
        });
        const result = await service.getReadiness();
        expect(result).toMatchObject({
            environment: 'wsl',
            failureKind: 'daemonUnavailable',
            podmanTarget: { kind: 'windowsMachineFromWsl', name: 'podman-machine-default' },
            recoveryCommand: {
                id: 'podmanMachineStartOnWindows',
                commandLine: 'podman machine start podman-machine-default',
            },
        });
        expect(result.startAction).toBeUndefined();
        expect(list).not.toHaveBeenCalled();
    });

    it('does not describe a ready Podman with the Docker endpoint setting', async () => {
        const { service } = machineService({
            environmentVariables: { DOCKER_HOST: 'tcp://docker.example:2375' },
            runProbe: async (options) =>
                evidence(
                    options.probe,
                    options.probe === 'info'
                        ? { stdout: JSON.stringify({ host: { os: 'linux', arch: 'arm64' } }) }
                        : { stdout: 'podman version 6.0.2' },
                ),
        });
        expect(await service.getReadiness()).toMatchObject({
            outcome: 'ready',
            cli: 'podman',
            endpointKind: 'unknown',
        });
    });

    it.each([
        { platform: 'linux', remoteName: undefined },
        { platform: 'linux', remoteName: 'wsl' },
        { platform: 'darwin', remoteName: 'ssh-remote' },
        { platform: 'win32', remoteName: 'dev-container' },
        { platform: 'darwin', remoteName: 'codespaces' },
        { platform: 'win32', remoteName: 'other-remote' },
    ] as const)('never discovers a host machine on $platform/$remoteName', async ({ platform, remoteName }) => {
        const { service, list, capability } = machineService({ platform, remoteName });
        const result = await service.getReadiness();
        expect(result.startAction).toBeUndefined();
        expect(result.podmanMachine).toBeUndefined();
        expect(list).not.toHaveBeenCalled();
        expect(capability).not.toHaveBeenCalled();
        expect(containerCli.findOnPath).not.toHaveBeenCalled();
    });

    it.each(['podman', 'docker'] as const)('does not perform healthy machine lookups for %s', async (cli) => {
        const { service, list, capability } = machineService({
            client: { ...createClient(), id: cli === 'podman' ? PodmanClient.ClientId : undefined },
            runProbe: async (options) =>
                evidence(options.probe, {
                    stdout: options.probe === 'info' ? '{"OSType":"linux"}' : 'podman version 6.0.2',
                }),
        });
        expect(await service.getReadiness()).toMatchObject({ outcome: 'ready' });
        expect(list).not.toHaveBeenCalled();
        expect(capability).not.toHaveBeenCalled();
        expect(containerCli.findOnPath).not.toHaveBeenCalled();
    });

    it('does not perform a machine lookup for a permission failure', async () => {
        const { service, list } = machineService({
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'EACCES',
            }),
        });
        expect(await service.getReadiness()).toMatchObject({ failureKind: 'permissionDenied' });
        expect(list).not.toHaveBeenCalled();
        expect(containerCli.findOnPath).not.toHaveBeenCalled();
    });

    it.each([true, false])('requires Podman on PATH for a positive Docker CLI shim (present=%s)', async (present) => {
        vi.mocked(containerCli.findOnPath).mockReturnValue(present ? '/usr/local/bin/podman' : undefined);
        const { service, list } = machineService({ client: createClient() });
        const result = await service.getReadiness();
        expect(result).toMatchObject({ cli: 'docker', engine: 'podman', engineEvidence: 'podmanShim' });
        expect(result.startAction).toBe(present ? 'startPodmanMachine' : undefined);
        expect(list).toHaveBeenCalledTimes(present ? 1 : 0);
    });

    it('never promotes an inferred Podman endpoint into machine evidence', async () => {
        const { service, list } = machineService({
            client: createClient(),
            runProbe: async (options) =>
                evidence(
                    options.probe,
                    options.probe === 'info'
                        ? { exitCode: 1, stderr: 'Cannot connect to the Docker daemon' }
                        : { stdout: 'Docker version 28.1.1' },
                ),
        });
        const result = await service.getReadiness();
        expect(result).toMatchObject({ engine: 'unknown', engineEvidence: 'endpointPath' });
        expect(result.startAction).not.toBe('startPodmanMachine');
        expect(list).not.toHaveBeenCalled();
        expect(containerCli.findOnPath).not.toHaveBeenCalled();
    });

    it('re-reads machine state during an explicit forced check without provider storage', async () => {
        const readProviderMemory = vi.fn();
        const writeProviderMemory = vi.fn();
        const { service, list } = machineService({ readProviderMemory, writeProviderMemory });
        expect((await service.getReadiness()).startAction).toBe('startPodmanMachine');
        list.mockResolvedValueOnce({ exitCode: 0, stdout: '[]' });
        const result = await service.getReadiness({ forceRefresh: true });
        expect(result.startAction).toBeUndefined();
        expect(result.podmanMachine).toEqual({ kind: 'none' });
        expect(list).toHaveBeenCalledTimes(2);
        expect(readProviderMemory).not.toHaveBeenCalled();
        expect(writeProviderMemory).not.toHaveBeenCalled();
    });
});

describe('DockerReadinessService', () => {
    describe('preferred engine resolution', () => {
        afterEach(() => vi.restoreAllMocks());

        function createService(overrides: DockerReadinessServiceDependencies = {}): DockerReadinessService {
            return new DockerReadinessService({
                getClient: () => createClient(),
                getCliOnPath: (resolved) => resolved.onPath,
                platform: 'linux',
                arch: 'x64',
                environmentVariables: {},
                runProbe: async (options) =>
                    evidence(options.probe, {
                        stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '[]',
                    }),
                resolveDockerSocketTarget: async () => ({}),
                probeEndpoint: async (endpoint) => ({
                    kind: endpoint.kind,
                    source: endpoint.source,
                    accessErrorCode: 'ECONNREFUSED',
                }),
                getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
                readProviderMemory: () => undefined,
                writeProviderMemory: async () => undefined,
                ...overrides,
            });
        }

        it.each(['docker', 'podman'] as const)(
            'does not fall back when installed preferred %s is stopped',
            async (preferred) => {
                const resolve = vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue({
                    cli: preferred,
                    executable: preferred,
                    preferred,
                    fellBack: false,
                    onPath: { docker: true, podman: true },
                });
                const getClient = vi.fn((resolved: containerCli.ResolvedContainerCli) => ({
                    ...createClient(),
                    info: async () => ({
                        ...commandResponse(['info'], (output) => JSON.parse(output) as unknown),
                        command: resolved.cli,
                    }),
                }));
                const service = createService({
                    getClient,
                    runProbe: async (options) => {
                        const command = await (typeof options.command === 'function'
                            ? options.command()
                            : options.command);
                        return evidence(
                            options.probe,
                            options.probe === 'info' && command.command === preferred
                                ? { exitCode: 1, stderr: 'Cannot connect to the engine' }
                                : { stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '[]' },
                        );
                    },
                });

                const result = await service.getReadiness({ engine: { kind: 'preferred', preferred } });

                expect(resolve).toHaveBeenCalledExactlyOnceWith(preferred);
                expect(result).toMatchObject({
                    cli: preferred,
                    preferredEngine: preferred,
                    cliFallback: false,
                    cliInstalled: true,
                    daemonReachable: false,
                    outcome: 'diagnosed',
                });
                expect(getClient).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cli: preferred }));
            },
        );

        it('omits preference evidence from an ownership-pinned check and keeps its memo apart', async () => {
            const selection = {
                cli: 'podman',
                executable: 'podman',
                preferred: 'podman',
                fellBack: false,
                onPath: { docker: true, podman: true },
            } as const;
            vi.spyOn(containerCli, 'resolvePinnedContainerCli').mockReturnValue(selection);
            vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue(selection);
            const service = createService();
            const pinnedRequest = { engine: { kind: 'pinned', cli: 'podman' } } as const;

            // The owner is not a preference: nobody chose it for this run.
            const pinned = await service.getReadiness(pinnedRequest);
            expect(pinned).toMatchObject({ cli: 'podman', outcome: 'ready' });
            expect(pinned).not.toHaveProperty('preferredEngine');
            expect(pinned).not.toHaveProperty('cliFallback');

            // Same CLI and executable, but chosen by preference: the pinned memo must not answer.
            expect(await service.getReadiness({ engine: { kind: 'preferred', preferred: 'podman' } })).toMatchObject({
                cli: 'podman',
                preferredEngine: 'podman',
                cliFallback: false,
            });
            expect(await service.getReadiness(pinnedRequest)).toBe(pinned);
        });

        it('returns fallback evidence from this execution and re-resolves before a memo hit', async () => {
            const resolve = vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue({
                cli: 'docker',
                executable: 'docker',
                preferred: 'podman',
                fellBack: true,
                onPath: { docker: true, podman: false },
            });
            const getClient = vi.fn(() => createClient());
            const service = createService({ getClient });
            const request = { engine: { kind: 'preferred', preferred: 'podman' } } as const;
            const first = await service.getReadiness(request);
            expect(first).toMatchObject({ cli: 'docker', preferredEngine: 'podman', cliFallback: true });
            expect(await service.getReadiness(request)).toBe(first);
            expect(resolve).toHaveBeenCalledTimes(2);
            expect(getClient).toHaveBeenCalledTimes(1);

            resolve.mockReturnValue({
                cli: 'podman',
                executable: 'podman',
                preferred: 'podman',
                fellBack: false,
                onPath: { docker: true, podman: true },
            });
            expect(await service.getReadiness(request)).toMatchObject({
                cli: 'podman',
                preferredEngine: 'podman',
                cliFallback: false,
                cliOnPath: { docker: true, podman: true },
            });
            expect(getClient).toHaveBeenCalledTimes(2);
        });

        it.each([
            { preferred: 'docker', cli: 'podman', expectReset: false },
            { preferred: 'podman', cli: 'docker', expectReset: true },
        ] as const)(
            'uses the resolved CLI rather than $preferred preference when resetting memory',
            async ({ preferred, cli, expectReset }) => {
                vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue({
                    cli,
                    executable: cli,
                    preferred,
                    fellBack: true,
                    onPath: { docker: cli === 'docker', podman: cli === 'podman' },
                });
                const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
                const service = createService({ writeProviderMemory });

                await service.getReadiness({
                    engine: { kind: 'preferred', preferred },
                    forceRefresh: true,
                    resetProviderMemory: true,
                });

                expect(writeProviderMemory.mock.calls.some(([value]) => value === undefined)).toBe(expectReset);
            },
        );

        it.each(['executable', 'preferred', 'onPath'] as const)(
            'keys readiness memoization by %s evidence',
            async (field) => {
                const original: containerCli.ResolvedContainerCli = {
                    cli: 'docker',
                    executable: 'docker',
                    preferred: 'docker',
                    fellBack: false,
                    onPath: { docker: true, podman: false },
                };
                const resolve = vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue(original);
                const getClient = vi.fn(() => createClient());
                const service = createService({ getClient });
                const first = await service.getReadiness();
                expect(await service.getReadiness()).toBe(first);
                const changed: containerCli.ResolvedContainerCli = {
                    ...original,
                    ...(field === 'executable' ? { executable: '/new/docker' } : {}),
                    ...(field === 'preferred' ? { preferred: 'podman', fellBack: true } : {}),
                    ...(field === 'onPath' ? { onPath: { docker: true, podman: true } } : {}),
                };
                resolve.mockReturnValue(changed);

                const second = await service.getReadiness({
                    engine: { kind: 'preferred', preferred: changed.preferred },
                });
                expect(second).not.toBe(first);
                expect(getClient).toHaveBeenCalledTimes(2);
                expect(second).toMatchObject({
                    preferredEngine: changed.preferred,
                    cliFallback: changed.fellBack,
                    cliOnPath: changed.onPath,
                });
            },
        );

        it('isolates forced and in-flight checks with different preferences for the same selected CLI', async () => {
            vi.spyOn(containerCli, 'resolveContainerCli').mockImplementation((preferred = 'docker') => ({
                cli: 'docker',
                executable: 'docker',
                preferred,
                fellBack: preferred !== 'docker',
                onPath: { docker: true, podman: false },
            }));
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const getClient = vi.fn(() => createClient());
            const service = createService({
                getClient,
                runProbe: async (options) => {
                    await gate;
                    return evidence(options.probe, {
                        stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '',
                    });
                },
            });
            const docker = service.getReadiness({ engine: { kind: 'preferred', preferred: 'docker' } });
            const podman = service.getReadiness({
                engine: { kind: 'preferred', preferred: 'podman' },
                forceRefresh: true,
            });
            const duplicate = service.getReadiness({
                engine: { kind: 'preferred', preferred: 'podman' },
                forceRefresh: true,
            });
            expect(getClient).toHaveBeenCalledTimes(2);
            release();
            expect(await docker).toMatchObject({ preferredEngine: 'docker', cliFallback: false });
            const podmanResult = await podman;
            expect(podmanResult).toMatchObject({ preferredEngine: 'podman', cliFallback: true });
            expect(await duplicate).toBe(podmanResult);
        });
    });

    it.each([
        {
            state: 'ready',
            outcome: 'ready',
            cliOnPath: { docker: true, podman: true },
            probeCount: 3,
        },
        {
            state: 'unreachable',
            outcome: 'diagnosed',
            cliOnPath: { docker: true, podman: true },
            probeCount: 3,
        },
        {
            state: 'missing',
            outcome: 'diagnosed',
            cliOnPath: { docker: false, podman: false },
            probeCount: 2,
        },
        {
            state: 'timeout',
            outcome: 'indeterminate',
            cliOnPath: { docker: true, podman: false },
            probeCount: 3,
        },
        {
            state: 'unsupported',
            outcome: 'diagnosed',
            cliOnPath: { docker: false, podman: true },
            probeCount: 0,
        },
    ])('carries PATH presence independently of $state readiness', async ({ state, outcome, cliOnPath, probeCount }) => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (state === 'missing') {
                return evidence(options.probe, { spawnErrorCode: 'ENOENT' });
            }
            if (state === 'timeout') {
                return evidence(options.probe, { endedBy: 'deadline' });
            }
            if (state === 'unreachable' && options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence(options.probe, {
                stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '[]',
            });
        });
        const service = new DockerReadinessService({
            client: createClient(),
            getCliOnPath: () => cliOnPath,
            shellProvider: new Bash(),
            platform: state === 'unsupported' ? 'aix' : 'linux',
            arch: 'x64',
            environmentVariables: {},
            runProbe,
            resolveDockerSocketTarget: async () => ({}),
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: state === 'unreachable' ? 'ECONNREFUSED' : undefined,
            }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
            writeProviderMemory: async () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome,
            cli: 'docker',
            cliOnPath,
            daemonReachable: state === 'ready',
        });
        expect(runProbe).toHaveBeenCalledTimes(probeCount);
    });

    it('snapshots presence immediately after discovery and refreshes it only for a new check', async () => {
        const order: string[] = [];
        let cliOnPath: ContainerCliPresence = { docker: true, podman: false };
        const getCliOnPath = vi.fn(() => {
            order.push('presence');
            return cliOnPath;
        });
        const service = new DockerReadinessService({
            getClient: () => {
                order.push('client');
                cliOnPath = { docker: true, podman: true };
                return createClient();
            },
            getCliOnPath,
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe: async (options): Promise<DockerProbeEvidence> => {
                cliOnPath = { docker: false, podman: true };
                return evidence(options.probe, {
                    stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '',
                });
            },
            writeProviderMemory: async () => undefined,
        });

        const first = await service.getReadiness();
        expect(first.cliOnPath).toEqual({ docker: true, podman: true });
        expect(order).toEqual(['client', 'presence']);
        expect(await service.getReadiness()).toBe(first);
        expect(getCliOnPath).toHaveBeenCalledTimes(1);
        await service.getReadiness({ forceRefresh: true });
        expect(order).toEqual(['client', 'presence', 'client', 'presence']);
    });

    it.each([false, true])('omits unknown PATH presence with an undefined getter=%s', async (injectGetter) => {
        const service = new DockerReadinessService({
            client: createClient(),
            platform: 'aix',
            ...(injectGetter ? { getCliOnPath: () => undefined } : {}),
        });
        expect(await service.getReadiness()).not.toHaveProperty('cliOnPath');
    });

    it.each([
        {
            name: 'Podman component behind the Docker CLI',
            stdout: '{"Server":{"Components":[{"Name":"Podman Engine"}]}}',
            engine: 'podman',
            engineEvidence: 'serverComponents',
            provider: 'podman',
        },
        {
            name: 'positive Docker engine component',
            stdout: '{"Server":{"Components":[{"Name":"Engine"}]}}',
            engine: 'docker',
            engineEvidence: 'serverComponents',
            provider: 'dockerEngine',
        },
        {
            name: 'differently cased Podman component',
            stdout: '{"Server":{"Components":[{"Name":"podman engine"}]}}',
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
        },
        {
            name: 'unknown component',
            stdout: '{"Server":{"Components":[{"Name":"containerd"}]}}',
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
        },
        {
            name: 'malformed JSON',
            stdout: '{"Server":',
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
        },
        {
            name: 'partially malformed component list',
            stdout: '{"Server":{"Components":[{"Name":"Podman Engine"},{}]}}',
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
        },
        {
            name: 'no version output',
            stdout: '',
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
        },
    ])('uses raw server-version evidence for $name', async ({ stdout, engine, engineEvidence, provider }) => {
        const parse = vi.fn().mockRejectedValue(new Error('library parser discards components'));
        const version = vi.fn(async () => ({ ...commandResponse(['version'], () => undefined), parse }));
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({
                        OSType: 'linux',
                        OperatingSystem: 'Ubuntu 24.04',
                        ServerVersion: '6.0.2',
                    }),
                });
            }
            return evidence(options.probe, {
                stdout: options.probe === 'serverVersion' ? stdout : 'Docker version 28.1.1',
            });
        });
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const resolveDockerSocketTarget = vi.fn().mockResolvedValue({});
        const service = new DockerReadinessService({
            client: { ...createClient(), version },
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            resolveDockerSocketTarget,
            writeProviderMemory,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'ready',
            cli: 'docker',
            cliVersion: 'Docker version 28.1.1',
            serverVersion: '6.0.2',
            daemonReachable: true,
            engine,
            engineEvidence,
            provider,
        });
        expect(runProbe.mock.calls.map(([options]) => options.probe)).toEqual(['cliVersion', 'info', 'serverVersion']);
        expect(version).toHaveBeenCalledExactlyOnceWith({});
        expect(parse).not.toHaveBeenCalled();
        expect(resolveDockerSocketTarget).not.toHaveBeenCalled();
        expect(writeProviderMemory).toHaveBeenCalledWith(
            expect.objectContaining({ provider: provider === 'podman' ? 'unknown' : provider }),
        );
    });

    it.each([
        { name: 'nonzero info exit', exitCode: 1, stdout: '{"OSType":"linux"}' },
        { name: 'server errors', stdout: '{"ServerErrors":["cannot connect to the Docker daemon"]}' },
        { name: 'malformed info', stdout: 'not json' },
    ])('skips server version after $name', async ({ exitCode, stdout }) => {
        const version = vi.fn();
        const runProbe = vi.fn(
            async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                evidence(options.probe, options.probe === 'info' ? { exitCode, stdout } : { stdout: '[]' }),
        );
        const service = new DockerReadinessService({
            client: { ...createClient(), version },
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
            runProbe,
            resolveDockerSocketTarget: async () => ({}),
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({ daemonReachable: false });
        expect(version).not.toHaveBeenCalled();
        expect(runProbe).not.toHaveBeenCalledWith(expect.objectContaining({ probe: 'serverVersion' }));
    });

    it.each(['command rejection', 'probe rejection', 'nonzero exit', 'spawn error'] as const)(
        'keeps a healthy daemon ready after an optional server-version %s',
        async (failure) => {
            const appendDiagnostic = vi.fn();
            const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
                if (options.probe === 'info') {
                    return evidence('info', { stdout: '{"OSType":"linux","OperatingSystem":"Docker Desktop"}' });
                }
                if (options.probe === 'serverVersion') {
                    if (failure === 'probe rejection') {
                        throw new Error('version failed');
                    }
                    return evidence('serverVersion', {
                        stdout: '{"Server":{"Components":[{"Name":"Podman Engine"}]}}',
                        ...(failure === 'spawn error' ? { spawnErrorCode: 'ENOENT' } : { exitCode: 1 }),
                    });
                }
                return evidence(options.probe);
            });
            const service = new DockerReadinessService({
                client: {
                    ...createClient(),
                    ...(failure === 'command rejection'
                        ? { version: async () => Promise.reject(new Error('unsupported version command')) }
                        : {}),
                },
                shellProvider: new Bash(),
                platform: 'linux',
                environmentVariables: {},
                runProbe,
                resolveDockerSocketTarget: async () => ({}),
                writeProviderMemory: async () => undefined,
                createProbeOutput: () => ({ appendDiagnostic }),
            });

            await expect(service.getReadiness()).resolves.toMatchObject({
                outcome: 'ready',
                daemonReachable: true,
                engine: 'docker',
                engineEvidence: 'dockerDesktopInfo',
                provider: 'dockerDesktop',
            });
            if (failure === 'nonzero exit' || failure === 'spawn error') {
                expect(appendDiagnostic).not.toHaveBeenCalledWith(
                    expect.stringContaining('[readiness] serverVersion=unavailable'),
                );
            }
        },
    );

    it.each([
        {
            source: 'command',
            error: Object.assign(new Error('W3_PRIVATE_VERSION_COMMAND_MESSAGE'), { code: 'E_VERSION_COMMAND' }),
            code: 'E_VERSION_COMMAND',
        },
        {
            source: 'probe',
            error: Object.assign(new Error('W3_PRIVATE_VERSION_PROBE_MESSAGE'), { code: 'E_VERSION_PROBE' }),
            code: 'E_VERSION_PROBE',
        },
        {
            source: 'command',
            error: new Error('W3_PRIVATE_VERSION_NO_CODE_MESSAGE'),
            code: 'unknown',
        },
    ])('logs only code $code for a rejected $source even when echo is suppressed', async ({ source, error, code }) => {
        const appendDiagnostic = vi.fn();
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'serverVersion' && source === 'probe') {
                throw error;
            }
            return evidence(options.probe, { stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '' });
        });
        const service = new DockerReadinessService({
            client: {
                ...createClient(),
                ...(source === 'command'
                    ? {
                          version: async (): Promise<PromiseCommandResponse<unknown>> => {
                              throw error;
                          },
                      }
                    : {}),
            },
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            resolveDockerSocketTarget: async () => ({}),
            writeProviderMemory: async () => undefined,
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await expect(service.getReadiness({ suppressCommandEcho: true })).resolves.toMatchObject({
            outcome: 'ready',
            daemonReachable: true,
        });
        expect(appendDiagnostic.mock.calls).toEqual([[`[readiness] serverVersion=unavailable code=${code}`]]);
        expect(appendDiagnostic.mock.calls.flat().join('\n')).not.toContain(error.message);
    });

    it('does not downgrade healthy info when the optional server-version probe reaches the shared deadline', async () => {
        const runProbe = vi.fn((options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'serverVersion') {
                return new Promise((resolve) => {
                    options.cancellationToken?.onCancellationRequested(() => {
                        expect(options.didDeadlineExpire?.()).toBe(true);
                        resolve(evidence('serverVersion', { endedBy: 'deadline' }));
                    });
                });
            }
            return Promise.resolve(
                evidence(options.probe, { stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '' }),
            );
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            deadlineMs: 5,
            runProbe,
            resolveDockerSocketTarget: async () => ({}),
            writeProviderMemory: async () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'ready',
            daemonReachable: true,
            engine: 'unknown',
            canContinueAnyway: false,
        });
        expect(runProbe).toHaveBeenCalledTimes(3);
    });

    it('preserves caller cancellation during the optional server-version await', async () => {
        let cancelCaller: (() => void) | undefined;
        const callerToken = {
            isCancellationRequested: false,
            onCancellationRequested(listener: () => void): vscode.Disposable {
                cancelCaller = listener;
                return { dispose: () => undefined };
            },
        } as vscode.CancellationToken;
        let optionalProbeStarted = false;
        const runProbe = vi.fn((options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'serverVersion') {
                optionalProbeStarted = true;
                return new Promise((resolve) => {
                    options.cancellationToken?.onCancellationRequested(() => {
                        resolve(evidence('serverVersion', { endedBy: 'cancellation' }));
                    });
                });
            }
            return Promise.resolve(
                evidence(options.probe, { stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '' }),
            );
        });
        const writeProviderMemory = vi.fn();
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            resolveDockerSocketTarget: async () => ({}),
            writeProviderMemory,
        });

        const readiness = service.getReadiness({ cancellationToken: callerToken });
        await vi.waitFor(() => expect(optionalProbeStarted).toBe(true));
        cancelCaller?.();

        await expect(readiness).rejects.toBeDefined();
        expect(runProbe).toHaveBeenCalledTimes(3);
        expect(writeProviderMemory).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'keeps failed server-version stdout private with suppressCommandEcho=%s',
        async (suppress) => {
            const onCommand = vi.fn();
            const stdout: string[] = [];
            const stderr: string[] = [];
            const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
                options.onCommand?.(`docker ${options.probe}`);
                if (options.probe === 'info') {
                    return evidence('info', { stdout: '{"OSType":"linux"}' });
                }
                if (options.probe === 'serverVersion') {
                    expect(options.stdOutPipe).toBeUndefined();
                    return evidence('serverVersion', {
                        exitCode: 1,
                        stdout: 'private version JSON',
                        stderr: 'version failed',
                    });
                }
                return evidence(options.probe);
            });
            const service = new DockerReadinessService({
                client: createClient(),
                shellProvider: new Bash(),
                platform: 'linux',
                environmentVariables: {},
                runProbe,
                resolveDockerSocketTarget: async () => ({}),
                writeProviderMemory: async () => undefined,
                createProbeOutput: () => ({
                    onCommand,
                    stdOutPipe: new Writable({
                        write: (chunk, _encoding, callback): void => {
                            stdout.push(String(chunk));
                            callback();
                        },
                    }),
                    stdErrPipe: new Writable({
                        write: (chunk, _encoding, callback): void => {
                            stderr.push(String(chunk));
                            callback();
                        },
                    }),
                }),
            });

            await expect(service.getReadiness({ suppressCommandEcho: suppress })).resolves.toMatchObject({
                outcome: 'ready',
            });
            expect(stdout).toEqual([]);
            expect(onCommand).toHaveBeenCalledWith('docker serverVersion');
            if (suppress) {
                expect(stderr).toEqual(['version failed']);
            }
        },
    );

    it.each([
        { target: '/run/user/1000/podman/podman.sock', engineEvidence: 'dockerSocketLink' },
        { target: '/run/docker.sock', engineEvidence: 'none' },
        { target: undefined, engineEvidence: 'none' },
    ])('treats a compatibility socket target $target as inference only', async ({ target, engineEvidence }) => {
        const appendDiagnostic = vi.fn();
        const resolveDockerSocketTarget = vi.fn().mockResolvedValue(target ? { target } : {});
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'darwin',
            environmentVariables: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
            runProbe: async (options) =>
                evidence(options.probe, { exitCode: options.probe === 'info' ? 1 : undefined }),
            resolveDockerSocketTarget,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ENOENT',
            }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'daemonUnavailable',
            daemonReachable: false,
            engine: 'unknown',
            engineEvidence,
            provider: 'unknown',
        });
        expect(resolveDockerSocketTarget).toHaveBeenCalledExactlyOnceWith('/var/run/docker.sock');
        expect(appendDiagnostic.mock.calls.map(([line]) => line)).toEqual([
            '[readiness] failureKind=daemonUnavailable outcome=diagnosed',
            '[readiness] environment=macos endpoint=unixSocket source=dockerHostEnv',
            '[readiness] provider=unknown evidence=none',
        ]);
    });

    it('logs only an unexpected socket resolution error code without claiming an engine', async () => {
        const appendDiagnostic = vi.fn();
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
            runProbe: async (options) =>
                evidence(options.probe, { exitCode: options.probe === 'info' ? 1 : undefined }),
            resolveDockerSocketTarget: async () => ({ errorCode: 'EACCES' }),
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ENOENT',
            }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'daemonUnavailable',
            daemonReachable: false,
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'unknown',
        });
        expect(appendDiagnostic.mock.calls).toEqual([
            ['[readiness] socketLink=unavailable code=EACCES'],
            ['[readiness] failureKind=daemonUnavailable outcome=diagnosed'],
            ['[readiness] environment=linux endpoint=unixSocket source=dockerHostEnv'],
            ['[readiness] provider=unknown evidence=none'],
        ]);
    });

    it.each([
        ['win32', 'unix:///var/run/docker.sock'],
        ['win32', 'npipe:////./pipe/docker_engine'],
        ['linux', 'unix:///run/podman/podman.sock'],
        ['linux', 'tcp://localhost:2375'],
        ['darwin', 'ssh://private-host'],
    ] as const)('does not resolve a compatibility socket for %s / %s', async (platform, dockerHost) => {
        const resolveDockerSocketTarget = vi.fn().mockResolvedValue({ target: '/run/podman/podman.sock' });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform,
            environmentVariables: { DOCKER_HOST: dockerHost },
            runProbe: async (options) =>
                evidence(options.probe, { exitCode: options.probe === 'info' ? 1 : undefined }),
            resolveDockerSocketTarget,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ENOENT',
            }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({ daemonReachable: false });
        expect(resolveDockerSocketTarget).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'selected Podman CLI',
            cli: 'podman',
            versionStdout: 'podman version 6.0.2',
            versionStderr: '',
            info: { host: { os: 'linux', arch: 'aarch64' }, version: { Version: '6.0.2' } },
            engine: 'podman',
            engineEvidence: 'selectedCli',
            provider: 'podman',
            storedProvider: 'unknown',
            serverVersion: '6.0.2',
            outcome: 'ready',
        },
        {
            name: 'Docker CLI with Podman info',
            cli: 'docker',
            versionStdout: 'Docker version 28.1.1',
            versionStderr: '',
            info: { host: { os: 'linux', arch: 'aarch64' }, version: { Version: '6.0.2' } },
            engine: 'podman',
            engineEvidence: 'podmanInfo',
            provider: 'podman',
            storedProvider: 'unknown',
            serverVersion: '6.0.2',
            outcome: 'ready',
        },
        {
            name: 'Podman shim stdout with Docker-compatible info',
            cli: 'docker',
            versionStdout: 'podman version 6.0.2',
            versionStderr: '',
            info: {
                OSType: 'linux',
                Architecture: 'aarch64',
                OperatingSystem: 'Ubuntu 24.04',
                ServerVersion: '6.0.2',
            },
            engine: 'podman',
            engineEvidence: 'podmanShim',
            provider: 'podman',
            storedProvider: 'unknown',
            serverVersion: '6.0.2',
            outcome: 'ready',
        },
        {
            name: 'Podman shim stderr with Docker-compatible info',
            cli: 'docker',
            versionStdout: 'Docker version 28.1.1',
            versionStderr: 'Emulate Docker CLI using podman',
            info: {
                OSType: 'linux',
                Architecture: 'aarch64',
                OperatingSystem: 'Ubuntu 24.04',
                ServerVersion: '6.0.2',
            },
            engine: 'podman',
            engineEvidence: 'podmanShim',
            provider: 'podman',
            storedProvider: 'unknown',
            serverVersion: '6.0.2',
            outcome: 'ready',
        },
        {
            name: 'Docker Desktop with independent server version',
            cli: 'docker',
            versionStdout: 'Docker version 28.1.1',
            versionStderr: '',
            info: {
                OSType: 'linux',
                Architecture: 'aarch64',
                OperatingSystem: 'Docker Desktop',
                ServerVersion: '29.8.0',
            },
            engine: 'docker',
            engineEvidence: 'dockerDesktopInfo',
            provider: 'dockerDesktop',
            storedProvider: 'dockerDesktop',
            serverVersion: '29.8.0',
            outcome: 'ready',
        },
        {
            name: 'generic daemon OS without positive engine evidence',
            cli: 'docker',
            versionStdout: 'Docker version 28.1.1',
            versionStderr: '',
            info: {
                OSType: 'linux',
                Architecture: 'aarch64',
                OperatingSystem: 'Ubuntu 24.04',
                ServerVersion: '28.1.1',
            },
            engine: 'unknown',
            engineEvidence: 'none',
            provider: 'dockerEngine',
            storedProvider: 'dockerEngine',
            serverVersion: '28.1.1',
            outcome: 'ready',
        },
        {
            name: 'reachable Windows-container Docker Desktop',
            cli: 'docker',
            versionStdout: 'Docker version 28.1.1',
            versionStderr: '',
            info: {
                OSType: 'windows',
                Architecture: 'aarch64',
                OperatingSystem: 'Docker Desktop',
                ServerVersion: '29.8.0',
            },
            engine: 'docker',
            engineEvidence: 'dockerDesktopInfo',
            provider: 'dockerDesktop',
            storedProvider: 'dockerDesktop',
            serverVersion: '29.8.0',
            outcome: 'diagnosed',
        },
    ] as const)(
        'reports engine facts for $name without redundant probes or a new memory schema',
        async ({
            cli,
            versionStdout,
            versionStderr,
            info,
            engine,
            engineEvidence,
            provider,
            storedProvider,
            serverVersion,
            outcome,
        }) => {
            const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
                if (options.probe === 'info') {
                    return evidence('info', { stdout: JSON.stringify(info) });
                }
                return evidence(options.probe, { stdout: versionStdout, stderr: versionStderr });
            });
            const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
            const probeEndpoint = vi.fn();
            const service = new DockerReadinessService({
                resolveDockerSocketTarget: async () => ({}),
                client: { ...createClient(), id: cli === 'podman' ? PodmanClient.ClientId : undefined },
                shellProvider: new Bash(),
                platform: 'linux',
                environmentVariables: {},
                now: () => 1_000,
                runProbe,
                probeEndpoint,
                writeProviderMemory,
            });

            await expect(service.getReadiness()).resolves.toMatchObject({
                outcome,
                cli,
                engine,
                engineEvidence,
                provider,
                providerEvidence: 'liveDaemon',
                serverVersion,
                cliVersion: versionStdout,
                daemonReachable: true,
            });
            expect(runProbe).toHaveBeenCalledTimes(engine === 'podman' ? 2 : 3);
            expect(probeEndpoint).not.toHaveBeenCalled();
            expect(writeProviderMemory.mock.calls).toEqual(
                cli === 'podman'
                    ? []
                    : [
                          [
                              {
                                  provider: storedProvider,
                                  endpointKind: 'unknown',
                                  hostEnvironment: 'linux',
                                  daemonArchitecture: 'arm64',
                                  osType: 'OSType' in info ? info.OSType : info.host.os,
                                  recordedAtMs: 1_000,
                              },
                          ],
                      ],
            );
        },
    );

    it.each(['missing', 'unsupported'] as const)('does not claim the selected Podman CLI when %s', async (state) => {
        const runProbe = vi.fn(
            async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                evidence(options.probe, { spawnErrorCode: 'ENOENT' }),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: { ...createClient(), id: PodmanClient.ClientId },
            shellProvider: new Bash(),
            platform: state === 'unsupported' ? 'aix' : 'linux',
            environmentVariables: {},
            runProbe,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: state === 'unsupported' ? 'unsupportedHost' : 'cliMissing',
            cli: 'podman',
            cliInstalled: false,
            engine: 'unknown',
            engineEvidence: 'none',
        });
        expect(runProbe).toHaveBeenCalledTimes(state === 'unsupported' ? 0 : 2);
    });

    it('ignores remembered Docker Desktop and Docker start capability for stopped Podman', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence('cliVersion', { stdout: 'podman version 6.0.2' });
        });
        const readProviderMemory = vi.fn(
            (): DockerProviderMemory => ({
                provider: 'dockerDesktop',
                endpointKind: 'unixSocket',
                hostEnvironment: 'linux',
                recordedAtMs: 500,
            }),
        );
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const getStartCapability = vi.fn().mockResolvedValue({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopLinux',
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: { ...createClient(), id: PodmanClient.ClientId },
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_HOST: 'unix:///var/run/docker.sock' },
            now: () => 1_000,
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            readProviderMemory,
            writeProviderMemory,
            getStartCapability,
        });

        const result = await service.getReadiness();
        expect(result).toMatchObject({
            failureKind: 'unknown',
            engine: 'podman',
            engineEvidence: 'selectedCli',
            provider: 'unknown',
            providerEvidence: 'none',
            providerRecordedAtMs: undefined,
            recoveryCommand: undefined,
        });
        expect(result.startAction).toBeUndefined();
        expect(runProbe).toHaveBeenCalledTimes(2);
        expect(readProviderMemory).not.toHaveBeenCalled();
        expect(writeProviderMemory).not.toHaveBeenCalled();
        expect(getStartCapability).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'healthy', platform: 'linux', host: 'unix:///var/run/docker.sock', failure: undefined },
        { name: 'stopped Linux', platform: 'linux', host: 'unix:///var/run/docker.sock', failure: 'ECONNREFUSED' },
        {
            name: 'stopped WSL',
            platform: 'linux',
            host: 'unix:///var/run/docker.sock',
            failure: 'ECONNREFUSED',
            remoteName: 'wsl',
        },
        {
            name: 'Desktop endpoint',
            platform: 'darwin',
            host: 'unix:///Users/user/.docker/run/docker.sock',
            failure: 'ECONNREFUSED',
        },
        {
            name: 'rootless endpoint',
            platform: 'linux',
            host: 'unix:///run/user/1000/docker.sock',
            failure: 'ECONNREFUSED',
        },
        { name: 'permission denied', platform: 'linux', host: 'unix:///var/run/docker.sock', failure: 'EACCES' },
        {
            name: 'Windows Desktop installed',
            platform: 'win32',
            host: 'npipe:////./pipe/docker_engine',
            failure: 'ENOENT',
        },
    ] as const)('does not use Docker memory or actions for $name Podman, even on reset', async (scenario) => {
        const { platform, host, failure } = scenario;
        const readProviderMemory = vi.fn(
            (): DockerProviderMemory => ({
                provider: 'dockerDesktop',
                endpointKind: platform === 'win32' ? 'namedPipe' : 'unixSocket',
                hostEnvironment: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux',
                recordedAtMs: 500,
            }),
        );
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const getStartCapability = vi.fn().mockResolvedValue({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopWindows',
        });
        const probeSocketGroup = vi.fn();
        const detectServiceManager = vi.fn();
        const service = new DockerReadinessService({
            client: { ...createClient(), id: PodmanClient.ClientId },
            shellProvider: new Bash(),
            platform,
            remoteName: 'remoteName' in scenario ? scenario.remoteName : undefined,
            environmentVariables: { DOCKER_HOST: host },
            runProbe: async (options) =>
                options.probe === 'info' && failure
                    ? evidence('info', {
                          exitCode: 1,
                          stderr: 'Cannot connect to Podman\nError: unable to connect to Podman socket: dial unix /run/user/1000/podman/podman.sock: connect: connection refused',
                      })
                    : evidence(options.probe, {
                          stdout: options.probe === 'info' ? '{"OSType":"linux"}' : 'podman version 6.0.2',
                      }),
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: failure,
            }),
            resolveDockerSocketTarget: async () => ({}),
            readProviderMemory,
            writeProviderMemory,
            getStartCapability,
            probeSocketGroup,
            detectServiceManager,
        });

        const result = await service.getReadiness({ forceRefresh: true, resetProviderMemory: true });

        expect(result).toMatchObject({
            cli: 'podman',
            engine: 'podman',
            engineEvidence: 'selectedCli',
            provider: failure ? 'unknown' : 'podman',
            providerEvidence: failure ? 'none' : 'liveDaemon',
            ...(failure
                ? { failureKind: failure === 'EACCES' ? 'permissionDenied' : 'daemonUnavailable' }
                : { outcome: 'ready' }),
        });
        expect(result.startAction).toBeUndefined();
        if (failure === 'ECONNREFUSED' && platform === 'linux') {
            expect(result.recoveryCommand?.id).toBe('linuxStartPodmanSocket');
        } else {
            expect(result.recoveryCommand).toBeUndefined();
        }
        expect(readProviderMemory).not.toHaveBeenCalled();
        expect(writeProviderMemory).not.toHaveBeenCalled();
        expect(getStartCapability).not.toHaveBeenCalled();
        expect(probeSocketGroup).not.toHaveBeenCalled();
        expect(detectServiceManager).not.toHaveBeenCalled();
    });

    it('keeps a Podman endpoint inference unknown on failure', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_HOST: 'unix:///run/podman/podman.sock' },
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ENOENT',
            }),
            readProviderMemory: () => undefined,
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'daemonUnavailable',
            engine: 'unknown',
            engineEvidence: 'endpointPath',
            provider: 'unknown',
        });
        expect(runProbe).toHaveBeenCalledTimes(2);
    });

    it('classifies a Linux endpoint EACCES and returns the copyable group command', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            switch (options.probe) {
                case 'cliVersion':
                    return evidence('cliVersion', { stdout: 'Docker version 27.5.1' });
                case 'info':
                    return evidence('info', { exitCode: 1, stderr: 'Process exited with code 1' });
                case 'contexts':
                    return evidence('contexts', {
                        stdout: JSON.stringify([
                            {
                                name: 'default',
                                current: true,
                                containerEndpoint: 'unix:///var/run/docker.sock',
                            },
                        ]),
                    });
                case 'serverVersion':
                    return evidence('serverVersion');
            }
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            arch: 'x64',
            environmentVariables: {},
            remoteName: undefined,
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'EACCES',
            }),
            probeSocketGroup: async () => ({}),
        });

        const result = await service.getReadiness();

        expect(result).toMatchObject({
            outcome: 'diagnosed',
            environment: 'linux',
            endpointKind: 'unixSocket',
            failureKind: 'permissionDenied',
            cliInstalled: true,
            daemonReachable: false,
            canContinueAnyway: false,
            recoveryCommand: {
                id: 'linuxDockerGroup',
                commandLine: 'sudo usermod -aG docker $USER',
                requiresElevation: true,
            },
        });
    });

    it('diagnoses a stopped Podman machine although Podman has no contexts', async () => {
        const runProbe = vi.fn(
            async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                options.probe === 'info'
                    ? evidence('info', {
                          exitCode: 125,
                          stderr: 'Error: unable to connect to Podman socket: dial unix /tmp/podman.sock: connect: connection refused',
                      })
                    : evidence(options.probe, { stdout: 'podman version 6.0.2' }),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            getClient: () => ({
                ...createClient(),
                id: PodmanClient.ClientId,
                listContexts: () => Promise.reject(new Error('listContexts is not supported for this runtime')),
            }),
            shellProvider: new Bash(),
            platform: 'darwin',
            arch: 'arm64',
            environmentVariables: {},
            remoteName: undefined,
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ECONNREFUSED',
            }),
            getStartCapability: async ({ provider, providerEvidence }) => ({ provider, providerEvidence }),
            readProviderMemory: () => undefined,
            writeProviderMemory: async () => undefined,
        });

        const result = await service.getReadiness({ engine: { kind: 'pinned', cli: 'podman' } });

        expect(runProbe).not.toHaveBeenCalledWith(expect.objectContaining({ probe: 'contexts' }));
        expect(result).toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'daemonUnavailable',
            cliInstalled: true,
            cli: 'podman',
        });
    });

    it('refines only a unix-socket permission failure with socket group facts', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            switch (options.probe) {
                case 'cliVersion':
                    return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
                case 'info':
                    return evidence('info', { exitCode: 1 });
                case 'contexts':
                    return evidence('contexts', {
                        stdout: JSON.stringify([
                            {
                                name: 'default',
                                current: true,
                                containerEndpoint: 'unix:///var/run/docker.sock',
                            },
                        ]),
                    });
                case 'serverVersion':
                    return evidence('serverVersion');
            }
        });
        const probeSocketGroup = vi.fn().mockResolvedValue({
            socketGid: 998,
            processHasSocketGroup: false,
            userIsGroupMember: true,
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { WSL_DISTRO_NAME: 'Ubuntu-20.04' },
            remoteName: 'wsl',
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'EACCES',
            }),
            probeSocketGroup,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            environment: 'wsl',
            failureKind: 'permissionDenied',
            permissionDetail: 'pendingSessionRestart',
            recoveryCommand: { id: 'wslRestartFromWindows', commandLine: 'wsl --shutdown' },
        });
        expect(probeSocketGroup).toHaveBeenCalledWith('/var/run/docker.sock');
    });

    it('does not probe socket groups for a named pipe permission failure', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1, stderr: 'access denied' });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const probeSocketGroup = vi.fn();
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'win32',
            environmentVariables: { DOCKER_HOST: 'npipe:////./pipe/docker_engine' },
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'EACCES',
            }),
            probeSocketGroup,
        });

        await service.getReadiness();

        expect(probeSocketGroup).not.toHaveBeenCalled();
    });

    it('runs CLI version, info and server version once for concurrent callers', async () => {
        const resolvers = new Map<DockerProbeEvidence['probe'], (value: DockerProbeEvidence) => void>();
        const runProbe = vi.fn(
            (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                new Promise((resolve) => resolvers.set(options.probe, resolve)),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
        });

        const first = service.getReadiness();
        const second = service.getReadiness();
        expect(runProbe).toHaveBeenCalledTimes(2);
        resolvers.get('cliVersion')?.(evidence('cliVersion', { stdout: 'Docker version 27.5.1' }));
        resolvers.get('info')?.(
            evidence('info', {
                stdout: JSON.stringify({ OSType: 'linux', Architecture: 'x86_64', ServerErrors: [] }),
            }),
        );

        await vi.waitFor(() => expect(resolvers.has('serverVersion')).toBe(true));
        resolvers.get('serverVersion')?.(evidence('serverVersion'));

        await expect(first).resolves.toMatchObject({ outcome: 'ready', daemonArchitecture: 'amd64' });
        await expect(second).resolves.toMatchObject({ outcome: 'ready', daemonArchitecture: 'amd64' });
        expect(runProbe).toHaveBeenCalledTimes(3);
    });

    it('isolates concurrent engine clients, in-flight checks and forced-refresh memoization', async () => {
        let releaseDocker!: () => void;
        const dockerGate = new Promise<void>((resolve) => {
            releaseDocker = resolve;
        });
        const clients: string[] = [];
        const service = new DockerReadinessService({
            getClient: ({ cli }) => {
                clients.push(cli);
                return {
                    ...createClient(),
                    checkInstall: async () => ({ ...commandResponse(['-v'], (output) => output), command: cli }),
                    info: async () => ({
                        ...commandResponse(['info'], (output) => JSON.parse(output) as unknown),
                        command: cli,
                    }),
                    version: async () => ({ ...commandResponse(['version'], () => undefined), command: cli }),
                };
            },
            getCliOnPath: (resolved) => resolved.onPath,
            platform: 'linux',
            arch: 'x64',
            environmentVariables: {},
            writeProviderMemory: async () => undefined,
            runProbe: async (options) => {
                const command = await (typeof options.command === 'function' ? options.command() : options.command);
                if (command.command === 'docker') {
                    await dockerGate;
                }
                return evidence(options.probe, {
                    stdout:
                        options.probe === 'info'
                            ? JSON.stringify({
                                  OSType: 'linux',
                                  Architecture: command.command === 'podman' ? 'aarch64' : 'x86_64',
                              })
                            : '',
                });
            },
        });
        const dockerRequest = { engine: { kind: 'pinned', cli: 'docker' } } as const;
        const podmanRequest = { engine: { kind: 'pinned', cli: 'podman' } } as const;
        let dockerFinished = false;
        const docker = service.getReadiness(dockerRequest);
        void docker.then(() => {
            dockerFinished = true;
        });
        const duplicateDocker = service.getReadiness(dockerRequest);

        const podman = await service.getReadiness(podmanRequest);
        expect(podman).toMatchObject({ cli: 'podman', daemonArchitecture: 'arm64', outcome: 'ready' });
        expect(dockerFinished).toBe(false);
        expect(await service.getReadiness(podmanRequest)).toBe(podman);
        const refreshedPodman = await service.getReadiness({ ...podmanRequest, forceRefresh: true });
        expect(refreshedPodman).not.toBe(podman);
        expect(clients).toEqual(['docker', 'podman', 'podman']);

        releaseDocker();
        const dockerResult = await docker;
        expect(dockerResult).toMatchObject({ cli: 'docker', daemonArchitecture: 'amd64', outcome: 'ready' });
        expect(await duplicateDocker).toBe(dockerResult);
        expect(await service.getReadiness(dockerRequest)).toBe(dockerResult);
        expect(await service.getReadiness(podmanRequest)).toBe(refreshedPodman);
    });

    it('treats a zero-exit info body with ServerErrors as not ready', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            switch (options.probe) {
                case 'cliVersion':
                    return evidence('cliVersion', { stdout: 'Docker version 27.5.1' });
                case 'info':
                    return evidence('info', {
                        stdout: JSON.stringify({
                            OSType: 'linux',
                            Architecture: 'x86_64',
                            ServerErrors: ['permission denied opening Docker endpoint'],
                        }),
                    });
                case 'contexts':
                    return evidence('contexts', { stdout: '[]' });
                case 'serverVersion':
                    return evidence('serverVersion');
            }
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            probeSocketGroup: async () => ({}),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            daemonReachable: false,
        });
    });

    it('cancels both probes under one deadline and returns an indeterminate timeout', async () => {
        const tokens: vscode.CancellationToken[] = [];
        const runProbe = vi.fn(
            (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                new Promise((resolve) => {
                    if (options.cancellationToken) {
                        tokens.push(options.cancellationToken);
                        options.cancellationToken.onCancellationRequested(() => {
                            resolve(
                                evidence(options.probe, {
                                    endedBy: options.didDeadlineExpire?.() ? 'deadline' : 'cancellation',
                                }),
                            );
                        });
                    }
                }),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            deadlineMs: 5,
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
        });

        const result = await service.getReadiness();

        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toBe(tokens[1]);
        expect(result).toMatchObject({
            outcome: 'indeterminate',
            failureKind: 'probeTimedOut',
            canContinueAnyway: true,
        });
    });

    it('propagates caller cancellation instead of classifying it as a deadline failure', async () => {
        let cancelCaller: (() => void) | undefined;
        let callerCancelled = false;
        const callerToken = {
            get isCancellationRequested(): boolean {
                return callerCancelled;
            },
            onCancellationRequested(listener: () => void): vscode.Disposable {
                cancelCaller = listener;
                return { dispose: () => undefined };
            },
        } as vscode.CancellationToken;
        const runProbe = vi.fn(
            (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                new Promise((resolve) => {
                    options.cancellationToken?.onCancellationRequested(() => {
                        resolve(evidence(options.probe, { endedBy: 'cancellation' }));
                    });
                }),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
        });

        const readiness = service.getReadiness({ cancellationToken: callerToken });
        callerCancelled = true;
        cancelCaller?.();

        await expect(readiness).rejects.toBeDefined();
        expect(runProbe).toHaveBeenCalledTimes(2);
    });

    it('uses a memoized result unless force refresh is requested', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({ OSType: 'linux', Architecture: 'aarch64', ServerErrors: [] }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 27.5.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
        });

        await service.getReadiness();
        await service.getReadiness();
        expect(runProbe).toHaveBeenCalledTimes(3);

        await service.getReadiness({ forceRefresh: true });
        expect(runProbe).toHaveBeenCalledTimes(6);
    });

    it('returns unsupportedHost without spawning Docker on an unsupported host', async () => {
        const runProbe = vi.fn();
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'aix',
            environmentVariables: {},
            runProbe,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'unsupportedHost',
            environment: 'unsupported',
        });
        expect(runProbe).not.toHaveBeenCalled();
    });

    it('returns cliMissing without resolving contexts or probing an endpoint', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { spawnErrorCode: 'ENOENT' });
            }
            return evidence(options.probe, { spawnErrorCode: 'ENOENT' });
        });
        const probeEndpoint = vi.fn();
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({ failureKind: 'cliMissing' });
        expect(runProbe).toHaveBeenCalledTimes(2);
        expect(probeEndpoint).not.toHaveBeenCalled();
    });

    // Probes run through a shell, so a missing binary is the shell's "command not found", not ENOENT.
    it('returns cliMissing when the shell cannot find docker', async () => {
        const runProbe = vi.fn(
            async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                evidence(options.probe, { exitCode: 127, stderr: '/bin/sh: docker: command not found\n' }),
        );
        const probeEndpoint = vi.fn();
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'cliMissing',
            cliInstalled: false,
            daemonReachable: false,
        });
        expect(probeEndpoint).not.toHaveBeenCalled();
    });

    it('reports the CLI as installed when the info process spawned after a failed version probe', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'cliVersion') {
                return evidence('cliVersion', { exitCode: 1 });
            }
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence('contexts', { stdout: '[]' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            cliInstalled: true,
            cliVersion: undefined,
        });
    });

    it('classifies an explicitly selected context that is absent', async () => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', { stdout: '[]' });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_CONTEXT: 'missing' },
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            readProviderMemory: () => ({
                provider: 'dockerDesktop',
                endpointKind: 'unknown',
                hostEnvironment: 'linux',
                recordedAtMs: Date.now(),
            }),
            writeProviderMemory,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'contextUnavailable',
            endpointKind: 'unknown',
        });
        expect(writeProviderMemory).toHaveBeenCalledWith(undefined);
    });

    it('does not claim a selected context is absent when the context probe failed', async () => {
        const appendDiagnostic = vi.fn();
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence(options.probe, { exitCode: 1, stderr: 'raw daemon error' });
            }
            if (options.probe === 'contexts') {
                return evidence(options.probe, { exitCode: 1 });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_CONTEXT: 'unresolved' },
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            getStartCapability: async (input) => ({
                provider: input.provider,
                providerEvidence: input.providerEvidence,
            }),
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'unknown',
            outcome: 'indeterminate',
            endpointSource: 'dockerContextEnv',
        });
        expect(appendDiagnostic.mock.calls).toEqual([
            ['[readiness] failureKind=unknown outcome=indeterminate'],
            ['[readiness] environment=linux endpoint=unknown source=dockerContextEnv'],
            ['[readiness] provider=unknown evidence=none'],
            ['[readiness] stderr: raw daemon error'],
        ]);
    });

    it('persists live Docker Desktop facts after a successful info probe', async () => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({
                        OSType: 'linux',
                        OperatingSystem: 'Docker Desktop',
                        Architecture: 'x86_64',
                        ServerErrors: [],
                    }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'darwin',
            environmentVariables: {},
            now: () => 1_000,
            runProbe,
            writeProviderMemory,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'ready',
            provider: 'dockerDesktop',
            providerEvidence: 'liveDaemon',
            daemonArchitecture: 'amd64',
        });
        expect(writeProviderMemory).toHaveBeenCalledWith({
            provider: 'dockerDesktop',
            endpointKind: 'unknown',
            hostEnvironment: 'macos',
            daemonArchitecture: 'amd64',
            osType: 'linux',
            recordedAtMs: 1_000,
        });
    });

    it('logs a docker info summary instead of piping its JSON to the channel', async () => {
        const appendDiagnostic = vi.fn();
        const stdOutPipe = new Writable({ write: (_chunk, _encoding, callback): void => callback() });
        const pipedProbes: string[] = [];
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.stdOutPipe) {
                pipedProbes.push(options.probe);
            }
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({
                        OSType: 'linux',
                        OperatingSystem: 'Docker Desktop',
                        Architecture: 'x86_64',
                        ServerVersion: '29.8.0',
                        ServerErrors: [],
                    }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            createProbeOutput: () => ({ stdOutPipe, appendDiagnostic }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({ outcome: 'ready' });
        expect(pipedProbes).toEqual(['cliVersion']);
        expect(appendDiagnostic.mock.calls).toEqual([
            ['[readiness] docker server=29.8.0 os=linux (Docker Desktop) arch=x86_64'],
        ]);
    });

    it.each([
        [
            'missing docker info fields fall back to unknown',
            false,
            ['[readiness] docker server=unknown os=unknown arch=unknown'],
        ],
        ['a suppressed poll logs no summary', true, []],
    ])('%s', async (_name, suppressCommandEcho, expected) => {
        const appendDiagnostic = vi.fn();
        const runProbe = vi.fn(
            async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                options.probe === 'info'
                    ? evidence('info', { stdout: JSON.stringify({ ServerErrors: [] }) })
                    : evidence(options.probe, { stdout: 'Docker version 28.1.1' }),
        );
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await service.getReadiness({ suppressCommandEcho });

        expect(appendDiagnostic.mock.calls).toEqual(expected.map((line) => [line]));
    });

    it('logs docker info server errors as diagnostics on failure', async () => {
        const appendDiagnostic = vi.fn();
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    exitCode: 1,
                    stdout: JSON.stringify({ ServerErrors: ['Cannot connect to the Docker daemon'] }),
                });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', { stdout: '[]' });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            createProbeOutput: () => ({ appendDiagnostic }),
        });

        await service.getReadiness();

        expect(appendDiagnostic).toHaveBeenCalledWith('[readiness] server error: Cannot connect to the Docker daemon');
    });

    it('diagnoses a reachable Windows-container daemon', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({
                        OSType: 'windows',
                        OperatingSystem: 'Docker Desktop',
                        ServerErrors: [],
                    }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'win32',
            environmentVariables: {},
            runProbe,
            writeProviderMemory: async () => undefined,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'windowsContainers',
            daemonReachable: true,
            osType: 'windows',
            provider: 'dockerDesktop',
        });
    });

    it('uses current remembered Desktop evidence while a provider may be starting', async () => {
        const memory: DockerProviderMemory = {
            provider: 'dockerDesktop',
            endpointKind: 'unixSocket',
            hostEnvironment: 'linux',
            recordedAtMs: 500,
        };
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', {
                    stdout: JSON.stringify([
                        { name: 'default', current: true, containerEndpoint: 'unix:///var/run/docker.sock' },
                    ]),
                });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            now: () => 1_000,
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            readProviderMemory: () => memory,
            getStartCapability: async (input) => ({
                provider: input.provider,
                providerEvidence: input.providerEvidence,
            }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'daemonStarting',
            provider: 'dockerDesktop',
            providerEvidence: 'rememberedProvider',
            providerRecordedAtMs: 500,
        });
    });

    it('returns the provider capability selected from host launch evidence', async () => {
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const getStartCapability = vi.fn().mockResolvedValue({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopWindows',
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'win32',
            environmentVariables: { DOCKER_HOST: 'npipe:////./pipe/docker_engine' },
            runProbe,
            probeEndpoint: async (endpoint) => ({
                kind: endpoint.kind,
                source: endpoint.source,
                accessErrorCode: 'ENOENT',
            }),
            getStartCapability,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'daemonUnavailable',
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopWindows',
        });
        expect(getStartCapability).toHaveBeenCalledWith(
            expect.objectContaining({
                environment: 'windows',
                provider: 'unknown',
                providerEvidence: 'none',
                endpointAddress: '\\\\.\\pipe\\docker_engine',
            }),
        );
    });

    it.each([
        {
            name: 'expired',
            memory: {
                provider: 'dockerDesktop',
                endpointKind: 'unixSocket',
                hostEnvironment: 'linux',
                recordedAtMs: 0,
            },
            now: 7 * 24 * 60 * 60 * 1_000 + 1,
            platform: 'linux',
            remoteName: undefined,
            endpoint: 'unix:///var/run/docker.sock',
        },
        {
            name: 'different environment',
            memory: {
                provider: 'dockerDesktop',
                endpointKind: 'unixSocket',
                hostEnvironment: 'linux',
                recordedAtMs: 500,
            },
            now: 1_000,
            platform: 'linux',
            remoteName: 'wsl',
            endpoint: 'unix:///var/run/docker.sock',
        },
        {
            name: 'different endpoint kind',
            memory: {
                provider: 'dockerDesktop',
                endpointKind: 'namedPipe',
                hostEnvironment: 'linux',
                recordedAtMs: 500,
            },
            now: 1_000,
            platform: 'linux',
            remoteName: undefined,
            endpoint: 'unix:///var/run/docker.sock',
        },
    ] as const)('discards $name provider memory', async ({ memory, now, platform, remoteName, endpoint }) => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', {
                    stdout: JSON.stringify([{ name: 'default', current: true, containerEndpoint: endpoint }]),
                });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform,
            remoteName,
            environmentVariables: {},
            now: () => now,
            runProbe,
            probeEndpoint: async (resolvedEndpoint) => ({
                kind: resolvedEndpoint.kind,
                source: resolvedEndpoint.source,
            }),
            readProviderMemory: () => memory,
            writeProviderMemory,
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            provider: 'unknown',
            providerEvidence: 'none',
        });
        expect(writeProviderMemory).toHaveBeenCalledWith(undefined);
    });

    it('preserves remembered state during a forced refresh', async () => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe: async (options): Promise<DockerProbeEvidence> => evidence(options.probe, { exitCode: 1 }),
            writeProviderMemory,
        });

        await service.getReadiness({ forceRefresh: true });

        expect(writeProviderMemory).not.toHaveBeenCalled();
    });

    it('clears remembered state before an explicitly reset forced refresh', async () => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({ OSType: 'linux', OperatingSystem: 'Ubuntu', ServerErrors: [] }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            writeProviderMemory,
        });

        await service.getReadiness({ forceRefresh: true, resetProviderMemory: true });

        expect(writeProviderMemory.mock.calls[0]).toEqual([undefined]);
        expect(writeProviderMemory.mock.calls[1]?.[0]).toMatchObject({ provider: 'dockerEngine' });
    });

    it('deduplicates concurrent forced refreshes behind an existing check', async () => {
        const initialResolvers: Array<(value: DockerProbeEvidence) => void> = [];
        const runProbe = vi.fn((options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (runProbe.mock.calls.length <= 2) {
                return new Promise((resolve) => initialResolvers.push(resolve));
            }
            if (options.probe === 'info') {
                return Promise.resolve(
                    evidence('info', {
                        stdout: JSON.stringify({ OSType: 'linux', OperatingSystem: 'Ubuntu', ServerErrors: [] }),
                    }),
                );
            }
            return Promise.resolve(evidence(options.probe, { stdout: 'Docker version 28.1.1' }));
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            writeProviderMemory: async () => undefined,
        });

        const initial = service.getReadiness();
        const firstRefresh = service.getReadiness({ forceRefresh: true });
        const secondRefresh = service.getReadiness({ forceRefresh: true });
        initialResolvers[0]?.(evidence('cliVersion', { stdout: 'Docker version 28.1.1' }));
        initialResolvers[1]?.(
            evidence('info', {
                stdout: JSON.stringify({ OSType: 'linux', OperatingSystem: 'Ubuntu', ServerErrors: [] }),
            }),
        );

        await expect(initial).resolves.toMatchObject({ outcome: 'ready' });
        await expect(firstRefresh).resolves.toMatchObject({ outcome: 'ready' });
        await expect(secondRefresh).resolves.toMatchObject({ outcome: 'ready' });
        expect(runProbe).toHaveBeenCalledTimes(6);
    });

    it.each(['notAvailable', 'failed'] as const)('clears remembered state after a %s launch', async (result) => {
        const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
        const service = new DockerReadinessService({ writeProviderMemory });

        await service.recordLaunchResult(result, 'docker');

        expect(writeProviderMemory).toHaveBeenCalledWith(undefined);
    });

    it.each(['started', 'launchAttempted', 'notAvailable', 'failed'] as const)(
        'never accesses Docker memory after a %s Podman launch',
        async (result) => {
            const readProviderMemory = vi.fn();
            const writeProviderMemory = vi.fn().mockResolvedValue(undefined);
            const service = new DockerReadinessService({ readProviderMemory, writeProviderMemory });

            await service.recordLaunchResult(result, 'podman');

            expect(readProviderMemory).not.toHaveBeenCalled();
            expect(writeProviderMemory).not.toHaveBeenCalled();
        },
    );

    it('suppresses successful poll transcripts and retains failing probe transcripts', async () => {
        const onCommand = vi.fn();
        const stdout: string[] = [];
        const stderr: string[] = [];
        const runProbe = vi.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            options.onCommand?.(`docker ${options.probe}`);
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1, stdout: 'failed stdout', stderr: 'failed stderr' });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', { exitCode: 1, stdout: 'contexts stdout', stderr: 'contexts stderr' });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            resolveDockerSocketTarget: async () => ({}),
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
            createProbeOutput: () => ({
                onCommand,
                stdOutPipe: new Writable({
                    write: (chunk, _encoding, callback): void => {
                        stdout.push(String(chunk));
                        callback();
                    },
                }),
                stdErrPipe: new Writable({
                    write: (chunk, _encoding, callback): void => {
                        stderr.push(String(chunk));
                        callback();
                    },
                }),
            }),
        });

        await service.getReadiness({ suppressCommandEcho: true });

        expect(onCommand.mock.calls).toEqual([['docker info'], ['docker contexts']]);
        // `docker info` stdout is dropped (summarized elsewhere); other failing probes keep theirs.
        expect(stdout).toEqual(['contexts stdout']);
        expect(stderr).toEqual(['failed stderr', 'contexts stderr']);
    });
});

describe('resolveDockerPermissionDetail', () => {
    it.each([
        [true, false, 'pendingSessionRestart'],
        [false, false, 'notInGroup'],
        [false, true, 'notInGroup'],
        [undefined, false, 'unknown'],
        [true, true, 'unknown'],
    ] as const)(
        'maps membership %s and process group %s to %s',
        (userIsGroupMember, processHasSocketGroup, expected) => {
            expect(resolveDockerPermissionDetail({ userIsGroupMember, processHasSocketGroup })).toBe(expected);
        },
    );
});

describe('detectDockerHostEnvironment', () => {
    it.each([
        ['win32', undefined, {}, 'windows'],
        ['darwin', undefined, {}, 'macos'],
        ['linux', undefined, {}, 'linux'],
        ['linux', undefined, { WSL_DISTRO_NAME: 'Ubuntu' }, 'wsl'],
        ['linux', 'wsl', {}, 'wsl'],
        ['linux', 'ssh-remote', {}, 'ssh'],
        ['linux', 'dev-container', {}, 'devContainer'],
        ['linux', 'codespaces', {}, 'codespaces'],
    ] as const)('detects %s / %s as %s', (platform, remoteName, environmentVariables, expected) => {
        expect(detectDockerHostEnvironment(platform, remoteName, environmentVariables)).toBe(expected);
    });
});

describe('resolveDockerEndpoint', () => {
    const contexts: ListContextItem[] = [
        { name: 'selected', current: false, containerEndpoint: 'ssh://selected-host' },
        { name: 'current', current: true, containerEndpoint: 'unix:///current/docker.sock' },
    ];

    it('prefers DOCKER_HOST over every context', () => {
        expect(
            resolveDockerEndpoint(
                'linux',
                { DOCKER_HOST: 'tcp://configured-host:2375', DOCKER_CONTEXT: 'selected' },
                contexts,
            ),
        ).toEqual({ kind: 'tcp', address: 'tcp://configured-host:2375', source: 'dockerHostEnv' });
    });

    it('prefers DOCKER_CONTEXT over the current context', () => {
        expect(resolveDockerEndpoint('linux', { DOCKER_CONTEXT: 'selected' }, contexts)).toEqual({
            kind: 'ssh',
            address: 'ssh://selected-host',
            source: 'dockerContextEnv',
        });
    });

    it('uses the current context before the platform default', () => {
        expect(resolveDockerEndpoint('linux', {}, contexts)).toEqual({
            kind: 'unixSocket',
            address: '/current/docker.sock',
            source: 'currentContext',
        });
    });

    it.each([
        ['linux', { kind: 'unixSocket', address: '/var/run/docker.sock', source: 'platformDefault' }],
        ['win32', { kind: 'namedPipe', address: '\\\\.\\pipe\\docker_engine', source: 'platformDefault' }],
    ] as const)('uses the %s platform default', (platform, expected) => {
        expect(resolveDockerEndpoint(platform, {}, [])).toEqual(expected);
    });
});
