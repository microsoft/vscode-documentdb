/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ContainerClient from '@microsoft/vscode-container-client';
import {
    ShellStreamCommandRunnerFactory,
    type ShellStreamCommandRunnerOptions,
} from '@microsoft/vscode-container-client';
import * as vscode from 'vscode';
import {
    ContainerRuntime,
    disposeQuickStartOutputChannel,
    getExitCode,
    getPublishedHostPort,
} from './ContainerRuntime';
import * as containerCli from './containerCli';
import type * as DockerCommand from './dockerCommand';
import { runDockerCommand, type DockerCommandOptions } from './dockerCommand';
import type * as DockerProbes from './dockerProbes';
import { runDockerProbe } from './dockerProbes';
import { DockerReadinessService } from './DockerReadinessService';
import * as DockerProviderLauncher from './DockerProviderLauncher';

vi.mock('@microsoft/vscode-container-client', async () => ({
    ...(await vi.importActual<typeof ContainerClient>('@microsoft/vscode-container-client')),
    ShellStreamCommandRunnerFactory: vi.fn(),
}));
vi.mock('./dockerCommand', async () => ({
    ...(await vi.importActual<typeof DockerCommand>('./dockerCommand')),
    runDockerCommand: vi.fn(),
}));
vi.mock('./dockerProbes', async () => ({
    ...(await vi.importActual<typeof DockerProbes>('./dockerProbes')),
    runDockerProbe: vi.fn(),
}));

const PASSWORD = 'hunter2-generated-password';
// `docker container inspect` output: the container env carries the credentials.
const STDOUT_WITH_ENV = JSON.stringify({ Config: { Env: ['USERNAME=admin', `PASSWORD=${PASSWORD}`] } });

const IMAGE_REF = 'ghcr.io/documentdb/documentdb/documentdb-local:latest';
const engine = ContainerRuntime.forCli({ cli: 'docker', executable: 'docker' });
function imageItem(raw: unknown): ContainerClient.InspectImagesItem {
    return {
        id: 'sha256:image-id',
        repoDigests: ['other/repository@sha256:wrong', IMAGE_REF.split(':')[0] + '@sha256:right'],
        labels: { 'org.opencontainers.image.version': '0.116.0', secret: PASSWORD },
        environmentVariables: { PASSWORD },
        createdAt: new Date(),
        raw: JSON.stringify(raw),
    } as unknown as ContainerClient.InspectImagesItem;
}

