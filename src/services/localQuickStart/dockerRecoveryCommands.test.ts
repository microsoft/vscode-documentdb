/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { getDockerRecoveryCommand, getDockerRecoveryCommandById } from './dockerRecoveryCommands';

describe('getDockerRecoveryCommand', () => {
    it.each(['linux', 'wsl'] as const)('offers only the user Podman socket command on %s', (environment) => {
        expect(getDockerRecoveryCommand('daemonUnavailable', environment, 'unixSocket', 'unknown', 'unknown', {}))
            .toEqual({
                id: 'linuxStartPodmanSocket',
                commandLine: 'systemctl --user start podman.socket',
                requiresElevation: false,
            });
        expect(getDockerRecoveryCommand('permissionDenied', environment, 'unixSocket', 'unknown', 'unknown', {}))
            .toBeUndefined();
    });

    it.each(['windows', 'macos'] as const)('offers machine init only for confirmed absence on %s', (environment) => {
        expect(getDockerRecoveryCommand('daemonUnavailable', environment, 'unknown', 'unknown', 'unknown', {
            machine: { kind: 'none' },
        })).toEqual(getDockerRecoveryCommandById('podmanMachineInit'));
        expect(getDockerRecoveryCommandById('podmanMachineInit').commandLine).toBe('podman machine init');
        expect(getDockerRecoveryCommand('daemonUnavailable', environment, 'unknown', 'unknown', 'unknown', {
            machine: { kind: 'unknown' },
        })).toBeUndefined();
    });

    it.each(['ssh', 'devContainer', 'codespaces', 'otherRemote'] as const)('does not offer local Podman recovery on %s', (environment) => {
        expect(getDockerRecoveryCommand('daemonUnavailable', environment, 'unixSocket', 'unknown', 'unknown', {
            machine: { kind: 'none' },
        })).toBeUndefined();
    });

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
