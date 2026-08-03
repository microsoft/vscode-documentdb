/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ListContextItem, type PromiseCommandResponse } from '@microsoft/vscode-container-client';
import { Bash } from '@microsoft/vscode-processutils';
import { Writable } from 'stream';
import type * as vscode from 'vscode';
import {
    detectDockerHostEnvironment,
    DockerReadinessService,
    resolveDockerEndpoint,
    resolveDockerPermissionDetail,
    type DockerReadinessServiceDependencies,
} from './DockerReadinessService';
import { type RunDockerProbeOptions } from './dockerProbes';
import { type DockerProbeEvidence, type DockerProviderMemory } from './quickStartTypes';

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
        const runProbe = jest.fn(
            (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> =>
                new Promise((resolve) => {
                    options.cancellationToken?.onCancellationRequested(() => {
                        resolve(evidence(options.probe, { endedBy: 'cancellation' }));
                    });
                }),
        );
        const service = new DockerReadinessService({
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

    it('returns unsupportedHost without spawning Docker on an unsupported host', async () => {
        const runProbe = jest.fn();
        const service = new DockerReadinessService({
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
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { spawnErrorCode: 'ENOENT' });
            }
            return evidence(options.probe, { spawnErrorCode: 'ENOENT' });
        });
        const probeEndpoint = jest.fn();
        const service = new DockerReadinessService({
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

    it('classifies an explicitly selected context that is absent', async () => {
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', { stdout: '[]' });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
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
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info' || options.probe === 'contexts') {
                return evidence(options.probe, { exitCode: 1 });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
            client: createClient(),
            shellProvider: new Bash(),
            platform: 'linux',
            environmentVariables: { DOCKER_CONTEXT: 'unresolved' },
            runProbe,
            probeEndpoint: async (endpoint) => ({ kind: endpoint.kind, source: endpoint.source }),
        });

        await expect(service.getReadiness()).resolves.toMatchObject({
            failureKind: 'unknown',
            outcome: 'indeterminate',
        });
    });

    it('persists live Docker Desktop facts after a successful info probe', async () => {
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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

    it('diagnoses a reachable Windows-container daemon', async () => {
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1 });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const getStartCapability = jest.fn().mockResolvedValue({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopWindows',
        });
        const service = new DockerReadinessService({
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
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const service = new DockerReadinessService({
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
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            if (options.probe === 'info') {
                return evidence('info', {
                    stdout: JSON.stringify({ OSType: 'linux', OperatingSystem: 'Ubuntu', ServerErrors: [] }),
                });
            }
            return evidence(options.probe, { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
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
        const runProbe = jest.fn((options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
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
        expect(runProbe).toHaveBeenCalledTimes(4);
    });

    it.each(['notAvailable', 'failed'] as const)('clears remembered state after a %s launch', async (result) => {
        const writeProviderMemory = jest.fn().mockResolvedValue(undefined);
        const service = new DockerReadinessService({ writeProviderMemory });

        await service.recordLaunchResult(result);

        expect(writeProviderMemory).toHaveBeenCalledWith(undefined);
    });

    it('suppresses successful poll transcripts and retains a failing probe transcript', async () => {
        const onCommand = jest.fn();
        const stdout: string[] = [];
        const stderr: string[] = [];
        const runProbe = jest.fn(async (options: RunDockerProbeOptions): Promise<DockerProbeEvidence> => {
            options.onCommand?.(`docker ${options.probe}`);
            if (options.probe === 'info') {
                return evidence('info', { exitCode: 1, stdout: 'failed stdout', stderr: 'failed stderr' });
            }
            if (options.probe === 'contexts') {
                return evidence('contexts', { stdout: '[]' });
            }
            return evidence('cliVersion', { stdout: 'Docker version 28.1.1' });
        });
        const service = new DockerReadinessService({
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

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith('docker info');
        expect(stdout).toEqual(['failed stdout']);
        expect(stderr).toEqual(['failed stderr']);
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
