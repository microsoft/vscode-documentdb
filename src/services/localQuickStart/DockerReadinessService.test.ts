/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash } from '@microsoft/vscode-processutils';
import { type CancellationToken } from 'vscode';
import {
    detectDockerHostEnvironment,
    DockerReadinessService,
    resolveDockerEndpoint,
    resolveDockerPermissionDetail,
    type DockerReadinessServiceDependencies,
} from './DockerReadinessService';
import { type RunDockerProbeOptions } from './dockerProbes';
import { type DockerProbeEvidence } from './quickStartTypes';

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

describe('DockerReadinessService', () => {
    it('classifies a Linux endpoint EACCES and returns the copyable group command', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
            }
        });
        const service = new DockerReadinessService({
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

    it('refines only a unix-socket permission failure with socket group facts', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
            }
        });
        const probeSocketGroup = jest.fn().mockResolvedValue({
            socketGid: 998,
            processHasSocketGroup: false,
            userIsGroupMember: true,
        });
        const service = new DockerReadinessService({
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
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1, stderr: 'access denied' });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const probeSocketGroup = jest.fn();
        const service = new DockerReadinessService({
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

    it('runs version and info once for concurrent callers', async () => {
        const resolvers = new Map<DockerProbeEvidence['probe'], (value: DockerProbeEvidence) => void>();
        const runProbe = jest.fn(
            (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                new Promise((resolve) => resolvers.set(options.probe, resolve)),
        );
        const service = new DockerReadinessService({
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

        await expect(first).resolves.toMatchObject({ outcome: 'ready', daemonArchitecture: 'amd64' });
        await expect(second).resolves.toMatchObject({ outcome: 'ready', daemonArchitecture: 'amd64' });
        expect(runProbe).toHaveBeenCalledTimes(2);
    });

    it('treats a zero-exit info body with ServerErrors as not ready', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
            }
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            outcome: 'diagnosed',
            failureKind: 'permissionDenied',
            daemonReachable: false,
        });
    });

    it('cancels both probes under one deadline and returns an indeterminate timeout', async () => {
        const tokens: CancellationToken[] = [];
        const runProbe = jest.fn(
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

    it('uses a memoized result unless force refresh is requested', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({ OSType: 'linux', Architecture: 'aarch64', ServerErrors: [] }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 27.5.1' });
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: {},
            runProbe,
        });

        await service.getReadiness();
        await service.getReadiness();
        expect(runProbe).toHaveBeenCalledTimes(2);

        await service.getReadiness({ forceRefresh: true });
        expect(runProbe).toHaveBeenCalledTimes(4);
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
