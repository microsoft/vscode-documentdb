/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getDockerStartCapability,
    startDockerProvider,
    type DockerProviderLauncherDependencies,
} from './DockerProviderLauncher';
import { type DockerHostEnvironment } from './quickStartTypes';

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
        const launchDetached = jest.fn().mockResolvedValue(true);

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
        const runProcess = jest
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
