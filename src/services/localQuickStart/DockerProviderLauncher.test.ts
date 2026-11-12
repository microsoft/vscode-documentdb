/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as vscode from 'vscode';
import {
    getDockerStartCapability,
    startDockerProvider,
    type DockerProviderLauncherDependencies,
    type DockerStartCapabilityInput,
} from './DockerProviderLauncher';
import { type DockerHostEnvironment } from './quickStartTypes';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

afterEach(() => {
    vi.useRealTimers();
    vi.mocked(spawn).mockReset();
});

function dependencies(overrides: DockerProviderLauncherDependencies = {}): DockerProviderLauncherDependencies {
    return {
        environmentVariables: { ProgramFiles: 'C:\\Program Files' },
        pathExists: async () => false,
        runProcess: async () => ({ exitCode: 1, stdout: '' }),
        launchDetached: async () => false,
        ...overrides,
    };
}

describe('getDockerStartCapability', () => {
    it('offers local Windows Desktop from an installed application without naming it as live evidence', async () => {
        const result = await getDockerStartCapability(
            {
                environment: 'windows',
                provider: 'unknown',
                providerEvidence: 'none',
            },
            dependencies({ pathExists: async () => true }),
        );

        expect(result).toEqual({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopWindows',
        });
    });

    describe('Podman machines', () => {
        const podmanInput: DockerStartCapabilityInput = {
            environment: 'windows',
            provider: 'podman',
            providerEvidence: 'none',
            podmanExecutable: 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
        };

        function machineList(overrides: object = {}): string {
            return JSON.stringify([
                {
                    Name: 'custom-vm',
                    Default: true,
                    Running: false,
                    Starting: false,
                    ...overrides,
                },
            ]);
        }

        function fakeChild(): EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
            kill: ReturnType<typeof vi.fn>;
        } {
            const child = Object.assign(new EventEmitter(), {
                stdout: new PassThrough(),
                stderr: new PassThrough(),
                kill: vi.fn(),
            });
            vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
            return child;
        }

        describe('Podman machine capability', () => {
            it('uses the absolute executable and explicit default machine name without starting anything', async () => {
                const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: machineList() });
                const startLongRunning = vi.fn();
                const result = await getDockerStartCapability(
                    podmanInput,
                    dependencies({ runProcess, startLongRunning }),
                );

                expect(runProcess).toHaveBeenCalledExactlyOnceWith(
                    podmanInput.podmanExecutable,
                    ['machine', 'list', '--format', 'json'],
                    undefined,
                );
                expect(result).toMatchObject({
                    provider: 'podman',
                    startAction: 'startPodmanMachine',
                    podmanMachine: { kind: 'stopped', name: 'custom-vm' },
                });
                expect(startLongRunning).not.toHaveBeenCalled();
            });

            it.each(['linux', 'wsl', 'ssh', 'devContainer', 'codespaces', 'otherRemote', 'unsupported'] as const)(
                'never discovers a machine on %s',
                async (environment) => {
                    const runProcess = vi.fn();
                    expect(
                        await getDockerStartCapability({ ...podmanInput, environment }, dependencies({ runProcess })),
                    ).toEqual({ provider: 'podman', providerEvidence: 'none' });
                    expect(runProcess).not.toHaveBeenCalled();
                },
            );

            it.each([
                { name: 'none', stdout: '[]', kind: 'none' },
                { name: 'already running', stdout: machineList({ Running: true }), kind: 'running' },
                { name: 'starting', stdout: machineList({ Starting: true }), kind: 'starting' },
                { name: 'malformed', stdout: 'invalid', kind: 'unknown' },
                { name: 'missing fields', stdout: '[{"Name":"custom-vm"}]', kind: 'unknown' },
            ])('does not offer start for $name', async ({ stdout, kind }) => {
                const onOutput = vi.fn();
                const result = await getDockerStartCapability(
                    podmanInput,
                    dependencies({
                        runProcess: async () => ({ exitCode: 0, stdout }),
                        onOutput,
                    }),
                );
                expect(result.podmanMachine?.kind).toBe(kind);
                expect(result.startAction).toBeUndefined();
                expect(onOutput).toHaveBeenCalledTimes(kind === 'unknown' ? 1 : 0);
            });

            it.each(['podman', 'C:\\Podman\\podman.cmd', 'C:\\Podman\\podman.BAT'])(
                'explicitly rejects unsupported Windows executable %s',
                async (podmanExecutable) => {
                    const runProcess = vi.fn();
                    const onOutput = vi.fn();
                    const result = await getDockerStartCapability(
                        { ...podmanInput, podmanExecutable },
                        dependencies({
                            runProcess,
                            onOutput,
                        }),
                    );
                    expect(result.podmanMachine).toEqual({ kind: 'unknown' });
                    expect(onOutput).toHaveBeenCalledWith(expect.stringContaining('absolute non-batch'));
                    expect(runProcess).not.toHaveBeenCalled();
                },
            );

            it.each([
                { exitCode: 1, stdout: '[]' },
                { exitCode: undefined, stdout: '' },
            ])('reports a failed machine list as unknown, never absent', async (result) => {
                const onOutput = vi.fn();
                expect(
                    (
                        await getDockerStartCapability(
                            podmanInput,
                            dependencies({
                                runProcess: async () => result,
                                onOutput,
                            }),
                        )
                    ).podmanMachine,
                ).toEqual({ kind: 'unknown' });
                expect(onOutput).toHaveBeenCalledWith(expect.stringContaining('podmanMachine=unknown'));
            });

            it('reports process rejection as logged unknown', async () => {
                const onOutput = vi.fn();
                expect(
                    (
                        await getDockerStartCapability(
                            podmanInput,
                            dependencies({
                                runProcess: async () => {
                                    throw new Error('spawn failure');
                                },
                                onOutput,
                            }),
                        )
                    ).podmanMachine,
                ).toEqual({ kind: 'unknown' });
                expect(onOutput).toHaveBeenCalledWith(expect.stringContaining('spawn failure'));
            });

            it('parses a successful bounded list and clears its deadline without killing it', async () => {
                vi.useFakeTimers();
                const child = fakeChild();
                const pending = getDockerStartCapability(podmanInput);
                child.stdout.write(machineList());
                child.emit('close', 0);
                expect(await pending).toMatchObject({ startAction: 'startPodmanMachine' });
                await vi.advanceTimersByTimeAsync(10_000);
                expect(child.kill).not.toHaveBeenCalled();
            });

            it('kills a machine list at its ten-second deadline and offers start when the retry answers', async () => {
                vi.useFakeTimers();
                const slow = fakeChild();
                const retry = fakeChild();
                const onOutput = vi.fn();
                const pending = getDockerStartCapability(podmanInput, { onOutput });
                await vi.advanceTimersByTimeAsync(9_999);
                expect(slow.kill).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(1);
                expect(slow.kill).toHaveBeenCalledOnce();
                retry.stdout.write(machineList());
                retry.emit('close', 0);
                await expect(pending).resolves.toMatchObject({
                    startAction: 'startPodmanMachine',
                    podmanMachine: { kind: 'stopped', name: 'custom-vm' },
                });
                expect(retry.kill).not.toHaveBeenCalled();
                expect(onOutput).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('retrying once'));
            });

            it('retries a timed-out machine list only once and logs the timeout with stderr', async () => {
                vi.useFakeTimers();
                const first = fakeChild();
                const second = fakeChild();
                const onOutput = vi.fn();
                const pending = getDockerStartCapability(podmanInput, { onOutput });
                await vi.advanceTimersByTimeAsync(10_000);
                second.stderr.write('Error: wsl did not answer\n');
                await vi.advanceTimersByTimeAsync(10_000);
                await expect(pending).resolves.toMatchObject({ podmanMachine: { kind: 'unknown' } });
                expect(first.kill).toHaveBeenCalledOnce();
                expect(second.kill).toHaveBeenCalledOnce();
                expect(spawn).toHaveBeenCalledTimes(2);
                expect(onOutput).toHaveBeenLastCalledWith(
                    '[readiness] podmanMachine=unknown: machine list timed out after 10 s\nError: wsl did not answer',
                );
            });

            it.each([
                {
                    result: { exitCode: 125, stdout: '', stderr: 'Error: no provider\n' },
                    logged: 'machine list exited with code 125\nError: no provider',
                },
                { result: { exitCode: 0, stdout: 'invalid' }, logged: 'machine list returned invalid JSON' },
                { result: { exitCode: undefined, stdout: '' }, logged: 'machine list did not complete' },
            ])('logs why the machine list failed without retrying: $logged', async ({ result, logged }) => {
                const runProcess = vi.fn().mockResolvedValue(result);
                const onOutput = vi.fn();
                await getDockerStartCapability(podmanInput, dependencies({ runProcess, onOutput }));
                expect(runProcess).toHaveBeenCalledOnce();
                expect(onOutput).toHaveBeenCalledExactlyOnceWith(`[readiness] podmanMachine=unknown: ${logged}`);
            });

            it('does not retry a timed-out machine list after cancellation', async () => {
                const runProcess = vi.fn().mockResolvedValue({ stdout: '', timedOut: true });
                const cancellationToken: vscode.CancellationToken = {
                    isCancellationRequested: true,
                    onCancellationRequested: () => ({ dispose: (): void => undefined }),
                };
                await getDockerStartCapability(
                    { ...podmanInput, cancellationToken },
                    dependencies({ runProcess, onOutput: vi.fn() }),
                );
                expect(runProcess).toHaveBeenCalledOnce();
            });

            describe('with several machines and none flagged Default', () => {
                const machines = JSON.stringify(
                    ['custom-vm', 'other'].map((Name) => ({ Name, Default: false, Running: false, Starting: false })),
                );
                const connections = (defaultName: string): string =>
                    JSON.stringify(
                        ['custom-vm', 'custom-vm-root', 'other'].map((Name) => ({
                            Name,
                            Default: Name === defaultName,
                        })),
                    );

                it('targets the rootful machine behind the default connection', async () => {
                    const runProcess = vi
                        .fn()
                        .mockResolvedValueOnce({ exitCode: 0, stdout: machines })
                        .mockResolvedValueOnce({ exitCode: 0, stdout: connections('custom-vm-root') });
                    const result = await getDockerStartCapability(podmanInput, dependencies({ runProcess }));
                    expect(runProcess).toHaveBeenLastCalledWith(
                        podmanInput.podmanExecutable,
                        ['system', 'connection', 'list', '--format', 'json'],
                        undefined,
                    );
                    expect(result).toMatchObject({
                        startAction: 'startPodmanMachine',
                        podmanMachine: { kind: 'stopped', name: 'custom-vm' },
                    });
                });

                it.each([
                    { name: 'the connection list fails', connectionList: { exitCode: 125, stdout: '' } },
                    {
                        name: 'the default connection is not a machine',
                        connectionList: { exitCode: 0, stdout: '[{"Name":"remote-host","Default":true}]' },
                    },
                ])('stays ambiguous when $name', async ({ connectionList }) => {
                    const runProcess = vi
                        .fn()
                        .mockResolvedValueOnce({ exitCode: 0, stdout: machines })
                        .mockResolvedValueOnce(connectionList);
                    const result = await getDockerStartCapability(podmanInput, dependencies({ runProcess }));
                    expect(result.podmanMachine).toEqual({ kind: 'ambiguous', names: ['custom-vm', 'other'] });
                    expect(result.startAction).toBeUndefined();
                });
            });

            it('kills a canceled machine list, not a startup process', async () => {
                const child = fakeChild();
                let cancel = (): void => undefined;
                const cancellationToken: vscode.CancellationToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: (listener) => {
                        cancel = (): void => {
                            listener(undefined);
                        };
                        return { dispose: (): void => undefined };
                    },
                };
                const pending = getDockerStartCapability({ ...podmanInput, cancellationToken }, {});
                cancel();
                expect(child.kill).toHaveBeenCalledOnce();
                await expect(pending).resolves.toMatchObject({ podmanMachine: { kind: 'unknown' } });
            });
        });

        describe('Podman machine startup', () => {
            it.each([
                { exitCode: 0, stderr: '', expected: 'started' },
                { exitCode: 125, stderr: 'Error: unable to start "custom-vm": already running\n', expected: 'started' },
                { exitCode: 125, stderr: 'unable to start "custom-vm": already running', expected: 'started' },
                { exitCode: 125, stderr: 'Error: unable to start "another-vm": already running', expected: 'failed' },
                {
                    exitCode: 125,
                    stderr: 'another machine "busy-vm" is already starting or running',
                    expected: 'failed',
                },
                { exitCode: 1, stderr: 'machine startup failed', expected: 'failed' },
            ])('maps exit $exitCode and exact stderr to $expected', async ({ exitCode, stderr, expected }) => {
                const onOutput = vi.fn();
                const startLongRunning = vi.fn().mockReturnValue({
                    spawned: Promise.resolve(true),
                    exit: Promise.resolve({ exitCode, stderr }),
                });
                expect(
                    await startDockerProvider(
                        'startPodmanMachine',
                        dependencies({
                            runProcess: async () => ({ exitCode: 0, stdout: machineList() }),
                            startLongRunning,
                            onOutput,
                        }),
                        podmanInput,
                    ),
                ).toBe(expected);
                expect(startLongRunning).toHaveBeenCalledExactlyOnceWith(
                    podmanInput.podmanExecutable,
                    ['machine', 'start', 'custom-vm'],
                    onOutput,
                );
                expect(onOutput).toHaveBeenCalledWith(expect.stringContaining(expected));
                if (stderr) {
                    expect(onOutput).toHaveBeenCalledWith(expect.stringContaining(stderr));
                }
            });

            it.each(['linux', 'wsl', 'ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)(
                'never starts a machine on %s',
                async (environment) => {
                    const startLongRunning = vi.fn();
                    expect(
                        await startDockerProvider('startPodmanMachine', dependencies({ startLongRunning }), {
                            ...podmanInput,
                            environment,
                        }),
                    ).toBe('notAvailable');
                    expect(startLongRunning).not.toHaveBeenCalled();
                },
            );

            it.each([
                [undefined, 'notAvailable'],
                ['running', 'started'],
                ['starting', 'launchAttempted'],
                ['none', 'notAvailable'],
            ] as const)('does not launch a stale target after the state changes to %s', async (kind, expected) => {
                const startLongRunning = vi.fn();
                const stdout =
                    kind === 'none'
                        ? '[]'
                        : machineList({
                              Running: kind === 'running',
                              Starting: kind === 'starting',
                          });
                expect(
                    await startDockerProvider(
                        'startPodmanMachine',
                        dependencies({
                            runProcess: async () => ({ exitCode: 0, stdout }),
                            startLongRunning,
                        }),
                        kind === undefined ? undefined : podmanInput,
                    ),
                ).toBe(expected);
                expect(startLongRunning).not.toHaveBeenCalled();
            });

            it('starts the current default by name rather than a stale discovery result', async () => {
                const startLongRunning = vi.fn().mockReturnValue({
                    spawned: Promise.resolve(true),
                    exit: Promise.resolve({ exitCode: 0, stderr: '' }),
                });
                expect(
                    await startDockerProvider(
                        'startPodmanMachine',
                        dependencies({
                            runProcess: async () => ({ exitCode: 0, stdout: machineList({ Name: 'new-default' }) }),
                            startLongRunning,
                        }),
                        podmanInput,
                    ),
                ).toBe('started');
                expect(startLongRunning).toHaveBeenCalledWith(
                    podmanInput.podmanExecutable,
                    ['machine', 'start', 'new-default'],
                    expect.any(Function),
                );
            });

            it.each([false, true])(
                'does not launch when another machine becomes active (running=%s)',
                async (running) => {
                    const startLongRunning = vi.fn();
                    expect(
                        await startDockerProvider(
                            'startPodmanMachine',
                            dependencies({
                                runProcess: async () => ({
                                    exitCode: 0,
                                    stdout: JSON.stringify([
                                        { Name: 'custom-vm', Default: true, Running: false, Starting: false },
                                        { Name: 'busy-vm', Default: false, Running: running, Starting: !running },
                                    ]),
                                }),
                                startLongRunning,
                            }),
                            podmanInput,
                        ),
                    ).toBe('notAvailable');
                    expect(startLongRunning).not.toHaveBeenCalled();
                },
            );

            it('returns failed when the startup process does not spawn', async () => {
                expect(
                    await startDockerProvider(
                        'startPodmanMachine',
                        dependencies({
                            runProcess: async () => ({ exitCode: 0, stdout: machineList() }),
                            startLongRunning: () => ({
                                spawned: Promise.resolve(false),
                                exit: Promise.resolve({ stderr: 'ENOENT' }),
                            }),
                        }),
                        podmanInput,
                    ),
                ).toBe('failed');
            });

            it('logs a native process spawn error and returns failed', async () => {
                const child = fakeChild();
                const onOutput = vi.fn();
                const pending = startDockerProvider(
                    'startPodmanMachine',
                    dependencies({
                        runProcess: async () => ({ exitCode: 0, stdout: machineList() }),
                        onOutput,
                    }),
                    podmanInput,
                );
                await new Promise((resolve) => setImmediate(resolve));
                child.emit('error', new Error('spawn ENOENT'));
                expect(await pending).toBe('failed');
                expect(onOutput).toHaveBeenCalledWith('spawn ENOENT');
                expect(child.kill).not.toHaveBeenCalled();
            });

            it('returns to polling after three seconds without killing startup and keeps draining after cancel', async () => {
                vi.useFakeTimers();
                const child = fakeChild();
                const onOutput = vi.fn();
                const cts = new vscode.CancellationTokenSource();
                const pending = startDockerProvider(
                    'startPodmanMachine',
                    dependencies({
                        runProcess: async () => ({ exitCode: 0, stdout: machineList() }),
                        onOutput,
                    }),
                    { ...podmanInput, cancellationToken: cts.token },
                );
                await vi.advanceTimersByTimeAsync(0);
                child.emit('spawn');
                child.stdout.write('booting\n');
                cts.cancel();
                await vi.advanceTimersByTimeAsync(3_000);
                expect(await pending).toBe('launchAttempted');
                expect(child.kill).not.toHaveBeenCalled();
                child.stderr.write('late startup error\n');
                child.emit('close', 1);
                await vi.advanceTimersByTimeAsync(0);
                expect(onOutput).toHaveBeenCalledWith('booting\n');
                expect(onOutput).toHaveBeenCalledWith('late startup error\n');
                expect(onOutput).toHaveBeenCalledWith(expect.stringContaining('failed (exit=1)'));
                expect(child.kill).not.toHaveBeenCalled();
                expect(spawn).toHaveBeenCalledExactlyOnceWith(
                    podmanInput.podmanExecutable,
                    ['machine', 'start', 'custom-vm'],
                    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
                );
                cts.dispose();
            });
        });
    });

    it('does not let an installed Windows application override positive Engine evidence', async () => {
        await expect(
            getDockerStartCapability(
                {
                    environment: 'windows',
                    provider: 'dockerEngine',
                    providerEvidence: 'liveDaemon',
                },
                dependencies({ pathExists: async () => true }),
            ),
        ).resolves.toEqual({ provider: 'dockerEngine', providerEvidence: 'liveDaemon' });
    });

    it('offers local macOS Desktop from the standard installed application', async () => {
        await expect(
            getDockerStartCapability(
                { environment: 'macos', provider: 'unknown', providerEvidence: 'none' },
                dependencies({ pathExists: async () => true }),
            ),
        ).resolves.toEqual({
            provider: 'dockerDesktop',
            providerEvidence: 'installedApplication',
            startAction: 'startDockerDesktopMacOS',
        });
    });

    it('requires positive Desktop evidence before offering the Windows application from WSL', async () => {
        const installedDependencies = dependencies({ pathExists: async () => true });

        await expect(
            getDockerStartCapability(
                { environment: 'wsl', provider: 'unknown', providerEvidence: 'none' },
                installedDependencies,
            ),
        ).resolves.toEqual({ provider: 'unknown', providerEvidence: 'none' });
        await expect(
            getDockerStartCapability(
                { environment: 'wsl', provider: 'dockerDesktop', providerEvidence: 'activeContext' },
                installedDependencies,
            ),
        ).resolves.toMatchObject({ startAction: 'startDockerDesktopWindowsFromWsl' });
    });

    it('offers Start Docker only for a rootless Engine endpoint with an available user service', async () => {
        const serviceDependencies = dependencies({
            runProcess: async () => ({ exitCode: 0, stdout: 'loaded\n' }),
        });

        await expect(
            getDockerStartCapability(
                {
                    environment: 'linux',
                    provider: 'dockerEngine',
                    providerEvidence: 'activeContext',
                    endpointAddress: '/run/user/1000/docker.sock',
                },
                serviceDependencies,
            ),
        ).resolves.toMatchObject({ startAction: 'startRootlessDockerEngineLinux' });
        await expect(
            getDockerStartCapability(
                {
                    environment: 'linux',
                    provider: 'dockerEngine',
                    providerEvidence: 'activeContext',
                    endpointAddress: '/var/run/docker.sock',
                },
                serviceDependencies,
            ),
        ).resolves.toEqual({ provider: 'dockerEngine', providerEvidence: 'activeContext' });
    });

    it('offers Linux Docker Desktop only from positive provider and user-service evidence', async () => {
        await expect(
            getDockerStartCapability(
                { environment: 'linux', provider: 'dockerDesktop', providerEvidence: 'activeContext' },
                dependencies({ runProcess: async () => ({ exitCode: 0, stdout: 'loaded\n' }) }),
            ),
        ).resolves.toMatchObject({ startAction: 'startDockerDesktopLinux' });
        await expect(
            getDockerStartCapability(
                { environment: 'linux', provider: 'unknown', providerEvidence: 'none' },
                dependencies({ runProcess: async () => ({ exitCode: 0, stdout: 'loaded\n' }) }),
            ),
        ).resolves.toEqual({ provider: 'unknown', providerEvidence: 'none' });
    });

    it.each(['ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)(
        'never offers a local launch from %s',
        async (environment: DockerHostEnvironment) => {
            await expect(
                getDockerStartCapability(
                    { environment, provider: 'dockerDesktop', providerEvidence: 'rememberedProvider' },
                    dependencies({ pathExists: async () => true }),
                ),
            ).resolves.toEqual({ provider: 'dockerDesktop', providerEvidence: 'rememberedProvider' });
        },
    );
});