describe('ContainerRuntime output channel', () => {
    let lines: string[];
    let stdout: string;

    beforeEach(() => {
        lines = [];
        stdout = STDOUT_WITH_ENV;
        disposeQuickStartOutputChannel();
        vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue({
            appendLine: (line: string) => lines.push(line),
            dispose: () => undefined,
        } as unknown as vscode.LogOutputChannel);
        vi.mocked(ShellStreamCommandRunnerFactory).mockImplementation(function (
            options: ShellStreamCommandRunnerOptions,
        ) {
            return {
                getCommandRunner: () => async () => {
                    options.onCommand?.('docker …');
                    options.stdOutPipe?.end(stdout + '\n');
                    return [];
                },
            } as unknown as ShellStreamCommandRunnerFactory<ShellStreamCommandRunnerOptions>;
        });
        vi.mocked(runDockerCommand)
            .mockReset()
            .mockImplementation(async (_command, options: DockerCommandOptions) => {
                options.onCommand?.('docker …');
                options.stdOutPipe?.end(stdout + '\n');
                return undefined;
            });
    });

    afterEach(() => {
        disposeQuickStartOutputChannel();
        vi.restoreAllMocks();
    });

    it('never echoes inspect stdout, which carries the container env', async () => {
        await engine.inspectContainer('c1');
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('$ docker …');
        expect(lines.join('\n')).not.toContain(PASSWORD);
    });

    it('streams complete sanitized pull lines from both pipes after logging, including trailing lines', async () => {
        const progress = vi.fn((line: string): void => {
            expect(lines.at(-1)).toBe(line);
        });
        const cts = new vscode.CancellationTokenSource();
        vi.mocked(runDockerCommand).mockImplementationOnce(async (_command, options) => {
            expect(options.cancellationToken).toBe(cts.token);
            options.stdOutPipe?.write('\x1b[');
            options.stdOutPipe?.write('32mPulling image');
            expect(progress).not.toHaveBeenCalled();
            options.stdOutPipe?.write('\x1b[0m\n');
            options.stdErrPipe?.write('\x1b[');
            expect(progress).toHaveBeenCalledExactlyOnceWith('Pulling image');
            options.stdErrPipe?.end('33mChecking digest\x1b[0m');
            options.stdOutPipe?.end('Downloaded');
            return undefined;
        });

        await engine.pullImage(IMAGE_REF, cts.token, progress);

        expect(progress.mock.calls.map(([line]) => line)).toEqual(['Pulling image', 'Checking digest', 'Downloaded']);
        expect(lines).toEqual(['Pulling image', 'Checking digest', 'Downloaded']);
        cts.dispose();
    });

    it('preserves constructor secret masking across stream chunks for other command callers', async () => {
        vi.mocked(runDockerCommand).mockImplementationOnce(async (_command, options) => {
            options.stdOutPipe?.write('\x1b[32m' + PASSWORD.slice(0, 8));
            options.stdOutPipe?.end(PASSWORD.slice(8) + '\x1b[0m\n');
            options.stdErrPipe?.write(PASSWORD.slice(0, 5));
            options.stdErrPipe?.end(PASSWORD.slice(5));
            return undefined;
        });

        await engine.createAndRunContainer(
            { imageRef: IMAGE_REF, name: 'c1', labels: {}, hostPort: 10260, containerPort: 10260 },
            [PASSWORD],
        );

        expect(lines).toEqual(['***', '***']);
        expect(lines.join('\n')).not.toContain(PASSWORD);
    });

    it('propagates the original pull rejection after streaming output', async () => {
        const failure = new Error('pull failed');
        const progress = vi.fn();
        vi.mocked(runDockerCommand).mockImplementationOnce(async (_command, options) => {
            options.stdErrPipe?.end('Registry unavailable\n');
            options.stdOutPipe?.end();
            throw failure;
        });

        await expect(engine.pullImage(IMAGE_REF, undefined, progress)).rejects.toBe(failure);
        expect(progress).toHaveBeenCalledExactlyOnceWith('Registry unavailable');
        expect(lines).toEqual(['Registry unavailable']);
    });

    it('refreshes PATH presence without recreating an unchanged selected client or probing the other CLI', async () => {
        vi.spyOn(containerCli, 'resolveContainerCli')
            .mockReturnValueOnce({
                cli: 'docker',
                executable: 'discovered-docker',
                onPath: { docker: true, podman: false },
                preferred: 'docker',
                fellBack: false,
            })
            .mockReturnValueOnce({
                cli: 'docker',
                executable: 'discovered-docker',
                onPath: { docker: true, podman: true },
                preferred: 'docker',
                fellBack: false,
            });
        const createClient = vi.spyOn(containerCli, 'createContainerClient');
        vi.mocked(runDockerProbe).mockImplementation(async (options) => ({
            probe: options.probe,
            stdout: options.probe === 'info' ? '{"OSType":"linux"}' : '',
            stderr: '',
            endedBy: 'exit',
            durationMs: 1,
        }));

        await expect(ContainerRuntime.isDockerReady({ forceRefresh: true })).resolves.toMatchObject({
            outcome: 'ready',
            cli: 'docker',
            cliOnPath: { docker: true, podman: false },
        });
        await expect(ContainerRuntime.isDockerReady({ forceRefresh: true })).resolves.toMatchObject({
            outcome: 'ready',
            cli: 'docker',
            cliOnPath: { docker: true, podman: true },
        });
        expect(createClient).toHaveBeenCalledTimes(1);
        expect(runDockerProbe).toHaveBeenCalledTimes(6);
        for (const [options] of vi.mocked(runDockerProbe).mock.calls) {
            const command = typeof options.command === 'function' ? await options.command() : await options.command;
            expect(command.command).toBe('discovered-docker');
        }
    });

    it('keeps engine operation views bound to their own clients when calls interleave', async () => {
        const commands: string[] = [];
        vi.mocked(runDockerCommand).mockImplementation(async (command) => {
            const resolved = await (typeof command === 'function' ? command() : command);
            commands.push(resolved.command);
            return undefined;
        });
        const docker = ContainerRuntime.forCli({ cli: 'docker', executable: 'owning-docker' });
        const podman = ContainerRuntime.forCli({ cli: 'podman', executable: 'owning-podman' });

        await Promise.all([podman.pullImage(IMAGE_REF), docker.pullImage(IMAGE_REF)]);
        await podman.pullImage(IMAGE_REF);

        expect(commands).toEqual(['owning-podman', 'owning-docker', 'owning-podman']);
        expect(ContainerRuntime.forCli({ cli: 'podman', executable: 'owning-podman' })).toBe(podman);
        expect(ContainerRuntime.forCli({ cli: 'podman', executable: 'moved-podman' })).not.toBe(podman);
    });

    it.each(['docker', 'podman'] as const)('passes the requested %s preference to execution-time resolution', (preferred) => {
        const resolved: containerCli.ResolvedContainerCli = {
            cli: preferred, executable: preferred, preferred, fellBack: false,
            onPath: { docker: true, podman: true },
        };
        const resolve = vi.spyOn(containerCli, 'resolveContainerCli').mockReturnValue(resolved);
        expect(ContainerRuntime.resolveCli({ kind: 'preferred', preferred })).toBe(resolved);
        expect(resolve).toHaveBeenCalledExactlyOnceWith(preferred);
    });

    it.each([
        { request: { kind: 'preferred', preferred: 'docker' }, resolvedCli: 'podman' },
        { request: { kind: 'preferred', preferred: 'podman' }, resolvedCli: 'docker' },
        { request: { kind: 'pinned', cli: 'docker' }, resolvedCli: 'docker' },
        { request: { kind: 'pinned', cli: 'podman' }, resolvedCli: 'podman' },
    ] as const)('force-checks the same engine request before launch ($request.kind)', async ({ request, resolvedCli }) => {
        const readiness = vi.spyOn(DockerReadinessService.prototype, 'getReadiness').mockResolvedValue({
            outcome: 'diagnosed', failureKind: 'daemonUnavailable', cliInstalled: true,
            daemonReachable: false, environment: 'linux', endpointKind: 'unixSocket',
            provider: 'dockerEngine', providerEvidence: 'activeContext', executionTarget: 'local',
            checkedAtMs: 1, canContinueAnyway: false, startAction: 'startRootlessDockerEngineLinux', cli: resolvedCli,
        });
        const launch = vi.spyOn(DockerProviderLauncher, 'startDockerProvider').mockResolvedValue('launchAttempted');
        const record = vi.spyOn(DockerReadinessService.prototype, 'recordLaunchResult').mockResolvedValue(undefined);

        await expect(ContainerRuntime.startAvailableDockerProvider(request)).resolves.toBe('launchAttempted');

        expect(readiness).toHaveBeenCalledExactlyOnceWith({ engine: request, forceRefresh: true });
        expect(launch).toHaveBeenCalledExactlyOnceWith('startRootlessDockerEngineLinux');
        expect(record).toHaveBeenCalledExactlyOnceWith('launchAttempted', resolvedCli);
    });

    it('does not launch a different provider when the selected engine has no start action', async () => {
        vi.spyOn(DockerReadinessService.prototype, 'getReadiness').mockResolvedValue({
            outcome: 'diagnosed', failureKind: 'cliMissing', cliInstalled: false,
            daemonReachable: false, environment: 'linux', endpointKind: 'unknown',
            provider: 'unknown', providerEvidence: 'none', executionTarget: 'local',
            checkedAtMs: 1, canContinueAnyway: false,
        });
        const launch = vi.spyOn(DockerProviderLauncher, 'startDockerProvider');
        await expect(ContainerRuntime.startAvailableDockerProvider({
            kind: 'pinned', cli: 'podman',
        })).resolves.toBe('notAvailable');
        expect(launch).not.toHaveBeenCalled();
    });

    it('re-resolves the Podman executable on click and sends startup output to the setup log', async () => {
        const readiness = vi.spyOn(DockerReadinessService.prototype, 'getReadiness').mockResolvedValue({
            outcome: 'diagnosed', failureKind: 'daemonUnavailable', cliInstalled: true,
            daemonReachable: false, environment: 'windows', endpointKind: 'namedPipe',
            provider: 'podman', providerEvidence: 'none', executionTarget: 'local',
            checkedAtMs: 1, canContinueAnyway: false, startAction: 'startPodmanMachine', cli: 'podman',
            podmanMachine: { kind: 'stopped', name: 'old-default' },
        });
        const executable = 'C:\\New Podman\\podman.exe';
        const lookup = vi.spyOn(containerCli, 'findOnPath').mockReturnValue(executable);
        const launch = vi.spyOn(DockerProviderLauncher, 'startDockerProvider').mockImplementation(
            async (_action, dependencies) => {
                dependencies?.onOutput?.('machine startup output');
                return 'launchAttempted';
            },
        );
        const record = vi.spyOn(DockerReadinessService.prototype, 'recordLaunchResult').mockResolvedValue(undefined);
        const request = { kind: 'pinned', cli: 'podman' } as const;
        expect(await ContainerRuntime.startAvailableDockerProvider(request)).toBe('launchAttempted');
        expect(readiness).toHaveBeenCalledExactlyOnceWith({ engine: request, forceRefresh: true });
        expect(lookup).toHaveBeenCalledExactlyOnceWith('podman');
        expect(launch).toHaveBeenCalledExactlyOnceWith('startPodmanMachine', expect.any(Object), {
            environment: 'windows', provider: 'podman', providerEvidence: 'none', podmanExecutable: executable,
        });
        expect(record).toHaveBeenCalledExactlyOnceWith('launchAttempted', 'podman');
        expect(lines).toContain('machine startup output');
    });

    it.each(['failed', 'notAvailable'] as const)(
        'records a %s Podman-machine launch as Podman even with the Docker CLI shim',
        async (result) => {
            vi.spyOn(DockerReadinessService.prototype, 'getReadiness').mockResolvedValue({
                outcome: 'diagnosed', failureKind: 'daemonUnavailable', cliInstalled: true,
                daemonReachable: false, environment: 'macos', endpointKind: 'unixSocket',
                provider: 'podman', providerEvidence: 'none', executionTarget: 'local',
                checkedAtMs: 1, canContinueAnyway: false, startAction: 'startPodmanMachine', cli: 'docker',
                engine: 'podman', engineEvidence: 'podmanShim',
                podmanMachine: { kind: 'stopped', name: 'custom-vm' },
            });
            vi.spyOn(containerCli, 'findOnPath').mockReturnValue('/usr/local/bin/podman');
            vi.spyOn(DockerProviderLauncher, 'startDockerProvider').mockResolvedValue(result);
            const record = vi.spyOn(DockerReadinessService.prototype, 'recordLaunchResult').mockResolvedValue(undefined);

            expect(await ContainerRuntime.startAvailableDockerProvider({
                kind: 'preferred', preferred: 'docker',
            })).toBe(result);
            expect(record).toHaveBeenCalledExactlyOnceWith(result, 'podman');
        },
    );

    it.each([
        ['running', 'started'],
        ['starting', 'launchAttempted'],
    ] as const)('continues waiting if click-time readiness finds the machine %s', async (kind, expected) => {
        vi.spyOn(DockerReadinessService.prototype, 'getReadiness').mockResolvedValue({
            outcome: 'diagnosed', failureKind: kind === 'starting' ? 'daemonStarting' : 'daemonUnavailable',
            cliInstalled: true, daemonReachable: false, environment: 'macos', endpointKind: 'unixSocket',
            provider: 'podman', providerEvidence: 'none', executionTarget: 'local',
            checkedAtMs: 1, canContinueAnyway: false, cli: 'podman',
            podmanMachine: { kind, name: 'custom-vm' },
        });
        const launch = vi.spyOn(DockerProviderLauncher, 'startDockerProvider');
        expect(await ContainerRuntime.startAvailableDockerProvider({
            kind: 'preferred', preferred: 'podman',
        })).toBe(expected);
        expect(launch).not.toHaveBeenCalled();
    });

    it.each([
        ['Docker', { Id: 'sha256:image-id', Created: '2026-10-28T00:00:00Z' }],
        [
            'Podman',
            [
                { Id: 'other', Created: '2025-01-01T00:00:00Z' },
                { Id: 'sha256:image-id', Created: '2026-10-28T00:00:00Z' },
            ],
        ],
    ])('allow-lists %s image evidence without echoing commands, output, labels or env', async (_name, raw) => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem(raw)]);
        const cts = new vscode.CancellationTokenSource();
        const facts = await engine.inspectImage(IMAGE_REF, cts.token);
        expect(facts).toEqual({
            id: 'sha256:image-id',
            digest: 'sha256:right',
            version: '0.116.0',
            createdAtMs: Date.parse('2026-10-28T00:00:00Z'),
        });
        const options = vi.mocked(runDockerCommand).mock.calls[0][1];
        expect(options).toMatchObject({ cancellationToken: cts.token, timeoutMs: 10_000 });
        expect(options.onCommand).toBeUndefined();
        expect(options.stdOutPipe).toBeUndefined();
        expect(options.stdErrPipe).toBeUndefined();
        expect(lines).toEqual([]);
        expect(JSON.stringify(facts)).not.toContain(PASSWORD);
        cts.dispose();
    });

    it.each([undefined, null, '', 'not-a-date', '0001-01-01T00:00:00Z', 1_700_000_000_000])(
        'omits a missing or invalid source creation date (%s), never the client synthesized date',
        async (created) => {
            vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem({ Id: 'sha256:image-id', Created: created })]);
            expect(await engine.inspectImage(IMAGE_REF)).toMatchObject({
                id: 'sha256:image-id',
                createdAtMs: undefined,
            });
        },
    );

    it.each([null, [], [{ Id: 'other', Created: '2026-10-28T00:00:00Z' }], { Id: 'other', Created: '2026-10-28' }])(
        'does not use an unmatched raw record for the image date',
        async (raw) => {
            vi.mocked(runDockerCommand).mockResolvedValueOnce([imageItem(raw)]);
            expect(await engine.inspectImage(IMAGE_REF)).toMatchObject({ createdAtMs: undefined });
        },
    );

    it('omits unrelated digests and overlong OCI version labels', async () => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([
            {
                ...imageItem({ Id: 'sha256:image-id' }),
                repoDigests: ['other/repository@sha256:wrong'],
                labels: { 'org.opencontainers.image.version': 'a'.repeat(65) },
            },
        ]);
        expect(await engine.inspectImage(IMAGE_REF)).toEqual({
            id: 'sha256:image-id',
            digest: undefined,
            version: undefined,
            createdAtMs: undefined,
        });
    });

    it('proves absence only with an empty strict reference-filtered listing', async () => {
        vi.mocked(runDockerCommand).mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce([]);
        expect(await engine.inspectImage(IMAGE_REF)).toBe('absent');
        const commandLike = vi.mocked(runDockerCommand).mock.calls[1][0];
        const command = typeof commandLike === 'function' ? await commandLike() : await commandLike;
        expect(command.args).toContainEqual(expect.objectContaining({ value: `reference=${IMAGE_REF}` }));
        expect(() => command.parse?.('invalid listing', false)).toThrow();
    });

    it.each([
        ['inspect failed but image listed', [{ id: 'image' }]],
        ['listing could not answer', undefined],
    ])('does not confuse %s with absence', async (_name, listing) => {
        vi.mocked(runDockerCommand).mockRejectedValueOnce(new Error('inspect failed')).mockResolvedValueOnce(listing);
        expect(await engine.inspectImage(IMAGE_REF)).toBeUndefined();
    });

    it('returns unknown when both inspect and strict listing fail', async () => {
        vi.mocked(runDockerCommand).mockRejectedValue(new Error('daemon unavailable'));
        expect(await engine.inspectImage(IMAGE_REF)).toBeUndefined();
    });

    it('does not infer digest-reference absence from a zero-result reference filter', async () => {
        vi.mocked(runDockerCommand).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        expect(await engine.inspectImage(IMAGE_REF.split(':')[0] + '@sha256:abc')).toBeUndefined();
    });

    it.each([
        ['listByLabel', () => engine.listByLabel({ label: 'x' })],
        ['removeContainer', () => engine.removeContainer('c1')],
    ])('%s still echoes its stdout', async (_name, run) => {
        stdout = 'c1';
        await run();
        await new Promise((resolve) => setImmediate(resolve));

        expect(lines).toContain('c1');
    });
});

describe('raw inspect readers', () => {
    const record = {
        Id: 'abc',
        State: { ExitCode: 3 },
        HostConfig: { PortBindings: { '10260/tcp': [{ HostIp: '127.0.0.1', HostPort: '39733' }] } },
    };
    const item = (raw: unknown) => ({ id: 'abc', raw: JSON.stringify(raw) }) as ContainerClient.InspectContainersItem;

    it.each([
        ['Docker (one record)', record],
        ['Podman (whole inspect array)', [{ ...record, Id: 'other', State: { ExitCode: 9 } }, record]],
    ])('reads the exit code and published port from %s', (_label, raw) => {
        expect(getExitCode(item(raw))).toBe(3);
        expect(getPublishedHostPort(item(raw))).toBe(39733);
    });
});
