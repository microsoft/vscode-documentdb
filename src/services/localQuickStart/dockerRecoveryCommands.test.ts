/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { getDockerRecoveryCommand, getDockerRecoveryCommandById } from './dockerRecoveryCommands';
import { type PodmanTarget } from './quickStartTypes';

describe('getDockerRecoveryCommand', () => {
    it.each(['linux', 'wsl'] as const)('offers only the user Podman socket command on %s', (environment) => {
        expect(
            getDockerRecoveryCommand('daemonUnavailable', environment, 'unixSocket', 'unknown', 'unknown', {
                target: { kind: 'userSocket' },
            }),
        ).toEqual({
            id: 'linuxStartPodmanSocket',
            commandLine: 'systemctl --user start podman.socket',
            requiresElevation: false,
        });
        expect(
            getDockerRecoveryCommand('permissionDenied', environment, 'unixSocket', 'unknown', 'unknown', {
                target: { kind: 'userSocket' },
            }),
        ).toBeUndefined();
    });

    it('offers the named Windows command, never the user socket, for a Windows machine from WSL', () => {
        expect(
            getDockerRecoveryCommand('daemonUnavailable', 'wsl', 'unixSocket', 'unknown', 'unknown', {
                target: { kind: 'windowsMachineFromWsl', name: 'podman-machine-default' },
            }),
        ).toEqual({
            id: 'podmanMachineStartOnWindows',
            machineName: 'podman-machine-default',
            commandLine: 'podman machine start podman-machine-default',
            requiresElevation: false,
        });
    });

    it.each(['linux', 'wsl'] as const)(
        'offers no socket command for another local or unknown target on %s',
        (environment) => {
            const targets: readonly (PodmanTarget | undefined)[] = [{ kind: 'local' }, { kind: 'unknown' }, undefined];
            for (const target of targets) {
                expect(
                    getDockerRecoveryCommand('daemonUnavailable', environment, 'unixSocket', 'unknown', 'unknown', {
                        target,
                    }),
                ).toBeUndefined();
            }
        },
    );

    it.each(['windows', 'macos'] as const)('offers machine init only for confirmed absence on %s', (environment) => {
        expect(
            getDockerRecoveryCommand('daemonUnavailable', environment, 'unknown', 'unknown', 'unknown', {
                machine: { kind: 'none' },
            }),
        ).toEqual(getDockerRecoveryCommandById('podmanMachineInit'));
        expect(getDockerRecoveryCommandById('podmanMachineInit').commandLine).toBe('podman machine init');
        expect(
            getDockerRecoveryCommand('daemonUnavailable', environment, 'unknown', 'unknown', 'unknown', {
                machine: { kind: 'unknown' },
            }),
        ).toBeUndefined();
    });

    describe('getDockerRecoveryCommandById', () => {
        it.each(['podman-machine-default', 'A._-0'])(
            'builds the fixed Windows command for valid name %s',
            (machineName) => {
                expect(getDockerRecoveryCommandById('podmanMachineStartOnWindows', machineName)).toEqual({
                    id: 'podmanMachineStartOnWindows',
                    machineName,
                    commandLine: `podman machine start ${machineName}`,
                    requiresElevation: false,
                });
            },
        );

        it.each([undefined, '', 'two names', 'vm;whoami', 'vm$(whoami)', '-vm', 'vm\n', 'a'.repeat(65)])(
            'rejects invalid Windows machine name %j',
            (machineName) => {
                expect(() => getDockerRecoveryCommandById('podmanMachineStartOnWindows', machineName)).toThrow();
            },
        );

        it('rejects a machine name on a fixed command', () => {
            expect(() => getDockerRecoveryCommandById('linuxStartPodmanSocket', 'vm')).toThrow();
        });
    });

    it.each(['ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)(
        'does not offer local Podman recovery on %s',
        (environment) => {
            expect(
                getDockerRecoveryCommand('daemonUnavailable', environment, 'unixSocket', 'unknown', 'unknown', {
                    machine: { kind: 'none' },
                }),
            ).toBeUndefined();
        },
    );

    it.each([
        ['permissionDenied', 'linux', 'notInGroup', 'unknown', 'linuxDockerGroup'],
        ['permissionDenied', 'wsl', 'unknown', 'unknown', 'linuxDockerGroup'],
        ['permissionDenied', 'wsl', 'pendingSessionRestart', 'unknown', 'wslRestartFromWindows'],
        ['permissionDenied', 'linux', 'pendingSessionRestart', 'unknown', undefined],
        ['daemonUnavailable', 'linux', 'unknown', 'unknown', 'linuxStartService'],
        ['daemonUnavailable', 'wsl', 'unknown', 'systemd', 'linuxStartService'],
        ['daemonUnavailable', 'wsl', 'unknown', 'service', 'wslStartServiceNoSystemd'],
        ['daemonUnavailable', 'wsl', 'unknown', 'unknown', undefined],
    ] as const)(
        'selects %s for %s, %s, and %s',
        (failureKind, environment, permissionDetail, serviceManager, expectedId) => {
            expect(
                getDockerRecoveryCommand(failureKind, environment, 'unixSocket', permissionDetail, serviceManager)?.id,
            ).toBe(expectedId);
        },
    );
});