describe('startDockerProvider', () => {
    it('returns launchAttempted only for a successfully spawned detached GUI', async () => {
        await expect(
            startDockerProvider(
                'startDockerDesktopWindows',
                dependencies({ pathExists: async () => true, launchDetached: async () => true }),
            ),
        ).resolves.toBe('launchAttempted');
    });

    it('revalidates application availability immediately before launch', async () => {
        const launchDetached = vi.fn().mockResolvedValue(true);

        await expect(
            startDockerProvider(
                'startDockerDesktopWindows',
                dependencies({ pathExists: async () => false, launchDetached }),
            ),
        ).resolves.toBe('notAvailable');
        expect(launchDetached).not.toHaveBeenCalled();
    });

    it('returns failed when a detached GUI process cannot be launched', async () => {
        await expect(
            startDockerProvider(
                'startDockerDesktopWindowsFromWsl',
                dependencies({ pathExists: async () => true, launchDetached: async () => false }),
            ),
        ).resolves.toBe('failed');
    });

    it.each([
        [0, 'started'],
        [1, 'failed'],
    ] as const)('maps the macOS open exit code %s to %s', async (exitCode, expected) => {
        await expect(
            startDockerProvider(
                'startDockerDesktopMacOS',
                dependencies({
                    pathExists: async () => true,
                    runProcess: async () => ({ exitCode, stdout: '' }),
                }),
            ),
        ).resolves.toBe(expected);
    });

    it.each([
        [0, 'started'],
        [1, 'failed'],
    ] as const)('maps a user-service start exit code of %s to %s', async (exitCode, expected) => {
        const runProcess = vi
            .fn()
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'loaded\n' })
            .mockResolvedValueOnce({ exitCode, stdout: '' });

        await expect(startDockerProvider('startDockerDesktopLinux', dependencies({ runProcess }))).resolves.toBe(
            expected,
        );
        expect(runProcess).toHaveBeenLastCalledWith('systemctl', ['--user', 'start', 'docker-desktop.service']);
    });

    it('returns notAvailable when the selected user service disappeared', async () => {
        await expect(startDockerProvider('startRootlessDockerEngineLinux', dependencies())).resolves.toBe(
            'notAvailable',
        );
    });
});
